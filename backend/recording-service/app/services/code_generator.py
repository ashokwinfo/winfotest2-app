"""Code Generator – assembles MasterSteps into a full Playwright Python script."""
import re
from typing import Any, Sequence


class CodeGeneratorService:
    def generate(
        self,
        script_name: str,
        case_number: str,
        steps: Sequence[dict[str, Any]],
        target_url: str = "",
    ) -> str:
        fn   = self._safe_fn(case_number)
        nav  = f'    page.goto({target_url!r})' if target_url else "    # No initial URL"
        body = "\n".join(self._render(s) for s in steps)
        return f'''\
"""
Auto-generated Playwright test
Case   : {case_number}
Script : {script_name}
Tool   : Winfo Test 2.0
WARNING: DO NOT EDIT – regenerate via Recording Service API.
"""
import pytest
from playwright.sync_api import Page, expect


def {fn}(page: Page) -> None:
    """{case_number} - {script_name}"""
{nav}
{body}
'''

    def _render(self, step: dict[str, Any]) -> str:
        action   = step.get("action", "")
        locator  = step.get("locator_code", "") or ""
        value    = step.get("default_value", "") or ""
        desc     = step.get("step_description", "") or ""
        comment  = f"  # {desc}" if desc else ""

        # Substitute {value} placeholder with actual default value
        if value and "{value}" in locator:
            code = locator.replace("{value}", value.replace('"', '\\"'))
        else:
            code = locator

        if not code:
            return f"    # [no locator] {action}{comment}"

        return f"    {code}{comment}"

    @staticmethod
    def _safe_fn(case_number: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9]", "_", case_number).lower()
        return f"test_{safe}"


code_generator = CodeGeneratorService()