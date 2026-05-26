"""
app/services/step_executor.py

Core Playwright execution engine ported from V3 reference implementation.
Handles Oracle ERP Redwood/ADF patterns reliably:
  - dispatch_event("click") for Oracle tile/nav elements
  - JS DOM-walk fallback for get_by_title
  - _wait_for_page_stable: spinner + DOM hash (for Next/Save/Submit)
  - _wait_for_lov_fields: snapshot before Enter, poll until field changes
  - spinbutton: fill then Tab; combobox: fill then Enter + LOV wait
  - check/uncheck fallback to dispatch_event
  - 3-retry per step with screenshot on failure
  - pause/resume/stop/inject via asyncio.Event
"""
from __future__ import annotations
import asyncio
import base64
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from typing import Callable, Optional

logger = logging.getLogger("step_executor")

MAX_RETRY = 3

# ── Oracle JS helpers ─────────────────────────────────────────────────────────

_LOV_SNAPSHOT_JS = """
() => {
    var snap = {};
    var els = document.querySelectorAll('input[type="text"], input:not([type]), textarea, [role="combobox"], [role="textbox"]');
    for (var i = 0; i < els.length; i++) {
        var el = els[i]; var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        var id = el.id || el.name || (el.getAttribute("aria-label") || "") + "_" + i;
        snap[id] = el.value || el.textContent || "";
    }
    return snap;
}
"""

_LOV_CHANGED_JS = """
(snapshot) => {
    var els = document.querySelectorAll('input[type="text"], input:not([type]), textarea, [role="combobox"], [role="textbox"]');
    for (var i = 0; i < els.length; i++) {
        var el = els[i]; var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        var id = el.id || el.name || (el.getAttribute("aria-label") || "") + "_" + i;
        var cur = el.value || el.textContent || "";
        if (!(id in snapshot) && cur) return true;
        if (id in snapshot && snapshot[id] === "" && cur !== "") return true;
        if (id in snapshot && snapshot[id] !== cur && cur !== "") return true;
    }
    return false;
}
"""

_SPINNER_JS = """
() => {
    var s = document.querySelectorAll('[class*="loading"],[class*="spinner"],[class*="busy"],[aria-busy="true"],.af_statusIndicator,.oj-progress-bar,.oj-progress-circle');
    for(var i=0;i<s.length;i++){var r=s[i].getBoundingClientRect();if(r.width>0&&r.height>0)return true;}
    return false;
}
"""

_DOM_HASH_JS = """
() => {
    var e=document.querySelectorAll('*');
    var t=(document.body&&document.body.innerText)?document.body.innerText.length:0;
    return e.length+'_'+t;
}
"""

_JS_TITLE_CLICK = """
(titleVal) => {
    var el = document.querySelector('[title="' + titleVal + '"]');
    if (!el) {
        var all = document.querySelectorAll('[title]');
        for(var i=0;i<all.length;i++){
            var t=all[i].getAttribute('title')||'';
            if(t==='Search: '+titleVal||t.endsWith(': '+titleVal)){el=all[i];break;}
        }
    }
    if(el){
        var tag=el.tagName.toLowerCase(),role=el.getAttribute('role')||'';
        var ev=new MouseEvent('click',{bubbles:true,cancelable:true});
        if(['input','select','textarea','button','a'].indexOf(tag)>=0||['button','link','combobox','textbox','option'].indexOf(role)>=0){el.dispatchEvent(ev);return true;}
        var inner=el.querySelector('[role="combobox"],[role="textbox"],input,select,button,a');
        if(inner){inner.dispatchEvent(ev);return true;}
        el.dispatchEvent(ev);return true;
    }
    return false;
}
"""


def _q(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace('"', '\\"')


# ── StepRunner ────────────────────────────────────────────────────────────────

class StepRunner:
    """
    Executes a list of test steps against an Oracle ERP page.
    Callbacks:
      ws_broadcast(msg_dict)
      on_step_done(run_script_id, step_id, step_no, step_description, action,
                   executed_locator, input_value, status, duration_ms,
                   screenshot_b64, error_message)
      on_run_done(run_script_id, final_status)
    """
    VW, VH = 1280, 800

    def __init__(
        self,
        runner_id: str,
        run_script_id,
        test_run_id,
        steps: list,
        oracle_url: str,
        ws_broadcast: Callable,
        on_step_done: Callable,
        on_run_done: Callable,
        headless: bool = True,
        slow_mo: int = 300,
        wait_strategy: str = "domcontentloaded",
        timeout_ms: int = 20000,
        lov_timeout_ms: int = 10000,
        nav_timeout_ms: int = 15000,
        step_wait_ms: int = 500,
        screenshot_mode: str = "all",
        preview: bool = False,
    ):
        self.runner_id      = runner_id
        self.run_script_id  = run_script_id
        self.test_run_id    = test_run_id
        self.steps          = list(steps)
        self.oracle_url     = oracle_url
        self._bcast         = ws_broadcast
        self._on_step_done  = on_step_done
        self._on_run_done   = on_run_done
        # Preview = visible browser (requires Xvfb/DISPLAY to be set in container)
        self.headless       = False if preview else headless
        self.slow_mo        = slow_mo
        self.wait_strategy  = wait_strategy
        self.timeout_ms     = timeout_ms
        self.lov_timeout_ms = lov_timeout_ms
        self.nav_timeout_ms = nav_timeout_ms
        self.step_wait_ms   = step_wait_ms
        self.screenshot_mode = screenshot_mode
        self.preview        = preview

        self._pw = self._browser = self._ctx = self._page = self._cdp = None
        self._page_stack: list = []  # tracks all pages in context
        self._pause_event = asyncio.Event()
        self._pause_event.set()          # set = running
        self._stop_event  = asyncio.Event()
        self._stopped     = False
        self._paused      = False
        self._task: Optional[asyncio.Task] = None
        self._injected: list = []
        self._lov_snapshot = None
        self._xvfb_proc: Optional[subprocess.Popen] = None
        self._chrome_proc: Optional[subprocess.Popen] = None

    # ── Public controls ───────────────────────────────────────────────────────

    async def start(self):
        await self._launch()
        if self.preview or not self.headless:
            await self._start_screencast()
        self._task = asyncio.ensure_future(self._run())

    async def pause(self):
        self._paused = True
        self._pause_event.clear()
        await self._emit({
            "type": "paused", "run_id": str(self.test_run_id),
            "runner_id": self.runner_id, "run_script_id": str(self.run_script_id),
        })

    async def resume(self, updated_steps=None):
        if updated_steps is not None:
            self.steps = updated_steps
        self._paused = False
        self._pause_event.set()
        await self._emit({
            "type": "resumed", "run_id": str(self.test_run_id),
            "runner_id": self.runner_id, "run_script_id": str(self.run_script_id),
        })

    async def inject_step(self, step: dict, after_step_no: int = -1):
        step["_injected"] = True
        self._injected.append((after_step_no, step))

    async def stop(self):
        self._stopped = True
        self._stop_event.set()
        self._pause_event.set()   # unblock pause so stop is checked
        await self._emit({
            "type": "runner_stopped", "run_id": str(self.test_run_id),
            "runner_id": self.runner_id, "run_script_id": str(self.run_script_id),
        })
        # Cancel the execution task if it is running
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=2.0)
            except (asyncio.CancelledError, Exception):
                pass
        await self._close()

    async def scan_page_elements(self) -> list:
        return await _scan_elements(self._page) if self._page else []

    async def get_dropdown_options(self, label: str) -> list:
        if not self._page:
            return []
        return await _get_dropdown_options(self._page, label)

    # ── Main execution loop ───────────────────────────────────────────────────

    async def _run(self):
        try:
            if self.oracle_url:
                page = await self._get_active_page()
                for _nav_attempt in range(3):
                    try:
                        await page.goto(
                            self.oracle_url, wait_until="domcontentloaded", timeout=90000
                        )
                        await page.wait_for_timeout(3000)
                        break
                    except Exception as nav_exc:
                        if _nav_attempt == 2:
                            raise
                        logger.warning(
                            "Navigation attempt %d failed: %s — retrying",
                            _nav_attempt + 1, str(nav_exc)[:120],
                        )
                        await asyncio.sleep(3)
                        page = await self._get_active_page()

            step_idx = 0
            while step_idx < len(self.steps):
                if self._stop_event.is_set():
                    break

                # Process any injected steps due before this step
                while self._injected:
                    after_no, inj = self._injected[0]
                    cur_no = (
                        self.steps[step_idx]["step_no"]
                        if step_idx < len(self.steps) else 9999
                    )
                    if after_no < 0 or after_no < cur_no:
                        self._injected.pop(0)
                        await self._execute_step(inj)
                    else:
                        break

                # Check pause
                if not self._pause_event.is_set():
                    await self._emit({
                        "type": "paused",
                        "run_id": str(self.test_run_id),
                        "runner_id": self.runner_id,
                        "run_script_id": str(self.run_script_id),
                        "at_step_no": self.steps[step_idx].get("step_no", 0),
                    })
                    await self._pause_event.wait()
                    if self._stop_event.is_set():
                        break

                result = await self._execute_step(self.steps[step_idx])
                # On failure: pause and wait for user to resume or stop
                if result == "failed":
                    await self.pause()
                    await self._pause_event.wait()
                    if self._stop_event.is_set():
                        break

                step_idx += 1

            final = "stopped" if self._stop_event.is_set() else "completed"
            await self._on_run_done(self.run_script_id, final)
            await self._emit({
                "type": "runner_completed",
                "run_id": str(self.test_run_id),
                "runner_id": self.runner_id,
                "run_script_id": str(self.run_script_id),
                "status": final,
            })
        except Exception as exc:
            logger.exception("Runner %s error: %s", self.runner_id, exc)
            await self._on_run_done(self.run_script_id, "failed")
        finally:
            if not self._stopped:
                await self._close()

    # ── Step execution ────────────────────────────────────────────────────────

    async def _execute_step(self, es: dict) -> str:
        action   = es.get("action", "")
        label    = es.get("input_parameter", "") or ""
        val      = es.get("input_value", "") or es.get("default_value", "") or ""
        template = (es.get("locator_code") or "").strip()
        is_dd    = es.get("is_dropdown_open", False)
        is_opt   = es.get("is_option_selection", False)
        desc     = es.get("step_description") or f"Step {es.get('step_no', '?')}"
        step_id  = es.get("id")
        step_no  = es.get("step_no", 0)
        take_ss  = es.get("take_screenshot", True)

        # Skip login step
        if action in ("Login into Application(OJ)", "Login into Application"):
            return "passed"

        await self._emit({
            "type": "step_started",
            "run_id": str(self.test_run_id),
            "runner_id": self.runner_id,
            "run_script_id": str(self.run_script_id),
            "step_id": str(step_id) if step_id else None,
            "step_no": step_no,
            "step_description": desc,
        })

        t0 = time.time()

        # Build executable code
        code = None
        if template:
            code = (
                template.replace("{value}", _q(val))
                if val and "{value}" in template else template
            )
        if not code:
            code = _build_fallback(action, label, val)
        if not code:
            dur = int((time.time() - t0) * 1000)
            await self._record_result(
                step_id, step_no, desc, action, template, val,
                "passed", dur, "", ""
            )
            return "passed"

        last_exc = None
        for retry in range(MAX_RETRY + 1):
            if self._stop_event.is_set():
                break
            try:
                await self._exec_step(code, action, label, val, is_dd, is_opt)
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                if retry < MAX_RETRY:
                    logger.debug(
                        "Step retry %d/%d — %s|%s: %s",
                        retry + 1, MAX_RETRY, action, label, str(exc)[:100]
                    )
                    await self._emit({
                        "type": "step_retry",
                        "run_id": str(self.test_run_id),
                        "run_script_id": str(self.run_script_id),
                        "step_id": str(step_id) if step_id else None,
                        "step_no": step_no,
                        "retry": retry + 1,
                        "error": str(exc)[:120],
                    })
                    await asyncio.sleep(1.5)

        dur    = int((time.time() - t0) * 1000)
        status = "failed" if last_exc else "passed"
        error  = str(last_exc).split("\n")[0][:300] if last_exc else ""
        ss     = ""

        if self.screenshot_mode != "none":
            if self.screenshot_mode == "all" and take_ss:
                await asyncio.sleep(0.3)
                ss = await self._screenshot()
            elif self.screenshot_mode == "on_failure" and status == "failed":
                ss = await self._screenshot()

        await self._record_result(
            step_id, step_no, desc, action, code, val, status, dur, ss, error
        )
        return status

    async def _exec_step(self, code: str, action: str, label: str,
                         val: str, is_dd: bool, is_opt: bool):
        # Always get the active (non-stale) page before executing
        page = await self._get_active_page()
        if page is None:
            raise RuntimeError("No active page available — browser may have closed")
        code = code.strip()

        if code.startswith("page.goto("):
            m = re.search(r'page\.goto\("(.+?)"\)', code)
            if m:
                await page.goto(
                    m.group(1), wait_until="domcontentloaded", timeout=60000
                )
                await page.wait_for_timeout(2000)
            return

        if code.startswith("page.wait_for_timeout("):
            try:
                ms = int(code[len("page.wait_for_timeout("):].rstrip(")"))
                await asyncio.sleep(ms / 1000)
            except Exception:
                await asyncio.sleep(1)
            return

        if code.startswith("page.wait_for_load_state("):
            try:
                if "networkidle" in code:
                    await self._wait_for_lov_fields(page, snapshot=self._lov_snapshot)
                    self._lov_snapshot = None
                else:
                    state = "load" if '"load"' in code else "domcontentloaded"
                    await page.wait_for_load_state(state, timeout=30000)
            except Exception:
                pass
            return

        if "page.keyboard.press(" in code:
            m = re.search(r'page\.keyboard\.press\("(.+?)"\)', code)
            if m:
                await page.keyboard.press(m.group(1))
            return

        await self._eval_locator_code(code, page, action)
        await self._post_wait(code, action, label, is_dd, is_opt)

    async def _eval_locator_code(self, code: str, page, action: str = ""):
        if ".and_(" in code:
            await self._eval_and_locator(code, page)
            return

        code = code.strip()
        for action_suffix, _ in [
            (".select_option(", "select_option"),
            (".wait_for(",      "wait_for"),
            (".fill(",          "fill"),
            (".press(",         "press"),
            (".dispatch_event(","dispatch_event"),
            (".uncheck()",      "uncheck"),
            (".check()",        "check"),
            (".click()",        "click"),
        ]:
            idx = code.rfind(action_suffix)
            if idx < 0:
                continue
            loc_code = code[:idx]
            act_full = code[idx + 1:]
            if not loc_code.startswith("page."):
                continue
            loc = self._build_locator(loc_code, page)
            if loc is None:
                raise ValueError(
                    f"Could not build locator from: {loc_code!r}. "
                    "Check that the locator_code was recorded correctly."
                )

            if act_full == "click()":
                if "get_by_title(" in loc_code:
                    mt = re.search(r'get_by_title\("(.+?)"', loc_code)
                    tv = mt.group(1) if mt else None
                    if action == "Navigate":
                        try:
                            await loc.first.wait_for(
                                state="visible", timeout=self.timeout_ms
                            )
                            await loc.first.dispatch_event("click")
                        except Exception as e:
                            if tv:
                                clicked = await page.evaluate(_JS_TITLE_CLICK, tv)
                                if not clicked:
                                    raise e
                            else:
                                raise e
                    else:
                        if action == "Click Button":
                            await self._wait_for_page_stable(page, timeout=20.0)
                        try:
                            await loc.first.wait_for(
                                state="visible", timeout=self.timeout_ms
                            )
                            await loc.first.click(timeout=self.timeout_ms)
                        except Exception as e:
                            clicked = False
                            if tv:
                                try:
                                    cb = page.get_by_role("combobox", name=tv)
                                    if await cb.count() > 0:
                                        await cb.first.click(timeout=5000)
                                        clicked = True
                                except Exception:
                                    pass
                                if not clicked:
                                    try:
                                        clicked = await page.evaluate(
                                            _JS_TITLE_CLICK, tv
                                        )
                                    except Exception:
                                        pass
                            if not clicked:
                                raise e
                else:
                    if action == "Click Button":
                        await self._wait_for_page_stable(page, timeout=20.0)
                    await loc.first.wait_for(state="visible", timeout=self.timeout_ms)
                    await loc.first.scroll_into_view_if_needed(timeout=5000)
                    await loc.first.click(timeout=self.timeout_ms)

            elif act_full == "check()":
                try:
                    await loc.check(timeout=self.timeout_ms)
                except Exception:
                    try:
                        await loc.dispatch_event("click")
                    except Exception:
                        await loc.click(force=True, timeout=self.timeout_ms)

            elif act_full == "uncheck()":
                try:
                    await loc.uncheck(timeout=self.timeout_ms)
                except Exception:
                    try:
                        await loc.dispatch_event("click")
                    except Exception:
                        await loc.click(force=True, timeout=self.timeout_ms)

            elif act_full.startswith("fill("):
                m = re.search(r'fill\("((?:[^"\\]|\\.)*)"\)', act_full)
                if m:
                    fv = m.group(1).replace('\\"', '"')
                    if "spinbutton" in loc_code:
                        await loc.fill(fv, timeout=self.timeout_ms)
                        await page.wait_for_timeout(300)
                        await loc.press("Tab")
                    elif "combobox" in loc_code:
                        await loc.fill(fv, timeout=self.timeout_ms)
                        await page.wait_for_timeout(500)
                        try:
                            self._lov_snapshot = await page.evaluate(_LOV_SNAPSHOT_JS)
                        except Exception:
                            self._lov_snapshot = None
                        await loc.press("Enter")
                        await self._wait_for_lov_fields(
                            page, snapshot=self._lov_snapshot
                        )
                        self._lov_snapshot = None
                    else:
                        await loc.fill(fv, timeout=self.timeout_ms)

            elif act_full.startswith("press("):
                m = re.search(r"""press\(["'](.+?)["']\)""", act_full)
                if m:
                    key = m.group(1)
                    is_lov = (
                        key in ("Enter", "Tab")
                        and ("combobox" in loc_code or "get_by_role" in loc_code)
                        and "spinbutton" not in loc_code
                    )
                    if is_lov:
                        try:
                            self._lov_snapshot = await page.evaluate(_LOV_SNAPSHOT_JS)
                        except Exception:
                            self._lov_snapshot = None
                    try:
                        await loc.press(key, timeout=8000)
                    except Exception:
                        try:
                            await page.keyboard.press(key)
                        except Exception:
                            pass
                    if is_lov:
                        await self._wait_for_lov_fields(
                            page, snapshot=self._lov_snapshot
                        )
                        self._lov_snapshot = None

            elif act_full.startswith("select_option("):
                m = re.search(r'select_option\("((?:[^"\\]|\\.)*)"\)', act_full)
                if m:
                    await loc.select_option(m.group(1), timeout=self.timeout_ms)

            elif act_full.startswith("dispatch_event("):
                m = re.search(r"""dispatch_event\(["'](.+?)["']\)""", act_full)
                if m:
                    await loc.first.dispatch_event(m.group(1))

            elif act_full.startswith("wait_for("):
                await loc.first.wait_for(timeout=self.timeout_ms)

            return  # handled

    async def _eval_and_locator(self, code: str, page):
        m = re.match(
            r"(page\.get_by_role\(.*?\))\s*\.and_\s*\(\s*(page\.locator\(.*?\))\s*\)\s*\.(click.*)",
            code.strip(),
        )
        if not m:
            return
        l1 = self._build_locator(m.group(1), page)
        l2 = self._build_locator(m.group(2), page)
        if l1 is None or l2 is None:
            return
        combined = l1.and_(l2)
        count    = await combined.count()
        target   = combined.first if count > 1 else combined
        await target.dispatch_event("click")

    async def _post_wait(self, code: str, action: str, label: str,
                         is_dd: bool, is_opt: bool):
        page    = await self._get_active_page() or self._page
        lbl_low = label.lower()

        if is_opt or action in ("Select Option", "Dropdown Values"):
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass
            await page.wait_for_timeout(800)
            return

        if is_dd:
            try:
                await page.wait_for_selector(
                    '[role="dialog"],[role="listbox"],.af_popup,.oj-popup-content',
                    state="visible", timeout=self.lov_timeout_ms,
                )
            except Exception:
                pass
            await page.wait_for_timeout(800)
            return

        if action == "Navigate":
            await page.wait_for_timeout(3000)
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass
            return

        is_click = ".click()" in code or ".dispatch_event(" in code

        if is_click and any(
            kw in lbl_low
            for kw in ("next", "save", "submit", "finish", "done", "back",
                       "confirm", "apply", "process", "post", "ok")
        ):
            await asyncio.sleep(0.5)
            await self._wait_for_page_stable(page, timeout=30.0)
            return

        if action == "Date Picker":
            await page.wait_for_timeout(1000)
            return

        if action == "Select Date":
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass
            await page.wait_for_timeout(2500)
            return

        if is_click and action in ("Click Button", "Click Link", "Click"):
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass
            await page.wait_for_timeout(1200)
            return

        if is_click:
            await page.wait_for_timeout(800)
            return

        if ".fill(" in code:
            await page.wait_for_timeout(500)
            return

    async def _wait_for_lov_fields(self, page, timeout: float = 15.0, snapshot=None):
        try:
            if snapshot is None:
                snapshot = await page.evaluate(_LOV_SNAPSHOT_JS)
        except Exception:
            await asyncio.sleep(4)
            return

        deadline = asyncio.get_event_loop().time() + timeout
        changed  = False
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(0.2)
            try:
                changed = await page.evaluate(_LOV_CHANGED_JS, snapshot)
            except Exception:
                break
            if changed:
                break

        await asyncio.sleep(0.8 if changed else 2.0)

    async def _wait_for_page_stable(self, page, timeout: float = 30.0):
        sd = asyncio.get_event_loop().time() + 20.0
        while asyncio.get_event_loop().time() < sd:
            try:
                if not await page.evaluate(_SPINNER_JS):
                    break
            except Exception:
                break
            await asyncio.sleep(0.3)

        lh = ""; ss = 0.0; dl = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < dl:
            try:
                ch = await page.evaluate(_DOM_HASH_JS)
            except Exception:
                break
            now = asyncio.get_event_loop().time()
            if ch == lh:
                if ss == 0.0:
                    ss = now
                elif now - ss >= 1.0:
                    break
            else:
                lh = ch; ss = 0.0
            await asyncio.sleep(0.25)

    def _build_locator(self, expr: str, page):
        chain = expr.strip()
        if chain.startswith("page."):
            chain = chain[5:]
        parts = re.split(
            r"(?<=\))\.(?=[a-z])|(?<=first)\.(?=[a-z])|(?<=last)\.(?=[a-z])", chain
        )
        loc = page
        for part in parts:
            part = part.strip()
            if not part:
                continue
            try:
                if part.startswith("get_by_role("):
                    m = re.match(r'get_by_role\("(\w+)"(.*?)\)\s*$', part)
                    if m:
                        kw  = {}
                        nm2 = re.search(r'name="(.*?)"', m.group(2))
                        if nm2:
                            kw["name"] = nm2.group(1).replace('\\"', '"')
                        if "exact=True"  in m.group(2): kw["exact"] = True
                        if "exact=False" in m.group(2): kw["exact"] = False
                        loc = loc.get_by_role(m.group(1), **kw)
                elif part.startswith("get_by_label("):
                    m = re.match(r'get_by_label\("(.*?)"', part)
                    if m:
                        loc = loc.get_by_label(m.group(1).replace('\\"', '"'))
                elif part.startswith("get_by_text("):
                    m = re.match(r'get_by_text\("(.*?)"(.*?)\)', part)
                    if m:
                        kw = {}
                        if "exact=True"  in m.group(2): kw["exact"] = True
                        if "exact=False" in m.group(2): kw["exact"] = False
                        loc = loc.get_by_text(m.group(1).replace('\\"', '"'), **kw)
                elif part.startswith("get_by_title("):
                    m = re.match(r'get_by_title\("(.*?)"(.*?)\)', part)
                    if m:
                        kw = {"exact": True} if "exact=True" in m.group(2) else {}
                        loc = loc.get_by_title(m.group(1).replace('\\"', '"'), **kw)
                elif part.startswith("get_by_placeholder("):
                    m = re.match(r'get_by_placeholder\("(.*?)"\)', part)
                    if m:
                        loc = loc.get_by_placeholder(m.group(1).replace('\\"', '"'))
                elif part.startswith("locator("):
                    m = re.match(r'locator\("(.+?)"\)', part, re.DOTALL)
                    if not m:
                        m = re.match(r"locator\('(.+?)'\)", part, re.DOTALL)
                    if m:
                        loc = loc.locator(m.group(1).replace('\\"', '"'))
                elif part.startswith("filter("):
                    m = re.search(r'has_text="(.*?)"', part)
                    if m:
                        loc = loc.filter(has_text=m.group(1))
                elif part == "first":
                    loc = loc.first
                elif part == "last":
                    loc = loc.last
                elif part.startswith("nth("):
                    m = re.match(r"nth\((\d+)\)", part)
                    if m:
                        loc = loc.nth(int(m.group(1)))
                elif "visible=true" in part:
                    loc = loc.locator("visible=true")
            except Exception as exc:
                logger.debug("Locator parse '%s': %s", part, exc)
                return None
        return loc if loc is not page else None

    async def _screenshot(self) -> str:
        page = await self._get_active_page()
        if not page:
            return ""
        try:
            try:
                await asyncio.wait_for(
                    page.wait_for_load_state("domcontentloaded"), timeout=3.0
                )
            except Exception:
                pass
            return base64.b64encode(
                await page.screenshot(full_page=False, timeout=10000)
            ).decode()
        except Exception:
            return ""

    async def _record_result(self, step_id, step_no, desc, action, code,
                              val, status, dur, ss, error):
        try:
            await self._on_step_done(
                run_script_id=self.run_script_id,
                step_id=step_id,
                step_no=step_no,
                step_description=desc,
                action=action,
                executed_locator=code,
                input_value=val,
                status=status,
                duration_ms=dur,
                screenshot_b64=ss,
                error_message=error,
            )
        except Exception as exc:
            logger.error("on_step_done error: %s", exc)

    async def _emit(self, msg: dict):
        try:
            await self._bcast(msg)
        except Exception:
            pass

    async def _launch(self):
        """
        Launch Chrome as a subprocess inside the container, then connect via CDP.
        This approach:
          - Works reliably on Linux/Docker with no display issues
          - Supports headless=False via Xvfb (view via noVNC at port 6080)
          - Each runner gets its own Chrome process + profile (full isolation)
          - Uses connect_over_cdp so Playwright drives real Chrome (not bundled Chromium)
        """
        import shutil, subprocess, urllib.request, random
        from playwright.async_api import async_playwright

        chrome_bin = (
            shutil.which("google-chrome") or
            shutil.which("chromium-browser") or
            shutil.which("chromium") or
            "/usr/bin/google-chrome"
        )

        # Pick a random free port so parallel runners don't conflict
        port = random.randint(9300, 9400)
        subprocess.run(
            ["pkill", "-f", f"remote-debugging-port={port}"],
            capture_output=True
        )
        await asyncio.sleep(0.3)

        # Isolated profile per runner — prevents cookie/session conflicts
        profile_dir = f"/tmp/pw_runner_{self.runner_id}"
        shutil.rmtree(profile_dir, ignore_errors=True)

        # Use DISPLAY=:99 (Xvfb) for visible browser, empty for headless
        display = ":99" if not self.headless else ""
        env = {**os.environ}
        if display:
            env["DISPLAY"] = display

        chrome_args = [
            chrome_bin,
            "--no-sandbox", "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--no-first-run", "--no-default-browser-check",
            "--disable-notifications",
            "--disable-blink-features=AutomationControlled",
            f"--remote-debugging-port={port}",
            "--remote-debugging-address=127.0.0.1",
            f"--window-size={self.VW},{self.VH}",
            f"--user-data-dir={profile_dir}",
            "--lang=en-US",
        ]
        if self.headless:
            chrome_args.extend(["--headless=new", "--disable-gpu"])

        self._chrome_proc = subprocess.Popen(
            chrome_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
        )
        logger.info(
            "Chrome launched (runner=%s port=%d headless=%s)",
            self.runner_id, port, self.headless,
        )

        # Stop was requested while Chrome was starting — kill it immediately
        if self._stop_event.is_set():
            try:
                self._chrome_proc.terminate()
            except Exception:
                pass
            raise RuntimeError("Stop requested during browser launch")

        # Wait up to 20s for Chrome to be ready
        for attempt in range(40):
            # Check stop event on every iteration
            if self._stop_event.is_set():
                try:
                    self._chrome_proc.terminate()
                except Exception:
                    pass
                raise RuntimeError("Stop requested while waiting for Chrome")
            await asyncio.sleep(0.5)
            if self._chrome_proc.poll() is not None:
                raise RuntimeError(
                    f"Chrome exited unexpectedly (runner={self.runner_id})"
                )
            try:
                urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/json/version", timeout=1
                )
                logger.info("Chrome ready on port %d (runner=%s)", port, self.runner_id)
                break
            except Exception:
                if attempt == 39:
                    raise RuntimeError(
                        f"Chrome did not start in time on port {port}"
                    )

        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.connect_over_cdp(
            f"http://127.0.0.1:{port}"
        )
        self._ctx = await self._browser.new_context(
            viewport={"width": self.VW, "height": self.VH},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            ignore_https_errors=True,
        )
        await self._ctx.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            delete window.__playwright;
        """)
        self._page = await self._ctx.new_page()
        self._page_stack = [self._page]
        self._ctx.on("page", self._on_new_page)

    async def _ensure_display(self):
        display = os.environ.get("DISPLAY")
        if display and self._is_display_usable(display):
            return

        if self._is_display_usable(":0"):
            os.environ["DISPLAY"] = ":0"
            return

        xvfb_bin = shutil.which("Xvfb")
        if not xvfb_bin:
            raise RuntimeError(
                "Preview requires an X server on Linux. Install Xvfb in the container or run headless mode."
            )

        for disp in (":99", ":98", ":97"):
            proc = subprocess.Popen(
                [xvfb_bin, disp, "-screen", "0", f"{self.VW}x{self.VH}x24", "-ac", "+extension", "RANDR"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            await asyncio.sleep(0.25)
            if proc.poll() is None and self._is_display_usable(disp):
                self._xvfb_proc = proc
                os.environ["DISPLAY"] = disp
                logger.info("Started Xvfb for preview on display %s", disp)
                return
            try:
                proc.terminate()
                proc.wait(timeout=1)
            except Exception:
                pass

        raise RuntimeError(
            "Unable to start Xvfb display for preview mode. Check container permissions and Xvfb installation."
        )

    def _is_display_usable(self, display: str) -> bool:
        xdpyinfo_bin = shutil.which("xdpyinfo")
        if not xdpyinfo_bin:
            return False
        try:
            completed = subprocess.run(
                [xdpyinfo_bin, "-display", display],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=2,
                check=False,
            )
            return completed.returncode == 0
        except Exception:
            return False

    async def _start_screencast(self):
        """Start CDP screencast — streams JPEG frames as 'browser_frame' WS events."""
        try:
            self._cdp = await self._ctx.new_cdp_session(self._page)
            await self._cdp.send("Page.startScreencast", {
                "format": "jpeg",
                "quality": 70,
                "maxWidth": self.VW,
                "maxHeight": self.VH,
                "everyNthFrame": 2,
            })
            self._cdp.on("Page.screencastFrame", self._on_frame)
            logger.info("CDP screencast started for runner %s", self.runner_id)
        except Exception as exc:
            logger.warning(
                "CDP screencast failed to start for runner %s: %s — "
                "preview frames will not be available",
                self.runner_id, exc,
            )

    def _on_frame(self, event):
        try:
            asyncio.ensure_future(
                self._cdp.send(
                    "Page.screencastFrameAck", {"sessionId": event["sessionId"]}
                )
            )
            asyncio.ensure_future(self._emit({
                "type": "browser_frame",
                "runner_id": self.runner_id,
                "run_script_id": str(self.run_script_id),
                "data": event["data"],
            }))
        except Exception:
            pass


    def _on_new_page(self, page):
        """Called when Oracle ERP opens a new tab/popup."""
        self._page_stack.append(page)
        logger.info("New page opened (runner=%s): %s", self.runner_id, page.url)

    async def _get_active_page(self):
        """
        Return the active page, recovering from stale references.

        Oracle ERP frequently redirects to new URLs or opens new tabs after
        actions like Submit or Save.  When that happens, self._page may be
        closed or point to an old URL.  This method:
          1. Checks if self._page is still alive via a quick evaluate()
          2. If stale, picks the newest page from self._ctx.pages
          3. Updates self._page so future steps use the live page
        """
        if self._page is None:
            return None
        try:
            # Quick liveness check — fails if page is closed
            await self._page.evaluate("1")
            return self._page
        except Exception:
            pass
        # Page is stale — find the newest live page
        if self._ctx:
            try:
                pages = self._ctx.pages
                if pages:
                    # Prefer the last page (most recently opened)
                    new_page = pages[-1]
                    self._page = new_page
                    logger.warning(
                        "Stale page recovered → %s (runner=%s)",
                        new_page.url[:80], self.runner_id,
                    )
                    try:
                        await new_page.wait_for_load_state("domcontentloaded", timeout=5000)
                    except Exception:
                        pass
                    return self._page
            except Exception as exc:
                logger.error("Page recovery failed: %s", exc)
        return self._page

    async def _close(self):
        if self._cdp:
            try:
                await self._cdp.send("Page.stopScreencast")
            except Exception:
                pass
        for obj in [self._ctx, self._browser]:
            if obj:
                try:
                    await obj.close()
                except Exception:
                    pass
        if self._pw:
            try:
                await self._pw.stop()
            except Exception:
                pass
        # Kill the Chrome subprocess
        if hasattr(self, "_chrome_proc") and self._chrome_proc:
            try:
                self._chrome_proc.terminate()
                self._chrome_proc.wait(timeout=3)
            except Exception:
                try:
                    self._chrome_proc.kill()
                except Exception:
                    pass
            self._chrome_proc = None
        # Fallback: kill any chrome using this runner's profile directory
        # Handles the race condition where stop() runs before _chrome_proc is set
        profile_dir = f"/tmp/pw_runner_{self.runner_id}"
        try:
            subprocess.run(
                ["pkill", "-f", profile_dir],
                capture_output=True, timeout=3
            )
        except Exception:
            pass
        # Clean up isolated profile directory
        import shutil as _shutil
        try:
            _shutil.rmtree(profile_dir, ignore_errors=True)
        except Exception:
            pass
        if self._xvfb_proc and self._xvfb_proc.poll() is None:
            try:
                self._xvfb_proc.terminate()
                self._xvfb_proc.wait(timeout=2)
            except Exception:
                pass
        self._xvfb_proc = None


# ── Fallback locator builder ──────────────────────────────────────────────────

def _build_fallback(action: str, label: str, value: str) -> str:
    ql = _q(label); qv = _q(value)
    if not label and action not in ("Key - Enter", "Key - Tab"):
        return ""
    if action == "Navigate":
        return f'page.get_by_title("{ql}", exact=True).first.dispatch_event("click")'
    if action == "Click Button":
        if label.lower() in ("ok", "cancel", "reset", "apply", "search"):
            return (
                f'page.locator(\'input[type="submit"][value="{ql}"],'
                f'input[type="button"][value="{ql}"]\').last.click()'
            )
        return f'page.get_by_role("button", name="{ql}", exact=True).click()'
    if action == "Click Link":
        if label.rstrip(".").lower() == "search" or label == "Search...":
            return 'page.get_by_text("Search...", exact=True).locator("visible=true").click()'
        return (
            f'page.get_by_role("link", name="{ql}", exact=True)'
            '.locator("visible=true").first.click()'
        )
    if action == "Click":
        return f'page.get_by_text("{ql}", exact=True).locator("visible=true").click()'
    if action == "Open Dropdown":
        return f'page.get_by_role("combobox", name="{ql}", exact=True).first.click()'
    if action in ("Select Option", "Dropdown Values"):
        return f'page.get_by_text("{ql}", exact=True).locator("visible=true").click()'
    if action == "Enter Value - Text Field":
        return f'page.get_by_role("textbox", name="{ql}", exact=True).fill("{qv}")'
    if action == "Enter Value Text Field(Oj)":
        return f'page.get_by_role("spinbutton", name="{ql}").fill("{qv}")'
    if action == "Enter Value - Dropdown":
        return f'page.get_by_role("combobox", name="{ql}", exact=True).fill("{qv}")'
    if action == "Date Picker":
        return 'page.locator(\'a[title="Select Date"]\').first.click()'
    if action == "Select Date":
        if label == ".":
            return 'page.get_by_role("gridcell", name=".").click(force=True)'
        return f'page.get_by_role("gridcell", name="{ql}", exact=True).click(force=True)'
    if action == "Key - Enter":
        return 'page.keyboard.press("Enter")'
    if action == "Key - Tab":
        return 'page.keyboard.press("Tab")'
    if action == "Check":
        return f'page.get_by_role("checkbox", name="{ql}", exact=True).check()'
    if label:
        return f'page.get_by_text("{ql}", exact=True).locator("visible=true").click()'
    return ""


# ── Page element scanner ──────────────────────────────────────────────────────

async def _scan_elements(page) -> list:
    results = []; seen = set()
    SKIP = {
        "Select Date", "Previous Month", "Next Month",
        "Select Month", "Select Year", "Close", "Minimize",
    }

    def add(label: str, el_type: str, options=None):
        label = label.strip().rstrip("*:").strip()
        if not label or len(label) > 150 or label in SKIP:
            return
        key = f"{label}|{el_type}"
        if key in seen:
            return
        seen.add(key)
        row = {"label": label, "type": el_type}
        if options:
            row["options"] = options
        results.append(row)

    for aria_role, el_type in [
        ("textbox",    "Textbox"),
        ("combobox",   "Dropdown"),
        ("spinbutton", "Textbox"),
        ("checkbox",   "Checkbox"),
        ("button",     "Button"),
        ("link",       "Link"),
    ]:
        try:
            loc   = page.get_by_role(aria_role)
            count = await loc.count()
            for i in range(min(count, 60)):
                try:
                    el  = loc.nth(i)
                    if not await el.is_visible():
                        continue
                    lbl = (
                        await el.get_attribute("aria-label")
                        or await el.inner_text()
                        or ""
                    ).strip()
                    if not lbl or len(lbl) > 150:
                        continue
                    add(lbl, el_type)
                except Exception:
                    continue
        except Exception:
            continue

    for tag, el_type in [
        ("oj-input-text",    "Textbox"),
        ("oj-input-number",  "Textbox"),
        ("oj-input-date",    "Date"),
        ("oj-select-single", "Dropdown"),
        ("oj-combobox-one",  "Dropdown"),
    ]:
        try:
            loc   = page.locator(tag)
            count = await loc.count()
            for i in range(min(count, 40)):
                try:
                    el  = loc.nth(i)
                    if not await el.is_visible():
                        continue
                    lbl = (
                        await el.get_attribute("label-hint")
                        or await el.get_attribute("aria-label")
                        or ""
                    ).strip()
                    if lbl:
                        add(lbl, el_type)
                except Exception:
                    continue
        except Exception:
            continue

    try:
        tiles = page.locator('a[title]:not([title=""])')
        count = await tiles.count()
        for i in range(min(count, 40)):
            try:
                el  = tiles.nth(i)
                if not await el.is_visible():
                    continue
                ttl = (await el.get_attribute("title") or "").strip()
                if ttl and ttl not in SKIP:
                    add(ttl, "Navigate")
            except Exception:
                continue
    except Exception:
        pass

    return results


async def _get_dropdown_options(page, label: str) -> list:
    try:
        # Try opening the dropdown first
        await page.evaluate("""
        (lbl) => {
            var cbs = document.querySelectorAll('[role="combobox"], [aria-haspopup]');
            cbs.forEach(function(cb) {
                var l = cb.getAttribute('aria-label') || '';
                if (l.toLowerCase().indexOf(lbl.toLowerCase()) >= 0) cb.click();
            });
        }
        """, label)
        await asyncio.sleep(0.5)
    except Exception:
        pass

    _GET_OPTIONS_JS = """
    (label) => {
        var opts = [];
        var lbOpts = document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]');
        lbOpts.forEach(function(o) {
            var t = (o.innerText || o.textContent || '').trim();
            if (t && t.length < 120) opts.push(t);
        });
        if (opts.length > 0) return opts;
        var selects = document.querySelectorAll('select');
        selects.forEach(function(s) {
            var lbl = s.getAttribute('aria-label') || '';
            var id  = s.id;
            if (id) {
                var le = document.querySelector('label[for="' + id + '"]');
                if (le) lbl = (le.innerText || '').trim();
            }
            if (label && lbl.toLowerCase().indexOf(label.toLowerCase()) < 0) return;
            Array.from(s.options).forEach(function(op) {
                if (op.text.trim()) opts.push(op.text.trim());
            });
        });
        return opts;
    }
    """
    try:
        return await page.evaluate(_GET_OPTIONS_JS, label)
    except Exception:
        return []


# ── Runner manager ────────────────────────────────────────────────────────────

class RunnerManager:
    def __init__(self):
        self._runners: dict[str, StepRunner] = {}

    def register(self, runner: StepRunner):
        self._runners[runner.runner_id] = runner

    def get(self, runner_id: str) -> Optional[StepRunner]:
        return self._runners.get(runner_id)

    def get_by_script(self, run_script_id) -> Optional[StepRunner]:
        return next(
            (r for r in self._runners.values()
             if str(r.run_script_id) == str(run_script_id)),
            None,
        )

    async def pause(self, runner_id: str):
        r = self._runners.get(runner_id)
        if r:
            await r.pause()

    async def resume(self, runner_id: str, updated_steps=None):
        r = self._runners.get(runner_id)
        if r:
            await r.resume(updated_steps)

    async def inject(self, runner_id: str, step: dict, after_step_no: int = -1):
        r = self._runners.get(runner_id)
        if r:
            await r.inject_step(step, after_step_no)

    async def stop(self, runner_id: str):
        r = self._runners.pop(runner_id, None)
        if r:
            await r.stop()

    async def scan_elements(self, runner_id: str) -> list:
        r = self._runners.get(runner_id)
        return await r.scan_page_elements() if r else []

    async def get_options(self, runner_id: str, label: str) -> list:
        r = self._runners.get(runner_id)
        return await r.get_dropdown_options(label) if r else []

    def remove(self, runner_id: str):
        self._runners.pop(runner_id, None)


runner_manager = RunnerManager()