"""
runner_service.py  –  Winfo Test 2.0 Execution Service

Preserves all business logic from monolithic runner_service.py:
- StepRunner with full _exec_step, _eval_locator_code, _build_locator_obj
- _exec_datagrid_fill with all phases (nav cell, OJ_SELECT_JS, keyboard fallback)
- _auto_select_lov_option with JS + Playwright strategies
- _wait_for_lov_fields with _LOV_SNAPSHOT_JS / _LOV_CHANGED_JS
- _wait_for_page_stable with _SPINNER_JS / _DOM_HASH_JS
- 4-tier Click Link fallback for Oracle Redwood tiles
- CDP-based Chrome launch (same as recording service)
"""
from __future__ import annotations
import asyncio, base64, os, re, shutil, subprocess, time, uuid
from datetime import datetime, timezone
from typing import Optional

import structlog
from playwright.async_api import async_playwright

from app.utils.settings import settings
from app.websockets.execution_ws_handler import ws_manager
from app.utils.encryption import encryption_service
from app.utils.database import db_manager

log = structlog.get_logger(__name__)

MAX_RETRY = 3

# ── JS helpers (from monolith) ────────────────────────────────────────────────

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
    var s = document.querySelectorAll(
        '[class*="loading"],[class*="spinner"],[class*="busy"],[aria-busy="true"],' +
        '.af_statusIndicator,.oj-progress-bar,.oj-progress-circle'
    );
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
        if(['input','select','textarea','button','a'].indexOf(tag)>=0||
           ['button','link','combobox','textbox','option'].indexOf(role)>=0){
            el.dispatchEvent(ev);return true;
        }
        var inner=el.querySelector('[role="combobox"],[role="textbox"],input,select,button,a');
        if(inner){inner.dispatchEvent(ev);return true;}
        el.dispatchEvent(ev);return true;
    }
    return false;
}
"""

_JS_TEXT_CLICK = """
(titleVal) => {
    var all = document.querySelectorAll('a[title], [role="link"][title]');
    for(var i=0;i<all.length;i++){
        var t = (all[i].getAttribute('title')||'').trim();
        if(t && titleVal && t.indexOf(titleVal) === 0){
            all[i].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
            return true;
        }
    }
    var byText = document.querySelectorAll('a, [role="link"]');
    for(var j=0;j<byText.length;j++){
        var txt = (byText[j].innerText||byText[j].textContent||'').trim().split('\\n')[0].trim();
        if(txt && titleVal && (txt === titleVal || txt.startsWith(titleVal))){
            byText[j].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
            return true;
        }
    }
    return false;
}
"""

_LOV_OPTION_VISIBLE_JS = """
() => {
    var sel = '[role="listbox"] [role="option"], [role="listbox"] [role="row"], ' +
              '[role="listbox"] [role="gridcell"], oj-option, ' +
              '.oj-listbox-result-label, .af_selectItem, ' +
              '.oj-select-results [role="option"], ' +
              '.oj-listview-item[role="option"]';
    var opts = document.querySelectorAll(sel);
    for (var i = 0; i < opts.length; i++) {
        var r = opts[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
    }
    return false;
}
"""

_LOV_CLICK_FIRST_MATCH_JS = """
(typedValue) => {
    var tv = (typedValue || '').toLowerCase().trim();
    function visib(el) {
        try { var r=el.getBoundingClientRect(); if(r.width<1||r.height<1) return false;
              var s=window.getComputedStyle(el); return s.display!=='none'&&s.visibility!=='hidden'; }
        catch(e){return false;}
    }
    function getText(el) {
        var lbl=el.querySelector('.oj-listbox-result-label,.oj-select-item-label');
        if(lbl) return (lbl.innerText||lbl.textContent||'').trim();
        var lines=(el.innerText||el.textContent||'').split('\\n');
        for(var i=0;i<lines.length;i++){var l=lines[i].trim();if(l)return l;}
        return '';
    }
    function tryClick(el){
        el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        return true;
    }
    var listboxes=document.querySelectorAll('[role="listbox"]');
    for(var li=0;li<listboxes.length;li++){
        var lb=listboxes[li]; if(!visib(lb)) continue;
        var items=lb.querySelectorAll('[role="option"],[role="row"],[role="gridcell"],oj-option,li');
        for(var ii=0;ii<items.length;ii++){
            if(!visib(items[ii])) continue;
            var t=getText(items[ii]).toLowerCase();
            if(!tv||t===tv||t.startsWith(tv)) return tryClick(items[ii]);
        }
        for(var ii2=0;ii2<items.length;ii2++){ if(visib(items[ii2])) return tryClick(items[ii2]); }
    }
    var ojOpts=document.querySelectorAll('oj-option');
    for(var oi=0;oi<ojOpts.length;oi++){
        if(!visib(ojOpts[oi])) continue;
        var t2=getText(ojOpts[oi]).toLowerCase();
        if(!tv||t2===tv||t2.startsWith(tv)) return tryClick(ojOpts[oi]);
    }
    return false;
}
"""

_OJ_SELECT_JS = """
([colLabel, rowIdx]) => {
    var cl = colLabel.toLowerCase().replace(/:$/, '').trim();
    var all = Array.from(document.querySelectorAll('oj-select-single'));
    var visible = all.filter(function(el) {
        var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
    var matching = visible.filter(function(el) {
        var lh = (el.getAttribute('label-hint') || '').toLowerCase().replace(/:$/, '').trim();
        return lh === cl || lh.startsWith(cl + ' ') || lh.startsWith(cl + ':');
    });
    if (!matching.length) return null;
    var target = (rowIdx < 0)
        ? (matching.find(function(el) {
              return (el.getAttribute('label-hint') || '').toLowerCase().replace(/:$/, '').trim() === cl;
          }) || matching[0])
        : matching[Math.min(rowIdx, matching.length - 1)];
    var inp = target.querySelector('input[role="combobox"], input[type="text"], input');
    if (!inp) return null;
    return inp.id || '__found_no_id__';
}
"""

_NAV_CELL_JS = """
([colLabel, rowIdx]) => {
    var cl = colLabel.toLowerCase().replace(/[*:\\s]+$/, '').trim();
    var hdrs = Array.from(document.querySelectorAll(
        '.oj-datagrid-header-frozen .oj-datagrid-column-header-cell,' +
        '.oj-datagrid-column-header-frozen .oj-datagrid-column-header-cell'
    ));
    var hdrLeft = null;
    for (var i = 0; i < hdrs.length; i++) {
        var ht = (hdrs[i].textContent || '').trim().replace(/[*:\\s]+$/, '').trim().toLowerCase();
        if (ht === cl) { hdrLeft = hdrs[i].style.left; break; }
    }
    var allCells = Array.from(document.querySelectorAll('.oj-datagrid-cell-frozen'));
    var colCells = allCells.filter(function(c) { return hdrLeft === null || c.style.left === hdrLeft; });
    colCells.sort(function(a, b) { return parseInt(a.style.top || '0') - parseInt(b.style.top || '0'); });
    var target;
    if (rowIdx >= 0 && rowIdx < colCells.length) { target = colCells[rowIdx]; }
    else {
        target = colCells.find(function(c) { return !(c.innerText || c.textContent || '').trim(); });
        if (!target) target = colCells[colCells.length - 1];
    }
    if (!target) return null;
    target.scrollIntoView({ block: 'nearest' });
    var r = target.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
"""


def _q(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace('"', '\\"')


def _generate_locator_from_step(action: str, field_label: str, input_value: str = "") -> str:
    """Generate Playwright locator code from action + field label (fallback for empty locator_code)."""
    q_label = _q(field_label) if field_label else ""
    q_value = _q(input_value) if input_value else ""
    if action == "Login into Application(OJ)":   return ""
    elif action == "Navigate":
        if field_label: return f'page.get_by_title("{q_label}", exact=True).first.dispatch_event("click")'
    elif action == "Click Button":
        if field_label: return f'page.get_by_role("button", name="{q_label}", exact=True).click()'
    elif action == "Click Link":
        if field_label: return f'page.get_by_role("link", name="{q_label}").first.click()'
    elif action == "Click":
        if field_label: return f'page.get_by_text("{q_label}", exact=True).locator("visible=true").click()'
    elif action == "Enter Value - Text Field":
        clean = q_label.rstrip("*: ").strip()
        if input_value: return f'page.get_by_role("textbox", name="{clean}", exact=True).fill("{q_value}")'
        return f'page.get_by_role("textbox", name="{clean}", exact=True).fill("{{value}}")'
    elif action in ("Enter Value - Dropdown", "Enter Value Text Field(Oj)"):
        clean = q_label.rstrip("*: ").strip()
        if input_value: return f'page.get_by_role("combobox", name="{clean}").first.fill("{q_value}")'
        return f'page.get_by_role("combobox", name="{clean}").first.fill("{{value}}")'
    elif action in ("Select Option", "Dropdown Values"):
        if input_value:
            _cv = re.sub(r'^\d+[.,]?\d*\s+', '', input_value).strip()
            return f'page.get_by_text("{_q(_cv)}", exact=True).locator("visible=true").click()'
    elif action == "Date Picker":
        return 'page.locator(\'a[title="Select Date"]\').first.click()'
    elif action in ("Fill Date", "Select Date"):
        if input_value: return f'page.locator(\'input.oj-inputdatetime-input[role="combobox"]\').first.fill("{q_value}")'
        return 'page.locator(\'input.oj-inputdatetime-input[role="combobox"]\').first.fill("{value}")'
    elif action == "Key - Enter": return 'page.keyboard.press("Enter")'
    elif action == "Key - Tab":   return 'page.keyboard.press("Tab")'
    elif action == "Check":
        if field_label: return f'page.get_by_role("checkbox", name="{q_label}", exact=True).check()'
    elif action == "Uncheck":
        if field_label: return f'page.get_by_role("checkbox", name="{q_label}", exact=True).uncheck()'
    return ""


# ── Table references ──────────────────────────────────────────────────────────
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

meta = sa.MetaData()
t_runs    = sa.Table("execution_runs", meta,
    sa.Column("id",               PG_UUID(as_uuid=True)),
    sa.Column("run_name",         sa.String),
    sa.Column("status",           sa.String),
    sa.Column("browser",          sa.String),
    sa.Column("parallel_workers", sa.Integer),
    sa.Column("total_scripts",    sa.Integer),
    sa.Column("passed_scripts",   sa.Integer),
    sa.Column("failed_scripts",   sa.Integer),
    sa.Column("triggered_by",     sa.String),
    sa.Column("started_at",       sa.DateTime(timezone=True)),
    sa.Column("ended_at",         sa.DateTime(timezone=True)),
    sa.Column("created_at",       sa.DateTime(timezone=True)))

t_results = sa.Table("script_results", meta,
    sa.Column("id",                  PG_UUID(as_uuid=True)),
    sa.Column("run_id",              PG_UUID(as_uuid=True)),
    sa.Column("execution_script_id", PG_UUID(as_uuid=True)),
    sa.Column("status",              sa.String),
    sa.Column("started_at",          sa.DateTime(timezone=True)),
    sa.Column("ended_at",            sa.DateTime(timezone=True)),
    sa.Column("duration_ms",         sa.Integer),
    sa.Column("error_message",       sa.Text),
    sa.Column("error_stack",         sa.Text),
    sa.Column("video_path",          sa.Text),
    sa.Column("log_output",          sa.Text),
    sa.Column("metadata",            sa.JSON))

t_step_res = sa.Table("step_results", meta,
    sa.Column("id",                PG_UUID(as_uuid=True)),
    sa.Column("script_result_id",  PG_UUID(as_uuid=True)),
    sa.Column("execution_step_id", PG_UUID(as_uuid=True)),
    sa.Column("step_order",        sa.Integer),
    sa.Column("status",            sa.String),
    sa.Column("started_at",        sa.DateTime(timezone=True)),
    sa.Column("ended_at",          sa.DateTime(timezone=True)),
    sa.Column("duration_ms",       sa.Integer),
    sa.Column("screenshot_b64",    sa.Text),
    sa.Column("error_message",     sa.Text),
    sa.Column("actual_value",      sa.Text),
    sa.Column("metadata",          sa.JSON))

t_scripts  = sa.Table("execution_scripts", meta,
    sa.Column("id", PG_UUID(as_uuid=True)),
    sa.Column("case_number", sa.String), sa.Column("name", sa.String))


def _qi(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


async def _load_execution_steps(db, script_id):
    cols = (await db.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'execution_steps'
    """))).scalars().all()
    colset = set(cols)

    script_fk_col = next(
        (c for c in ("execution_script_id", "script_id") if c in colset),
        None,
    )
    if not script_fk_col:
        raise RuntimeError("execution_steps table is missing script reference column")

    step_no_col = next(
        (c for c in ("step_no", "step_number", "step_order", "sequence_no", "order_no") if c in colset),
        None,
    )
    if not step_no_col:
        raise RuntimeError("execution_steps table is missing step order column")

    active_col = next((c for c in ("is_active", "active", "enabled") if c in colset), None)

    where_active_sql = ""
    if active_col:
        where_active_sql = f" AND COALESCE(es.{_qi(active_col)}, TRUE) = TRUE"

    sql = sa.text(f"""
        SELECT es.*, es.{_qi(step_no_col)} AS step_no
        FROM execution_steps es
        WHERE es.{_qi(script_fk_col)} = :script_id
        {where_active_sql}
        ORDER BY es.{_qi(step_no_col)} NULLS LAST, es.id
    """)
    rows = (await db.execute(sql, {"script_id": script_id})).mappings().all()
    return [dict(r) for r in rows]

"""StepRunner class - appended to runner_service.py"""


class StepRunner:
    """Full StepRunner preserving all monolith execution logic."""
    VW, VH = 1280, 800

    def __init__(self, runner_id, run_id, script_id, result_id, steps,
                 oracle_url, browser_type="chromium", headless=True, slow_mo=300,
                 timeout_ms=20000, lov_timeout_ms=10000, nav_timeout_ms=15000):
        self.runner_id     = runner_id
        self.run_id        = run_id
        self.script_id     = script_id
        self.result_id     = result_id
        self.steps         = list(steps)
        self.oracle_url    = oracle_url
        self.browser_type  = browser_type
        self.headless      = headless
        self.slow_mo       = slow_mo
        self.timeout_ms    = timeout_ms
        self.lov_timeout_ms = lov_timeout_ms
        self.nav_timeout_ms = nav_timeout_ms
        self._pw = self._browser = self._ctx = self._page = self._cdp = None
        self._chrome_proc = None
        self._pause_event = asyncio.Event(); self._pause_event.set()
        self._stop_event  = asyncio.Event()
        self._stopped     = False
        self._task: Optional[asyncio.Task] = None
        self._lov_snapshot = None

    async def start(self):
        await self._launch()
        self._task = asyncio.ensure_future(self._run())

    async def stop(self):
        self._stopped = True; self._stop_event.set(); self._pause_event.set()
        await self._close()

    async def _run(self):
        try:
            if self.oracle_url:
                await self._page.goto(self.oracle_url, wait_until="domcontentloaded",
                                      timeout=self.nav_timeout_ms)
                try: await self._page.wait_for_load_state("networkidle", timeout=30_000)
                except: pass
                await asyncio.sleep(2)

            await ws_manager.broadcast(self.run_id, "run_started", {"run_id": str(self.run_id)})

            passed_steps = failed_steps = 0
            for step in self.steps:
                if self._stop_event.is_set(): break
                if not self._pause_event.is_set():
                    await self._pause_event.wait()
                    if self._stop_event.is_set(): break
                status = await self._execute_step(step)
                if status == "passed": passed_steps += 1
                else:                  failed_steps  += 1

            final = "completed" if not self._stop_event.is_set() else "stopped"
            if failed_steps > 0: final = "partial" if passed_steps > 0 else "failed"
            async with db_manager.session() as db:
                await db.execute(
                    sa.update(t_results).where(t_results.c.id == self.result_id).values(
                        status=final,
                        ended_at=datetime.now(timezone.utc),
                        metadata={"passed_steps": passed_steps, "failed_steps": failed_steps},
                    )
                )
                await db.commit()
            await ws_manager.broadcast(self.run_id, "script_finished", {
                "script_id": str(self.script_id), "status": final,
                "passed_steps": passed_steps, "failed_steps": failed_steps,
            })
        except Exception as exc:
            log.exception("Runner error", runner_id=self.runner_id, error=str(exc))
        finally:
            if not self._stopped: await self._close()

    async def _execute_step(self, step: dict) -> str:
        action   = step.get("action", "")
        label    = step.get("input_parameter", "") or ""
        val      = step.get("default_value", "") or ""
        # template = (step.get("locator_code") or "").strip()
        # CHANGE TO:
        _raw_template = (step.get("locator_code") or "").strip()
        if _raw_template:
            try:
                template = encryption_service.decrypt(_raw_template)
            except Exception:
                # If decryption fails the value is already plain text (e.g. manual steps)
                template = _raw_template
        else:
            template = ""
        is_dd    = step.get("is_dropdown_open", False)
        is_opt   = step.get("is_option_selection", False)
        desc     = step.get("step_description", f"Step {step.get('step_no','?')}")
        step_id  = step.get("id")
        step_no  = step.get("step_no", 0)

        # Skip login marker - navigation already done in _run
        if action == "Login into Application(OJ)":
            await self._record_step_result(db, step_id, step_no, desc, action, "", val, "passed", 0, "", "")
            return "passed"

        if not template:
            template = _generate_locator_from_step(action, label, val)
            if not template:
                await self._record_step_result(step_id, step_no, desc, action, "", val, "failed", 0, "",
                                               f"Cannot generate locator for '{action}' / '{label}'")
                return "failed"

        await ws_manager.broadcast(self.run_id, "step_started", {
            "step_no": step_no, "action": action, "description": desc,
        })

        t0   = time.time()
        code = template.replace("{value}", _q(val)) if val and "{value}" in template else template

        last_exc = None
        for retry in range(MAX_RETRY + 1):
            if self._stop_event.is_set(): break
            try:
                await self._exec_step(code, action, label, val, is_dd, is_opt)
                await asyncio.sleep(0.5)
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                if retry < MAX_RETRY:
                    log.warning("Step retry", step_no=step_no, retry=retry+1, error=str(exc)[:80])
                    await asyncio.sleep(2)
                    try: await self._page.wait_for_load_state("domcontentloaded", timeout=5000)
                    except: pass

        dur    = int((time.time() - t0) * 1000)
        status = "failed" if last_exc else "passed"
        error  = str(last_exc).split("\n")[0][:300] if last_exc else ""
        ss     = ""
        try:
            take_ss = step.get("take_screenshot", True)
            should_ss = take_ss and (status == "failed" or settings.SCREENSHOT_MODE == "all")
            if should_ss:
                await asyncio.sleep(0.3)
                ss = await self._screenshot()
        except Exception as e:
            log.warning("Screenshot failed", step_no=step_no, error=str(e)[:80])

        await self._record_step_result(db, step_id, step_no, desc, action, code, val, status, dur, ss, error)
        await ws_manager.broadcast(self.run_id, "step_finished", {
            "step_no": step_no, "status": status, "duration_ms": dur, "error": error,
        })
        return status

    async def _exec_step(self, code: str, action: str, label: str,
                         val: str, is_dd: bool, is_opt: bool):
        """Dispatch a single Playwright code string. Mirrors monolith _exec_step exactly."""
        page = self._page
        code = code.strip()

        if code.startswith('"__dg__:'):
            await self._exec_datagrid_fill(code, val, page)
            await self._auto_select_lov_option(page, val)
            return

        if code.startswith("page.goto("):
            m = re.search(r'page\.goto\("(.+?)"\)', code)
            if m:
                await page.goto(m.group(1), wait_until="domcontentloaded", timeout=self.nav_timeout_ms)
                try: await page.wait_for_load_state("domcontentloaded", timeout=self.nav_timeout_ms)
                except: pass
                await page.wait_for_timeout(2000)
            return

        if code.startswith("page.wait_for_timeout("):
            try: ms = int(code[len("page.wait_for_timeout("):].rstrip(")"))
            except: ms = 1000
            await asyncio.sleep(ms / 1000)
            return

        if code.startswith("page.wait_for_load_state("):
            try:
                if "networkidle" in code:
                    await self._wait_for_lov_fields(page, snapshot=self._lov_snapshot)
                    self._lov_snapshot = None
                else:
                    state = "load" if '"load"' in code else "domcontentloaded"
                    await page.wait_for_load_state(state, timeout=30_000)
            except: pass
            return

        if "page.keyboard.press(" in code:
            m = re.search(r'page\.keyboard\.press\("(.+?)"\)', code)
            if m: await page.keyboard.press(m.group(1))
            return

        await self._eval_locator_code(code, page)

        # Auto LOV selection after dropdown fill
        _is_dropdown_fill = (
            action in ("Enter Value - Dropdown", "Enter Value Text Field(Oj)") and
            ".fill(" in code and not is_opt
        )
        if _is_dropdown_fill and val:
            await self._auto_select_lov_option(page, val)
        else:
            await self._post_wait(code, action, label, is_dd, is_opt)

    async def _eval_locator_code(self, code: str, page):
        """Evaluate a Playwright locator+action line. Full monolith implementation."""
        code = code.strip()
        if ".and_(" in code:
            await self._eval_and_locator(code, page)
            return

        # Spinbutton: fill then Tab to commit Oracle PPR
        if ".fill(" in code and "spinbutton" in code:
            loc_str = code.split(".fill(")[0].strip()
            val_m = re.search(r'[.]fill\("(.+?)"\)', code)
            if val_m:
                loc = self._build_locator_obj(loc_str, page)
                if loc:
                    await loc.fill(val_m.group(1), timeout=30_000)
                    await page.wait_for_timeout(300)
                    await loc.press("Tab")
            return

        for action_suffix in [
            '.select_option(', '.wait_for(', '.fill(', '.type(',
            '.press(', '.uncheck()', '.check()',
            '.dispatch_event(', '.click()',
        ]:
            idx = code.rfind(action_suffix)
            if idx < 0: continue
            loc_code = code[:idx]
            act_full = code[idx + 1:]
            if not loc_code.startswith("page."): continue

            loc = self._build_locator_obj(loc_code, page)
            if loc is None:
                log.warning("Could not build locator", loc_code=loc_code[:120])
                return

            if act_full == "click()":
                is_link = ('get_by_role("link"' in loc_code)
                if is_link:
                    # 4-tier fallback for Oracle Redwood tiles (from monolith)
                    try: await loc.first.click(timeout=8000); return
                    except: pass
                    _nm = re.search(r'name="([^"]+)"', loc_code)
                    _name = _nm.group(1) if _nm else None
                    if _name:
                        try:
                            tl2 = page.get_by_role("link", name=_name)
                            if await tl2.count() > 0: await tl2.first.click(timeout=6000); return
                        except: pass
                        _title = re.split(r'\s{2,}|\n', _name.replace('\\n', '\n'))[0].strip()
                        if not _title or _title == _name:
                            _words = _name.split()
                            _title = " ".join(_words[:4]) if len(_words) > 4 else _name
                        if _title and _title != _name:
                            try:
                                tl3 = page.get_by_text(_title, exact=True).locator("visible=true")
                                if await tl3.count() > 0: await tl3.first.click(timeout=6000); return
                            except: pass
                        try:
                            if await page.evaluate(_JS_TEXT_CLICK, _title or _name): return
                        except: pass
                    raise Exception(f"Click Link: all fallbacks exhausted for name='{_name}'")
                elif "get_by_title(" in loc_code:
                    m = re.search(r'get_by_title\("(.+?)"', loc_code)
                    title_val = m.group(1) if m else None
                    try: await loc.click(timeout=8000)
                    except:
                        clicked = False
                        if title_val:
                            try:
                                cb = page.get_by_role("combobox", name=title_val)
                                if await cb.count() > 0: await cb.first.click(timeout=5000); clicked = True
                            except: pass
                        if not clicked:
                            try: clicked = await page.evaluate(_JS_TITLE_CLICK, title_val)
                            except: pass
                            if not clicked: await loc.dispatch_event("click")
                else:
                    await loc.click(timeout=self.timeout_ms)

            elif act_full == "check()":
                try: await loc.check(timeout=self.timeout_ms)
                except:
                    try: await loc.dispatch_event("click")
                    except: await loc.click(force=True, timeout=self.timeout_ms)

            elif act_full == "uncheck()":
                try: await loc.uncheck(timeout=self.timeout_ms)
                except:
                    try: await loc.dispatch_event("click")
                    except: await loc.click(force=True, timeout=self.timeout_ms)

            elif act_full.startswith("fill("):
                m = re.search(r'fill\("((?:[^"\\]|\\.)*)"\)', act_full)
                if m: await loc.fill(m.group(1).replace('\\"', '"'), timeout=self.timeout_ms)

            elif act_full.startswith("press("):
                m = re.search(r"""press\(["'](.+?)["']\)""", act_full)
                if m:
                    key = m.group(1)
                    is_lov = key in ("Enter","Tab") and "combobox" in loc_code and "spinbutton" not in loc_code
                    if is_lov:
                        try: self._lov_snapshot = await page.evaluate(_LOV_SNAPSHOT_JS)
                        except: self._lov_snapshot = None
                    try: await loc.press(key, timeout=8000)
                    except:
                        try: await page.keyboard.press(key)
                        except: pass
                    if is_lov:
                        await self._wait_for_lov_fields(page, snapshot=self._lov_snapshot)
                        self._lov_snapshot = None

            elif act_full.startswith("dispatch_event("):
                m = re.search(r"""dispatch_event\(["'](.+?)["']\)""", act_full)
                if m: await loc.dispatch_event(m.group(1))

            elif act_full.startswith("select_option("):
                m = re.search(r'select_option\("((?:[^"\\]|\\.)*)"\)', act_full)
                if m: await loc.select_option(m.group(1), timeout=self.timeout_ms)

            elif act_full.startswith("type("):
                m = re.search(r'type\("((?:[^"\\]|\\.)*)"\)', act_full)
                if m: await loc.type(m.group(1).replace('\\"', '"'))

            elif act_full.startswith("wait_for("):
                await loc.wait_for(timeout=self.timeout_ms)

            return

    async def _eval_and_locator(self, code: str, page):
        m = re.match(
            r'(page\.get_by_role\(.*?\))\s*\.and_\s*\(\s*(page\.locator\(.*?\))\s*\)\s*\.(\w+\(.*?\))',
            code.strip()
        )
        if not m: return
        loc1 = self._build_locator_obj(m.group(1), page)
        loc2 = self._build_locator_obj(m.group(2), page)
        if loc1 is None or loc2 is None: return
        combined = loc1.and_(loc2)
        if "click" in m.group(3):
            count = await combined.count()
            target = combined.first if count > 1 else combined
            await target.dispatch_event("click")

    def _build_locator_obj(self, loc_code: str, page):
        """Convert locator code string to Playwright Locator object. Full monolith implementation."""
        chain = loc_code.strip()
        if chain.startswith("page."): chain = chain[5:]
        if loc_code.strip().startswith('"__dg__:'): return None
        parts = re.split(r'(?<=\))\.|(?<=first)\.|(?<=last)\.', chain)
        loc = page
        for part in parts:
            part = part.strip()
            if not part: continue
            try:
                if part.startswith("get_by_role("):
                    m = re.match(r'get_by_role\("(\w+)"(.*?)\)\s*$', part)
                    if m: loc = loc.get_by_role(m.group(1), **self._parse_kwargs(m.group(2)))
                elif part.startswith("get_by_label("):
                    m = re.match(r'get_by_label\("(.*?)"(.*?)\)', part)
                    if m:
                        kwargs = self._parse_kwargs(m.group(2))
                        loc = loc.get_by_label(m.group(1).replace('\\"', '"'), **kwargs)
                elif part.startswith("get_by_text("):
                    m = re.match(r'get_by_text\("(.*?)"(.*?)\)', part)
                    if m: loc = loc.get_by_text(m.group(1).replace('\\"', '"'), **self._parse_kwargs(m.group(2)))
                elif part.startswith("get_by_title("):
                    m = re.match(r'get_by_title\("(.*?)"(.*?)\)', part)
                    if m: loc = loc.get_by_title(m.group(1).replace('\\"', '"'), **self._parse_kwargs(m.group(2)))
                elif part.startswith("get_by_placeholder("):
                    m = re.match(r'get_by_placeholder\("(.*?)"\)', part)
                    if m: loc = loc.get_by_placeholder(m.group(1).replace('\\"', '"'))
                elif part.startswith("locator("):
                    _lm = re.match(r'locator\("(.+?)"\)', part, re.DOTALL)
                    if not _lm: _lm = re.match(r"locator\('(.+?)'\)", part, re.DOTALL)
                    if _lm:
                        sel = _lm.group(1).replace('\\"', '"').replace("\\'", "'")
                        if sel.startswith('#') and '|' in sel:
                            sel = '[id="' + sel[1:] + '"]'
                        loc = loc.locator(sel)
                elif part == "first":   loc = loc.first
                elif part == "last":    loc = loc.last
                elif re.match(r"nth\(\d+\)", part):
                    n = int(re.search(r"\d+", part).group())
                    loc = loc.nth(n)
                elif "visible=true" in part:
                    loc = loc.locator("visible=true")
            except Exception as e:
                log.debug("Locator build error", part=part, error=str(e))
                return None
        return loc if loc is not page else None

    def _parse_kwargs(self, kwargs_str: str) -> dict:
        result = {}
        if not kwargs_str: return result
        m = re.search(r'name=["\'](.*?)["\']', kwargs_str)
        if m: result["name"] = m.group(1).replace('\\"', '"')
        if "exact=True"  in kwargs_str: result["exact"] = True
        if "exact=False" in kwargs_str: result["exact"] = False
        return result

    # ── DataGrid combobox fill (full monolith logic) ──────────────────────────
    async def _exec_datagrid_fill(self, code: str, val: str, page):
        m = re.match(r'"__dg__:row=(-?\d+):col=(.+)"', code.strip())
        if not m:
            log.warning("_exec_datagrid_fill: cannot parse", code=code)
            return
        row_idx   = int(m.group(1))
        col_label = m.group(2).replace("_", ":").strip()
        log.info("DataGrid fill", row=row_idx, col=col_label, val=val[:30])
        await self._datagrid_fill_col(page, col_label, row_idx, val)
        await page.wait_for_timeout(300)

    async def _datagrid_fill_col(self, page, col_label: str, row_idx: int, val: str):
        col_clean = col_label.rstrip("*: ").strip()
        # Phase 0: already in edit mode
        try:
            inp_id = await page.evaluate(_OJ_SELECT_JS, [col_clean, row_idx])
            if inp_id == '__found_no_id__':
                _oj_inp = page.locator(
                    f'oj-select-single[label-hint^="{col_clean}"] input[role="combobox"],'
                    f'oj-select-single[label-hint^="{col_clean}"] input'
                ).first
                await _oj_inp.fill(val, timeout=3000)
                await page.wait_for_timeout(1200)
                await page.keyboard.press('ArrowDown')
                await page.wait_for_timeout(300)
                await page.keyboard.press('Enter')
                await page.wait_for_timeout(500)
                return
            elif inp_id:
                loc = page.locator(f'[id="{inp_id}"]' if '|' in inp_id else f'#{inp_id}')
                await loc.fill(val, timeout=3000)
                return
        except: pass

        # Phase 1: click navigation cell
        try:
            coords = await page.evaluate(_NAV_CELL_JS, [col_clean, row_idx])
            if coords and coords.get('x') and coords.get('y'):
                await page.mouse.click(coords['x'], coords['y'])
                await page.wait_for_timeout(300)
                await page.keyboard.press('F2')
                await page.wait_for_timeout(700)
        except Exception as _ec:
            log.debug("Nav cell click error", error=str(_ec))

        # Phase 2: fill via oj-select-single
        try:
            inp_id = await page.evaluate(_OJ_SELECT_JS, [col_clean, row_idx])
            if inp_id == '__found_no_id__':
                _oj_inp = page.locator(
                    f'oj-select-single[label-hint^="{col_clean}"] input[role="combobox"],'
                    f'oj-select-single[label-hint^="{col_clean}"] input'
                ).first
                await _oj_inp.fill(val, timeout=10000)
                await page.wait_for_timeout(1200)
                await page.keyboard.press('ArrowDown')
                await page.wait_for_timeout(300)
                await page.keyboard.press('Enter')
                await page.wait_for_timeout(500)
                return
            elif inp_id:
                loc = page.locator(f'[id="{inp_id}"]' if '|' in inp_id else f'#{inp_id}')
                await loc.fill(val, timeout=10000)
                return
        except Exception as _e0:
            log.debug("OJ_SELECT_JS fill error", error=str(_e0))

        # Phase 2c: keyboard.type fallback
        try:
            await page.keyboard.type(val, delay=50)
            await page.wait_for_timeout(1200)
            await page.keyboard.press('ArrowDown')
            await page.wait_for_timeout(300)
            await page.keyboard.press('Enter')
            await page.wait_for_timeout(500)
            return
        except Exception as _ek:
            log.debug("keyboard.type failed", error=str(_ek))

        # Phase 3: get_by_label fallback
        nth = max(0, row_idx) if row_idx >= 0 else 0
        for _lv in [col_clean, col_clean + " *"]:
            try:
                loc = page.get_by_label(_lv).nth(nth)
                if await loc.count() > 0:
                    await loc.fill(val, timeout=6000)
                    return
            except: pass

        raise Exception(f"DataGrid fill failed: col='{col_clean}' row={row_idx}")

    async def _auto_select_lov_option(self, page, typed_value: str):
        """Auto-select first matching LOV option after combobox fill."""
        await page.wait_for_timeout(800)
        _tv = typed_value.strip().lower()
        for opt_loc in [
            page.locator('[role="option"]').filter(has_text=typed_value),
            page.locator('li[role="option"]').filter(has_text=typed_value),
            page.locator('.oj-listview-item[role="option"]').filter(has_text=typed_value),
        ]:
            try:
                if await opt_loc.count() > 0:
                    await opt_loc.first.click(timeout=3000)
                    await page.wait_for_timeout(600)
                    return
            except: pass

        deadline = asyncio.get_event_loop().time() + 3.0
        dropdown_appeared = False
        while asyncio.get_event_loop().time() < deadline:
            try:
                if await page.evaluate(_LOV_OPTION_VISIBLE_JS):
                    dropdown_appeared = True; break
            except: pass
            await asyncio.sleep(0.15)

        if not dropdown_appeared:
            await page.wait_for_timeout(500); return

        await asyncio.sleep(0.3)
        try:
            clicked = await page.evaluate(_LOV_CLICK_FIRST_MATCH_JS, typed_value)
            if clicked:
                await asyncio.sleep(0.5)
                try: await page.wait_for_load_state("domcontentloaded", timeout=5000)
                except: pass
                await page.wait_for_timeout(800)
                return
        except Exception as exc:
            log.debug("LOV auto-select JS error", error=str(exc))

        try:
            _clean = re.sub(r'^\d+[.,]?\d*\s+', '', typed_value).strip()
            opt_loc = page.get_by_text(_clean, exact=False).locator("visible=true")
            if await opt_loc.count() > 0:
                await opt_loc.first.click(timeout=5000)
                await asyncio.sleep(0.5)
                await page.wait_for_timeout(800)
                return
        except: pass
        await page.wait_for_timeout(500)

    async def _post_wait(self, code: str, action: str, label: str, is_dd: bool, is_opt: bool):
        page = self._page
        if is_opt or action in ("Select Option", "Dropdown Values"):
            try: await page.wait_for_load_state("domcontentloaded", timeout=5000)
            except: pass
            await page.wait_for_timeout(800); return
        if is_dd:
            try: await page.wait_for_selector('[role="dialog"],[role="listbox"]', state="visible", timeout=self.lov_timeout_ms)
            except: pass
            await page.wait_for_timeout(800); return
        if ".fill(" in code and "date" in label.lower():
            try: await page.keyboard.press("Tab"); await page.wait_for_timeout(600)
            except: pass
            return
        if action == "Navigate":
            await page.wait_for_timeout(3000)
            try: await page.wait_for_load_state("domcontentloaded", timeout=self.nav_timeout_ms)
            except: pass
            return
        label_lower = label.lower()
        if ".click()" in code and any(kw in label_lower for kw in
                ("next","save","submit","finish","done","back","confirm","apply","process","post","ok")):
            await asyncio.sleep(0.5)
            await self._wait_for_page_stable(page, timeout=30.0); return
        if ".click()" in code:  await page.wait_for_timeout(1200)
        elif ".fill(" in code:  await page.wait_for_timeout(500)

    async def _wait_for_lov_fields(self, page, timeout=15.0, snapshot=None):
        try:
            if snapshot is None: snapshot = await page.evaluate(_LOV_SNAPSHOT_JS)
        except:
            await asyncio.sleep(4); return
        deadline = asyncio.get_event_loop().time() + timeout
        changed = False
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(0.2)
            try: changed = await page.evaluate(_LOV_CHANGED_JS, snapshot)
            except: break
            if changed: break
        await asyncio.sleep(0.8 if changed else 2.0)

    async def _wait_for_page_stable(self, page, timeout=30.0):
        spinner_dl = asyncio.get_event_loop().time() + 20.0
        while asyncio.get_event_loop().time() < spinner_dl:
            try:
                if not await page.evaluate(_SPINNER_JS): break
            except: break
            await asyncio.sleep(0.3)
        lh = ""; ss = 0.0
        dl = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < dl:
            try: ch = await page.evaluate(_DOM_HASH_JS)
            except: break
            now = asyncio.get_event_loop().time()
            if ch == lh:
                if ss == 0.0: ss = now
                elif now - ss >= 1.0: break
            else: lh = ch; ss = 0.0
            await asyncio.sleep(0.25)

    async def _screenshot(self) -> str:
        if not self._page: return ""
        try:
            try: await asyncio.wait_for(self._page.wait_for_load_state("domcontentloaded"), timeout=3.0)
            except: pass
            data = await self._page.screenshot(full_page=False, timeout=10_000)
            return base64.b64encode(data).decode()
        except Exception as e:
            log.warning("Screenshot failed", error=str(e)[:100])
            return ""

    async def _record_step_result(self, step_id, step_no, desc, action, code, val, status, dur, ss, error):
        async with db_manager.session() as db:
            await db.execute(t_step_res.insert().values(
                id=uuid.uuid4(),
                script_result_id=self.result_id,
                execution_step_id=step_id,
                step_order=step_no,
                status=status,
                started_at=datetime.now(timezone.utc),
                ended_at=datetime.now(timezone.utc),
                duration_ms=dur,
                screenshot_b64=ss or None,
                error_message=error or None,
                actual_value=val or None,
                metadata={
                    "step_description": desc,
                    "action": action,
                    "executed_locator": code or None,
                    "retry_count": 0,
                },
            ))
            await db.commit()

    # ── Browser lifecycle (CDP, same as recording service) ────────────────────
    async def _launch(self):
        """
        Multi-browser launch.

        Routing logic:
          chromium/chrome + headless=False  → Chrome/Chromium via CDP subprocess
          chromium/chrome + headless=True   → Playwright chromium (headless)
          firefox                           → Playwright firefox  (always via Playwright)
          webkit / safari                   → Playwright webkit   (always via Playwright)
        """
        _bt = (self.browser_type or "chromium").lower().strip()
        _is_cdp_browser = _bt in ("chromium", "chrome", "edge", "msedge")
        _use_cdp = _is_cdp_browser and not self.headless

        if _use_cdp:
            await self._launch_cdp(_bt)
        else:
            await self._launch_playwright(_bt)

    async def _launch_cdp(self, browser_type: str):
        """Launch Chrome/Chromium via CDP for non-headless execution."""
        import urllib.request, glob as _glob
        port = 9222 + hash(self.runner_id) % 100

        # Find Chrome binary; fall back to Playwright's installed Chromium
        chrome_bin = (
            shutil.which("google-chrome") or
            shutil.which("google-chrome-stable") or
            shutil.which("chromium-browser") or
            shutil.which("chromium")
        )
        if not chrome_bin:
            pw_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/ms-playwright")
            candidates = _glob.glob(f"{pw_path}/chromium-*/chrome-linux/chrome")
            if candidates:
                chrome_bin = candidates[0]
        if not chrome_bin:
            raise RuntimeError("No Chrome/Chromium binary found for CDP launch.")

        subprocess.run(["pkill", "-f", f"remote-debugging-port={port}"], capture_output=True)
        await asyncio.sleep(0.3)
        profile_dir = f"/tmp/pw_runner_{self.runner_id}"
        shutil.rmtree(profile_dir, ignore_errors=True)

        env = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")}
        self._chrome_proc = subprocess.Popen([
            chrome_bin, "--no-sandbox", "--disable-setuid-sandbox",
            "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
            "--disable-notifications", "--disable-blink-features=AutomationControlled",
            f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1",
            f"--window-size={self.VW},{self.VH}", f"--user-data-dir={profile_dir}",
            "--lang=en-US",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)

        for _ in range(40):
            await asyncio.sleep(0.5)
            if self._chrome_proc.poll() is not None:
                raise RuntimeError("Chrome exited unexpectedly")
            try: urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1); break
            except: continue

        self._pw      = await async_playwright().start()
        self._browser = await self._pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        self._ctx     = await self._browser.new_context(
            viewport={"width": self.VW, "height": self.VH},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="en-US", ignore_https_errors=True,
        )
        await self._ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        self._page = await self._ctx.new_page()
        log.info("CDP browser launched", runner=self.runner_id, port=port, bin=chrome_bin)

    async def _launch_playwright(self, browser_type: str):
        """Launch any browser via Playwright's standard API (supports all browsers)."""
        self._pw = await async_playwright().start()

        # Map browser_type string → Playwright engine
        if browser_type in ("firefox", "ff"):
            engine = self._pw.firefox
        elif browser_type in ("webkit", "safari"):
            engine = self._pw.webkit
        else:
            engine = self._pw.chromium  # chromium, chrome, edge

        _is_chromium = browser_type not in ("firefox", "ff", "webkit", "safari")
        launch_kwargs: dict = {
            "headless": self.headless,
            "slow_mo":  self.slow_mo,
        }
        if _is_chromium:
            launch_kwargs["args"]               = ["--no-sandbox", "--disable-setuid-sandbox",
                                                    "--disable-dev-shm-usage",
                                                    "--disable-blink-features=AutomationControlled"]
            launch_kwargs["ignore_default_args"] = ["--enable-automation"]

        self._browser = await engine.launch(**launch_kwargs)
        self._ctx     = await self._browser.new_context(
            viewport={"width": self.VW, "height": self.VH},
            locale="en-US", ignore_https_errors=True,
        )
        await self._ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        self._page = await self._ctx.new_page()
        log.info("Playwright browser launched", runner=self.runner_id,
                 browser=browser_type, headless=self.headless)

    async def _close(self):
        for obj in [self._ctx, self._browser]:
            if obj:
                try: await obj.close()
                except: pass
        if self._pw:
            try: await self._pw.stop()
            except: pass
        if self._chrome_proc:
            try: self._chrome_proc.terminate()
            except: pass


# ── RunnerService (orchestrator) ──────────────────────────────────────────────
class RunnerService:
    def __init__(self):
        self._runners: dict[str, StepRunner] = {}

    async def start_run(self, script_ids, run_name, browser, parallel_workers,
                        triggered_by, db) -> uuid.UUID:
        now = datetime.now(timezone.utc)
        run_id = uuid.uuid4()
        await db.execute(t_runs.insert().values(
            id=run_id,
            run_name=run_name or f"Run {now.strftime('%Y-%m-%d %H:%M')}",
            status="pending", browser=browser, parallel_workers=parallel_workers,
            total_scripts=len(script_ids), passed_scripts=0, failed_scripts=0,
            triggered_by=triggered_by, created_at=now,
        ))
        await db.commit()
        # Background task uses its OWN sessions — never pass request session
        asyncio.create_task(self._run(run_id, script_ids, browser, parallel_workers))
        return run_id

    async def _run(self, run_id, script_ids, browser_type, parallel_workers):
        async with db_manager.session() as db:
            await db.execute(sa.update(t_runs).where(t_runs.c.id == run_id)
                             .values(status="running", started_at=datetime.now(timezone.utc)))
            result_ids = []
            for sid in script_ids:
                rid = uuid.uuid4()
                await db.execute(t_results.insert().values(
                    id=rid, run_id=run_id, execution_script_id=sid,
                    status="pending",
                ))
                result_ids.append(rid)
            await db.commit()

        sem = asyncio.Semaphore(max(1, parallel_workers))
        outcomes = await asyncio.gather(*[
            self._run_script(run_id, sid, rid, browser_type, sem)
            for sid, rid in zip(script_ids, result_ids)
        ], return_exceptions=True)

        passed = sum(1 for o in outcomes if o is True)
        failed = sum(1 for o in outcomes if o is not True)
        status = "completed" if failed == 0 else ("partial" if passed > 0 else "failed")

        async with db_manager.session() as db:
            await db.execute(sa.update(t_runs).where(t_runs.c.id == run_id).values(
                status=status, passed_scripts=passed, failed_scripts=failed,
                ended_at=datetime.now(timezone.utc),
            ))
            await db.commit()
        await ws_manager.broadcast(run_id, "run_finished", {
            "run_id": str(run_id), "status": status, "passed": passed, "failed": failed
        })

    async def _run_script(self, run_id, script_id, result_id, browser_type, sem):
        async with sem:
            async with db_manager.session() as db:
                script = (await db.execute(
                    sa.select(t_scripts).where(t_scripts.c.id == script_id)
                )).mappings().one_or_none()
                if not script:
                    await db.execute(sa.update(t_results).where(t_results.c.id == result_id)
                                     .values(status="error", error_message="Script not found"))
                    await db.commit()
                    return False

                await db.execute(sa.update(t_results).where(t_results.c.id == result_id)
                                 .values(status="running", started_at=datetime.now(timezone.utc)))
                await db.commit()

                await ws_manager.broadcast(run_id, "script_started", {
                    "script_id": str(script_id), "name": script["name"],
                    "case_number": script["case_number"],
                })

                steps = await _load_execution_steps(db, script_id)

            runner = StepRunner(
                runner_id=str(uuid.uuid4()), run_id=run_id,
                script_id=script_id, result_id=result_id,
                steps=[
                    {**s, "step_no": s.get("step_no") or (idx + 1)}
                    for idx, s in enumerate(steps)
                ],
                oracle_url=settings.ORACLE_ERP_URL,
                browser_type=browser_type,
                headless=settings.BROWSER_HEADLESS,
                slow_mo=settings.BROWSER_SLOW_MO,
                timeout_ms=settings.BROWSER_TIMEOUT,
            )

            try:
                await runner.start()
                if runner._task:
                    await runner._task
                return True
            except Exception as exc:
                log.exception("Script run error", script_id=str(script_id), error=str(exc))
                async with db_manager.session() as db:
                    await db.execute(sa.update(t_results).where(t_results.c.id == result_id)
                                     .values(status="failed", error_message=str(exc)[:300]))
                    await db.commit()
                return False


runner_service = RunnerService()