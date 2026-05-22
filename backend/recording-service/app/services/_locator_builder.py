"""_locator_builder.py - locator and comment generation from monolith."""
from __future__ import annotations
import re

def _q(s): return str(s).replace("\\","\\\\").replace('"','\\"')

def _clean_special_chars(s):
    import re
    s = s.strip()
    s = re.sub(r'\\s*\\(\\d+\\)?\\s*$', '', s)
    s = re.sub(r'\\s+[\\$€£¥₹₩₺₽]$', '', s)
    s = re.sub(r'\\s+[A-Z]{3}$', '', s)
    s = re.sub(r'^[*:\\s]+|[*:\\s]+$', '', s)
    return s

def _build_locator(info):
    if info.get("role") == "option" and info.get("dgCol"):
        dg_col = info.get("dgCol", "")
        dg_row = info.get("dgRow", -1)
        return f'"__dg__:row={dg_row}:col={dg_col}"'
    _raw_label = info.get("label") or ""
    # Strip Oracle JET KnockoutJS/VB binding expressions
    _raw_label = re.sub(r'\[\[.*?\]\]', '', _raw_label, flags=re.DOTALL).strip()
    _raw_label = re.sub(r'<!--.*?-->', '', _raw_label, flags=re.DOTALL).strip()
    _raw_label = re.sub(r'\{\{.*?\}\}', '', _raw_label, flags=re.DOTALL).strip()
    _raw_label = ' '.join(_raw_label.split())
    # If label stripped to empty, fall back to title then text
    if not _raw_label:
        _raw_label = info.get("title") or info.get("text") or ""
        _raw_label = re.sub(r'\[\[.*?\]\]', '', _raw_label, flags=re.DOTALL).strip()
        _raw_label = ' '.join(_raw_label.split())
    label   = _clean_special_chars(_raw_label)
    text    = _clean_special_chars(info.get("text")   or "")
    title   = _clean_special_chars(info.get("title")  or "")
    role    = (info.get("role")   or "").strip()
    el_id   = (info.get("id")     or "").strip()
    ph      = (info.get("placeholder") or "").strip()
    tag     = (info.get("tag")    or "").strip().upper()
    el_type = (info.get("type")   or "").strip().lower()
    nth     = info.get("nth")

    # Detect if original text/label had a dynamic count suffix like (1), (2) stripped.
    # These elements need exact=False because Oracle updates the count at runtime.
    _raw_text  = (info.get("text")  or "").strip()
    _raw_label = (info.get("label") or "").strip()
    _had_dynamic_count = bool(
        re.search(r'\(\d+\)?\s*$', _raw_text) or
        re.search(r'\(\d+\)?\s*$', _raw_label)
    )
    if role == "tile":
        # Oracle Redwood/ADF nav tile link — identified by title attribute.
        # get_by_title is the only reliable locator since the link appears 60+ times in the DOM.
        # Fall back to get_by_label for tiles that use aria-label instead of title.
        n = title or label or text
        if n:
            # If the label is the same as title, prefer get_by_title (more specific)
            if title:
                return f'page.get_by_title("{_q(title)}", exact=True).first'
            return f'page.get_by_label("{_q(n)}")'
        return None
    if role == "adf_drop":
        # Never use dynamic IDs. Click the combobox input — opens the same dropdown list.
        # Use .first to avoid strict mode violation — Redwood renders the combobox twice
        # (visible input + hidden aria copy).
        if label: return f'page.get_by_role("combobox", name="{_q(label)}", exact=True).first'
        return None
    if role == "adf_lov":
        # Never use dynamic IDs. The parent wrapper has title="<label>" — use that.
        if label: return f'page.get_by_title("{_q(label)}", exact=True)'
        return None
    if role == "date_trigger":
        if nth is None or nth == 0:
            return "page.locator('a[title=\"Select Date\"]').first"
        return f"page.locator('a[title=\"Select Date\"]').nth({nth})"
    if role == "spinbutton":
        return f'page.get_by_role("spinbutton", name="{_q(label)}")' if label else 'page.get_by_role("spinbutton")'
    if role == "gridcell":
        if info.get("todayNum") and text == info.get("todayNum"):
            return 'page.get_by_role("gridcell", name=".")'
        if text:
            _gl = 'page.get_by_role("gridcell", name="' + _q(text) + '", exact=True).and_(page.locator("[data-afr-adfday=\'cm\']"))'
            return _gl
        return 'page.get_by_role("gridcell")'
    if role in ("lov_row","cell") and text:
        return f'page.get_by_text("{_q(text)}", exact=True).locator("visible=true")'
    if role == "option" and text:
        import re as _re_opt
        # Strip any leading Oracle price/code number e.g. "645.33 Copy Paper" -> "Copy Paper"
        _clean_text = _re_opt.sub(r'^\d+[.,]?\d*\s+', '', text).strip() or text
        return f'page.get_by_text("{_q(_clean_text)}", exact=True).locator("visible=true")'

    if not role:
        if tag=="BUTTON" or el_type in ("button","submit","reset"): role="button"
        elif tag=="A": role="link"
        elif el_type in ("checkbox","radio"): role=el_type
        elif tag in ("INPUT","TEXTAREA"): role="textbox"
        elif tag=="SELECT": role="combobox"

    _NAV = {"Next","Save","Back","Cancel","OK","Apply","Submit","Previous","Finish","Done"}
    if role == "button":
        n = label or text
        if n and len(n)<80: return f'page.get_by_role("button", name="{_q(n)}", exact=True)'
        # Fallback for buttons with title but no reliable label
        if title and title not in ("","undefined") and len(title)<80:
            return f'page.get_by_title("{_q(title)}", exact=True)'
    if role == "link" and (label or text) in _NAV:
        n = label or text
        return f'page.get_by_role("button", name="{_q(n)}", exact=True)'
    if role == "link":
        n = label or text
        if n and len(n)<80:
            # Use exact=False when the original label had a dynamic count suffix stripped
            # (e.g. "View Cart(1)" recorded as "View Cart" — runtime text varies)
            _exact = "False" if _had_dynamic_count else "True"
            return f'page.get_by_role("link", name="{_q(n)}", exact={_exact}).locator("visible=true").first'
    if tag == "A":
        n = label or text
        if n and len(n)<80:
            _exact = "False" if _had_dynamic_count else "True"
            return f'page.get_by_role("link", name="{_q(n)}", exact={_exact}).locator("visible=true").first'
        n = label or text
        if n and len(n)<80: return f'page.get_by_role("button", name="{_q(n)}", exact=True)'
    if title and title not in ("","undefined") and role not in ("link","button","combobox","textbox","select"):
        return f'page.get_by_title("{_q(title)}", exact=True)'
    if role == "datagrid_combobox":
        # Use special __dg__ prefix so runner can detect + parse row/col cleanly
        _dg_row = int(info.get("dgRow") or -1) if info.get("dgRow") is not None else -1
        _safe_label = (label or "").replace(":", "_")
        return f'"__dg__:row={_dg_row}:col={_safe_label}"' 
    if label and len(label)<100:
        if role=="spinbutton": return f'page.get_by_role("spinbutton", name="{_q(label)}")'
        if role=="textbox":    return f'page.get_by_role("textbox", name="{_q(label)}", exact=True)'
        if role=="combobox" and tag=="INPUT": return f'page.get_by_role("combobox", name="{_q(label)}")'
        if role not in ("button","link") and tag not in ("BUTTON","A") and el_type not in ("button","submit","reset"):
            _CAL = {"Select Month","Select Year","Select Date"}
            if label in _CAL: return f'page.get_by_label("{_q(label)}").locator("visible=true")'
            return f'page.get_by_label("{_q(label)}").first'
    if role == "button" and text and len(text)<80:
        return f'page.get_by_role("button", name="{_q(text)}", exact=True)'
    if role == "link" and text and len(text)<80:
        if text in _NAV: return f'page.get_by_role("button", name="{_q(text)}", exact=True)'
        return f'page.get_by_role("link", name="{_q(text)}", exact=True).locator("visible=true").first'
    if role in ("menuitem","menuitemcheckbox","menuitemradio","tab","treeitem") and text:
        return f'page.get_by_role("{role}", name="{_q(text)}")'
    if role == "checkbox":
        n = label or text
        if n: return f'page.get_by_role("checkbox", name="{_q(n)}", exact=True)'
    if role == "radio":
        n = label or text
        if n: return f'page.get_by_role("radio", name="{_q(n)}", exact=True)'
    if ph and len(ph)<100: return f'page.get_by_placeholder("{_q(ph)}")'
    # el_id: ONLY use for short stable IDs — never Oracle dynamic IDs
    if el_id and len(el_id) < 60 and "::" not in el_id and not el_id.startswith("_FO") \
            and not re.search(r":[0-9]+:", el_id) and not re.search(r"[0-9]{4,}", el_id):
        # Escape pipe characters in ID selector (Oracle ADF uses | in IDs)
        escaped_id = el_id.replace('|', '\\|')
        return f'page.locator("#{_q(escaped_id)}")'
    if text and len(text)<60 and "\n" not in text:
        return f'page.get_by_text("{_q(text)}", exact=True)'
    return None

# Alias for import
build_locator = _build_locator

def _make_comment(info, value=""):
    # label   = (info.get("label")  or "").strip()
    # role    = (info.get("role")   or "").strip()
    # text    = (info.get("text")   or "").strip()
    _raw_label = info.get("label") or ""
    # Strip Oracle JET KnockoutJS/VB binding expressions e.g. [[$flow.translations.resourceBundle['dateHeader']]]
    _raw_label = re.sub(r'\[\[.*?\]\]', '', _raw_label, flags=re.DOTALL).strip()
    _raw_label = re.sub(r'<!--.*?-->', '', _raw_label, flags=re.DOTALL).strip()
    _raw_label = re.sub(r'\{\{.*?\}\}', '', _raw_label, flags=re.DOTALL).strip()
    _raw_label = ' '.join(_raw_label.split())
    # Fallback to title then text if label stripped to empty
    if not _raw_label:
        _raw_label = info.get("title") or info.get("text") or ""
        _raw_label = re.sub(r'\[\[.*?\]\]', '', _raw_label, flags=re.DOTALL).strip()
    label   = _clean_special_chars(_raw_label)
    text    = _clean_special_chars(info.get("text")   or "")
    title   = _clean_special_chars(info.get("title")  or "")
    role    = (info.get("role")   or "").strip()
    el_type = (info.get("type")   or "").strip().lower()
    tag     = (info.get("tag")    or "").strip().upper()
    evt     = info.get("evt","")
    key     = info.get("key","")

    if not role:
        if tag=="BUTTON" or el_type in ("button","submit","reset"): role="button"
        elif tag=="A": role="link"
        elif el_type in ("checkbox","radio"): role=el_type
        elif tag in ("INPUT","TEXTAREA"): role="textbox"
        elif tag=="SELECT": role="combobox"

    is_pwd = el_type=="password" or "password" in label.lower()
    safe_v = "****" if is_pwd and value else value
    display = label or text or title

    # if evt=="fill":
    #     if label.lower()=="username": return f"# Enter username: {value}"
    #     if is_pwd: return "# Enter password"
    #     if role=="spinbutton": return f"# Set {label}: {value}"
    #     if role=="datagrid_combobox":
    #         _dg_r = info.get("dgRow", -1)
    #         _row_hint = f" (row {_dg_r})" if _dg_r is not None and int(_dg_r) >= 0 else ""
    #         return f"# Fill '{label}' column{_row_hint}: '{safe_v}'"
    #     if role=="combobox": return f"# Type '{value}' into '{display}' dropdown"
    #     return f'# Fill \'{display}\' with "{safe_v}"'

    if evt=="fill":
        if label.lower()=="username": return f"# Enter username: {value}"
        if is_pwd: return "# Enter password"
        if role=="spinbutton": return f"# Set {label}: {value}"
        # Unified format: "Fill '[value]' into '[label]'" for all fill types.
        # Removes the "dropdown" suffix from combobox fills and makes date fills
        # consistent with text field fills.
        return f"# Fill '{safe_v}' into '{display}'"
    if evt=="keydown":
        if key=="ControlOrMeta+a": return f"# Select all in '{label}'"
        if role=="combobox": return f"# Confirm '{display}' with {key}"
        return f"# Press {key} in '{display}' field"
    if evt=="select":
        return f"# Select option: '{info.get('selectedText') or value}' in '{display}'"
    if evt=="check":
        return f"# {'Check' if info.get('checked') else 'Uncheck'}: '{display}'"
    if evt=="click":
        if role=="date_trigger":
            if label:
                return f"# Click on '{label}' date picker (Select Date)"
            return "# Click date picker (Select Date)"
        if role in ("adf_drop","adf_lov"): return f"# Open dropdown: '{display}'"
        if role=="button": return f"# Click button: '{text or label or display}'"
        _NAV = {"Next","Save","Back","Cancel","OK","Apply","Submit","Previous","Finish","Done","Search","Confirm"}
        if role=="link" and (text or label) in _NAV: return f"# Click button: '{text or label or display}'"
        if role=="link": return f"# Click link: '{text or label or display}'"
        if role == "option":
            _dg_col = (info.get("dgCol") or "").strip()
            if _dg_col:
                return f"# Select '{text or display}' in '{_dg_col}' column"
            _drop = (info.get("dropLbl") or display).strip()
            return f"# Select option: '{text or display}' in '{_drop}'" if _drop else f"# Select option: '{text or display}'"
        if role in ("menuitem","menuitemcheckbox","menuitemradio","lov_row","cell"): return f"# Select: '{text or display}'"
        if role=="gridcell":
            t=text.strip()
            if info.get("todayNum") and t==info.get("todayNum"): return "# Select today's date in calendar"
            if t==".": return "# Select today's date in calendar"
            return f"# Select date: '{t}' in calendar"
        if role=="spinbutton": return f"# Click {label} in date picker"
        if role=="tab": return f"# Click tab: '{display}'"
        if role in ("checkbox","radio"): return f"# Toggle {role}: '{display}'"
        if role=="textbox":
            if label.lower()=="username": return "# Click Username field"
            if label.lower()=="password": return "# Click Password field"
            return f"# Click into '{label}' field"
        if role=="combobox": return f"# Open dropdown: '{display}'"
        if role=="tile": return f"# Click tile/menu: '{title or label or text}'"
        if title: return f"# Click tile/menu: '{title}'"
        return f"# Click: '{display}'"
    return ""

# Alias for import
make_comment = _make_comment
