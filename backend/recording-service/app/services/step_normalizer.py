"""Step Normalizer – raw browser events → canonical step dict"""
import re
from typing import Any, Optional

_SENSITIVE = re.compile(r"(password|secret|token|credential|auth|pin)", re.I)

ACTION_MAP = {
    "click": "click", "dblclick": "click",
    "fill": "fill", "type": "fill", "input": "fill",
    "navigate": "navigate", "goto": "navigate", "load": "navigate",
    "assert": "assert", "check": "assert",
    "select": "select", "selectoption": "select",
    "hover": "hover", "mouseover": "hover",
    "press": "press", "keydown": "press", "keyup": "press",
    "wait": "wait", "waitfor": "wait",
    "scroll": "scroll", "wheel": "scroll",
}


class StepNormalizer:
    def normalize(self, raw: dict[str, Any]) -> dict[str, Any]:
        event_type = raw.get("event_type", "").lower()
        selector   = raw.get("selector")
        value      = raw.get("value")
        url        = raw.get("url")
        key        = raw.get("key")
        metadata   = raw.get("metadata", {})

        action_type = ACTION_MAP.get(event_type, "unknown")

        if value and selector and _SENSITIVE.search(selector):
            value = "***MASKED***"

        if selector:
            selector = " ".join(selector.split())

        description = self._describe(action_type, selector, value, url, key)

        return {
            "action_type": action_type,
            "selector":    selector,
            "value":       value if action_type in ("fill", "select") else None,
            "description": description,
            "metadata":    {**metadata, "raw_event_type": event_type, "url": url, "key": key},
        }

    @staticmethod
    def _describe(action, selector, value, url, key) -> str:
        if action == "navigate" and url:
            return f"Navigate to {url}"
        if action == "click" and selector:
            return f"Click on {selector}"
        if action == "fill" and selector:
            short = (value[:20] + "…" if value and len(value) > 20 else value) or ""
            return f"Fill '{short}' into {selector}"
        if action == "select" and selector:
            return f"Select '{value}' in {selector}"
        if action == "press" and key:
            return f"Press key '{key}'"
        if action == "hover" and selector:
            return f"Hover over {selector}"
        if action == "assert" and selector:
            return f"Assert visible: {selector}"
        if action == "scroll":
            return "Scroll page"
        return f"Perform {action}"


step_normalizer = StepNormalizer()
