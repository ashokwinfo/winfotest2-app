"""
session_manager.py  –  Winfo Test 2.0 Recording Service

Preserves all business logic from the monolithic session_manager.py:
- CDP-based Chrome launch (non-headless, shows on Windows desktop via WSLg DISPLAY=:0)
- Full _RECORDER_JS with Oracle Redwood / ADF event capture
- _GRID_AWARE_DROPDOWN_JS for DataGrid LOV tracking
- _LOV_SNAPSHOT_JS / _LOV_CHANGED_JS for dependent-field detection
- _process_event() with grid_dropdown_select handling
- _deduplicate() and _merge_dropdown_steps()
- WebSocket broadcaster for live step streaming
"""
from __future__ import annotations
import asyncio, json, os, re, shutil, subprocess, time, uuid
from datetime import datetime, timezone
from typing import Optional

import structlog
from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

from app.models.domain import WSMessage
from app.websockets.recording_ws_handler import ws_manager
from app.utils.settings import settings

log = structlog.get_logger(__name__)

# ── JS: LOV dependent-field detection ────────────────────────────────────────
_LOV_SNAPSHOT_JS = r"""
() => {
    var snap = {};
    var els = document.querySelectorAll(
        'input[type="text"], input:not([type]), textarea, [role="combobox"], [role="textbox"]'
    );
    for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        var id = el.id || el.name || (el.getAttribute("aria-label") || "") + "_" + i;
        snap[id] = el.value || el.textContent || "";
    }
    return snap;
}
"""

_LOV_CHANGED_JS = r"""
(snapshot) => {
    var els = document.querySelectorAll(
        'input[type="text"], input:not([type]), textarea, [role="combobox"], [role="textbox"]'
    );
    for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var r = el.getBoundingClientRect();
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

# ── JS: Grid-aware dropdown tracking ─────────────────────────────────────────
_GRID_AWARE_DROPDOWN_JS = r"""
(function(){
    if(window.__pwGridTracking) return;
    window.__pwGridTracking = true;

    var _activeGridRow = -1;
    var _activeGridCol = '';
    var _pendingDropdownValue = '';
    var _dropdownConfirmed = false;

    document.addEventListener('focus', function(e) {
        var el = e.target;
        var cell = el.closest && el.closest('[role="gridcell"], .oj-datagrid-data-cell, .oj-datagrid-cell');
        if (!cell) return;
        var rowIdx = -1;
        var row = cell.closest('[role="row"], tr');
        if (row) {
            var rows = row.parentElement ? Array.from(row.parentElement.children) : [];
            rowIdx = rows.indexOf(row);
        }
        var ojSelEl = el.closest('oj-select-single,oj-input-text,oj-input-number,oj-input-date');
        if (ojSelEl && ojSelEl.id) {
            var _rm = ojSelEl.id.match(/^(\d+)_(?:afc|df_fc|anffc)_row_/);
            if (_rm) rowIdx = parseInt(_rm[1], 10);
        }
        if (cell && cell.style && cell.style.top && rowIdx < 0) {
            var _ct = parseInt(cell.style.top, 10);
            if (!isNaN(_ct) && _ct >= 0) rowIdx = Math.round(_ct / 27);
        }
        var colLabel = '';
        var grid = cell.closest('[data-oj-container="ojDataGrid"], .oj-datagrid');
        if (ojSelEl && grid) {
            var lh = (ojSelEl.getAttribute('label-hint') || '').trim();
            if (lh) {
                var hdrs = grid.querySelectorAll(
                    '.oj-datagrid-column-header-frozen .oj-datagrid-column-header-cell,' +
                    '.oj-datagrid-header-frozen .oj-datagrid-column-header-cell'
                );
                for (var hi = 0; hi < hdrs.length; hi++) {
                    var ht = (hdrs[hi].textContent || '').trim().replace(/[*:\s]+$/, '').trim();
                    if (ht && lh.toLowerCase() === ht.toLowerCase()) { colLabel = ht; break; }
                }
                if (!colLabel) colLabel = lh.split(' ')[0].trim();
            }
        }
        if (!colLabel && grid) {
            var colIdx = Array.from(cell.parentElement.children).indexOf(cell);
            if (colIdx >= 0) {
                var headers = grid.querySelectorAll('.oj-datagrid-column-header-cell, [role="columnheader"]');
                if (headers[colIdx]) colLabel = (headers[colIdx].textContent || '').trim().replace(/[*:]$/, '').trim();
            }
        }
        if (!colLabel) return;
        _activeGridRow = rowIdx;
        _activeGridCol = colLabel;
    }, true);

    var originalRecord = window.__pwRecord;
    window.__pwRecord = function(dataStr) {
        var data = JSON.parse(dataStr);
        if (data.evt === 'click' && data.role === 'option' && _activeGridRow >= 0) {
            var merged = {
                evt: 'grid_dropdown_select',
                row: _activeGridRow,
                col: _activeGridCol,
                typed: _pendingDropdownValue,
                selected: data.text || '',
                is_first_empty: false
            };
            _dropdownConfirmed = true;
            return originalRecord(JSON.stringify(merged));
        }
        return originalRecord(dataStr);
    };
})();
"""
_RECORDER_JS = r"""
(function(){
  if(window.__pwRecActive) return;
  window.__pwRecActive = true;

  var MONTH_NAMES=['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];
  var SUPPRESS_TITLES=['Select Date','Select Date.','Previous Month','Next Month','Select Month','Select Year'];
  var _fillTimers={}, _pendingFill={}, _lastSelectTs={};
  var _lastDataGridCol='';  // tracks last clicked OJ DataGrid column label
  var _lastDataGridRow=-1;   // tracks last clicked OJ DataGrid row index
  var _dateTriggerCount=0;

  // ── Helpers (defined before use) ─────────────────────────────────────────

  function findComboboxAncestor(el) {
      var p = el;
      while (p && p !== document.body) {
          var r = p.getAttribute && p.getAttribute('role');
          if (r === 'combobox') return p;
          p = p.parentElement;
      }
      return null;
  }

  function getDropdownLabel(el) {
      var lbl = getLabel(el);
      if (lbl) return lbl;
      if (el.tagName && el.tagName.toLowerCase() === 'button') {
          var txt = (el.innerText || el.textContent || '').trim();
          if (txt && txt.length < 60) return txt;
      }
      var p = el.parentElement;
      for (var d=0; d<6 && p && p!==document.body; d++) {
          lbl = getLabel(p);
          if (lbl) return lbl;
          p = p.parentElement;
      }
      var container = el.closest && el.closest('.oj-form-control, .oj-field, .oj-input-group, .oj-select, .oj-combobox');
      if (container) {
          var input = container.querySelector('input[type="text"], input:not([type]), [role="combobox"]');
          if (input) return getLabel(input);
      }
      return '';
  }

  function isDropdownTrigger(el) {
      var role = el.getAttribute && el.getAttribute('role');
      var hasPopup = el.getAttribute && el.getAttribute('aria-haspopup');
      var classes = (el.className || '').toString();
      var tag = (el.tagName || '').toLowerCase();
      if (role === 'combobox') return true;
      if (hasPopup && hasPopup !== 'false') return true;
      if (classes.indexOf('oj-select-open-icon') >= 0 ||
          classes.indexOf('oj-combobox-open-icon') >= 0 ||
          classes.indexOf('oj-searchselect-arrow') >= 0) return true;
      if (tag === 'button') {
          var label = el.getAttribute('aria-label') || el.innerText || '';
          if (label && (label.toLowerCase().indexOf('select') >= 0 ||
                        label.toLowerCase().indexOf('dropdown') >= 0 ||
                        label.toLowerCase().indexOf('open') >= 0)) return true;
      }
      var p = el.parentElement;
      for (var d = 0; d < 8 && p && p !== document.body; d++) {
          role = p.getAttribute && p.getAttribute('role');
          hasPopup = p.getAttribute && p.getAttribute('aria-haspopup');
          if (role === 'combobox' || (hasPopup && hasPopup !== 'false')) return true;
          p = p.parentElement;
      }
      return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 1: getLabel — for <input role="combobox">, skip aria-label because
  // Redwood sets it to the CURRENTLY SELECTED VALUE (e.g. "206.74 Printers",
  // "Ca", "USD"), not the field label. Instead walk up to the parent oj-*
  // custom element and read its label-hint attribute.
  // ─────────────────────────────────────────────────────────────────────────
  // ── OJ DataGrid column header label ─────────────────────────────────────
  function getDataGridColLabel(el) {
    // Walk up to find the datagrid data cell
    var cell = el.closest && el.closest('[role="gridcell"], .oj-datagrid-data-cell, td.oj-datagrid-cell');
    if (!cell) return '';
    // Get column index from aria-colindex or data-oj-key or position
    var colIdx = cell.getAttribute('aria-colindex');
    if (colIdx !== null) colIdx = parseInt(colIdx) - 1; // aria-colindex is 1-based
    if (colIdx === null || isNaN(colIdx)) {
      // Try position in row
      var row = cell.parentElement;
      if (row) { var cells = row.querySelectorAll('[role="gridcell"],.oj-datagrid-data-cell'); colIdx = Array.from(cells).indexOf(cell); }
    }
    if (colIdx === null || colIdx < 0) return '';
    // Find all column header cells at same index
    var grid = cell.closest('[data-oj-container="ojDataGrid"], .oj-datagrid');
    if (!grid) return '';
    var hdrs = grid.querySelectorAll('.oj-datagrid-column-header-cell, [role="columnheader"]');
    var hdr = hdrs[colIdx] || null;
    if (!hdr) return '';
    // Extract text, stripping KO binding comments and whitespace
    return (hdr.textContent || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\[\[[\s\S]*?\]\]/g, '').trim().replace(/\s+/g,' ');
  }

  // Strip Oracle JET KO/VB binding expressions from any label string
  function cleanLabel(lbl) {
    if (!lbl) return '';
    var s = lbl;
    s = s.replace(/\[\[[\s\S]*?\]\]/g, '');   // [[...]] VB/KO expressions
    s = s.replace(/<!--[\s\S]*?-->/g, '');        // <!-- KO comment blocks -->
    s = s.replace(/\{\{[\s\S]*?\}\}/g, '');     // {{...}} handlebars
    s = s.replace(/\s+/g, ' ').trim();
    // Strip trailing punctuation Oracle adds: "Date." -> "Date"
    s = s.replace(/\.+$/, '').trim();
    return s;
  }

  function getLabel(el){
    if(!el||!el.getAttribute) return '';

    // OJ DataGrid cell — find column header label
    var _dgLbl = getDataGridColLabel(el);
    if (_dgLbl) return cleanLabel(_dgLbl);

    var _tag  = (el.tagName || '').toLowerCase();
    var _role = (el.getAttribute('role') || '');

    // Combobox inputs in Redwood carry the selected VALUE in aria-label, not the label.
    // Skip aria-label for them and go straight to the parent walk.
    var _isComboInput = (_tag === 'input') &&
                        (_role === 'combobox' ||
                         (el.getAttribute('aria-haspopup') || '') !== '');

    if (!_isComboInput) {
      var v = el.getAttribute('aria-label');
      if (v) return v.trim();
    }

    // aria-labelledby (works across shadow root boundaries)
    var lid = el.getAttribute('aria-labelledby');
    if (lid) {
      var pts = [];
      lid.split(' ').forEach(function(id) {
        var root = el.getRootNode && el.getRootNode();
        var e = (root && root.getElementById) ? root.getElementById(id) : null;
        if (!e) e = document.getElementById(id);
        if (e) { var _ct = cleanLabel(e.textContent.trim()); if (_ct) pts.push(_ct); }
      });
      if (pts.length) return pts.join(' ').trim();
    }

    // label[for=id]
    if (el.id) {
      var lf = document.querySelector('label[for="' + el.id + '"]');
      if (lf) return lf.textContent.trim();
    }

    // Walk up DOM — crossing shadow root boundaries and checking oj-* label-hint
    var p = el.parentElement;
    for (var d = 0; d < 12 && p && p !== document.body; d++) {
      var _ptag = (p.tagName || '').toLowerCase();

      // Redwood: oj-select-single / oj-combobox-one / oj-input-text etc.
      // carry the real field label in label-hint, not in aria-label.
      if (_ptag.indexOf('oj-') === 0) {
        var _lh = p.getAttribute('label-hint') || '';
        if (_lh) return _lh.trim();
        // aria-label on the oj-* host itself (only use if not the current value)
        var _pha = p.getAttribute('aria-label') || '';
        if (_pha) return _pha.trim();
      }

      var a = p.getAttribute && p.getAttribute('aria-label');
      if (a) return a.trim();

      var ls = p.querySelectorAll(
        ':scope > label,' +
        ':scope > .oj-label,' +
        ':scope > .oj-label-group > label,' +
        ':scope > .oj-label-group > .oj-label,' +
        ':scope > .oj-label-value > label,' +
        ':scope > .oj-label-value > .oj-label,' +
        ':scope > .oj-form-control-label > label'
      );
      if (ls.length === 1) return ls[0].textContent.trim();

      // Cross shadow root boundary upward if needed
      if (!p.parentElement) {
        var rt = p.getRootNode && p.getRootNode();
        if (rt && rt.host) { p = rt.host; continue; }
        break;
      }
      p = p.parentElement;
    }

    // Last resort for combobox inputs: return aria-label even though it may be
    // the selected value — better than returning empty and losing the step.
    if (_isComboInput) {
      var v2 = el.getAttribute('aria-label');
      if (v2) return v2.trim();
    }

    // If the menu item is visible text only, use that as a label too.
    var visibleText = (el.innerText || el.textContent || '').trim().replace(/\s+/g,' ');
    if (visibleText && visibleText.length < 100) return visibleText;

    return _stripCurrencySuffix((el.getAttribute && el.getAttribute('placeholder')) || el.name || '');
  }

  function getDateFieldLabel(el){
    // Walk up from the date trigger icon to find the field label.
    // Also check oj-input-date host element's label-hint (Redwood).
    var p=el.parentElement;
    for(var d=0;d<12&&p&&p!==document.body;d++){
      var _ptag=(p.tagName||'').toLowerCase();
      // Redwood: oj-input-date carries label-hint
      if(_ptag==='oj-input-date'||_ptag==='oj-input-date-time'||_ptag==='oj-date-picker'){
        var _lh=p.getAttribute('label-hint')||'';
        if(_lh&&SUPPRESS_TITLES.indexOf(_lh)<0) return _lh;
      }
      var inputs=p.querySelectorAll('input[type="text"],input[aria-label],input[aria-labelledby],[role="combobox"]');
      for(var i=0;i<inputs.length;i++){
        var l=getLabel(inputs[i]);
        if(l&&SUPPRESS_TITLES.indexOf(l)<0) return l;
      }
      var a=p.getAttribute&&p.getAttribute('aria-label');
      if(a&&SUPPRESS_TITLES.indexOf(a)<0) return a;
      // Also check label-hint on any oj-* parent
      if(_ptag.indexOf('oj-')===0){
        var _lh2=p.getAttribute('label-hint')||'';
        if(_lh2&&SUPPRESS_TITLES.indexOf(_lh2)<0) return _lh2;
      }
      p=p.parentElement;
    }
    return '';
  }

  function resolveADFSuffix(el){
    var id=el.id||'';
    var MAP={'::drop':'adf_drop','::glyph':'date_trigger','::lovIconId':'adf_lov','::lovIcon':'adf_lov','::icon':'adf_drop','::btn':'adf_drop'};
    var sfx='', role='';
    for(var s in MAP){if(id.endsWith(s)){sfx=s;role=MAP[s];break;}}
    if(!sfx) return null;
    var base=id.slice(0,id.length-sfx.length);
    var tries=['::lovInput','::content','|input',''];
    for(var j=0;j<tries.length;j++){
      var fe=document.getElementById(base+tries[j]);
      if(fe&&fe!==el){var lbl=getLabel(fe);if(lbl)return {label:lbl,role:role,id:id};}
    }
    var lbl=getLabel(el.parentElement)||'';
    return lbl?{label:lbl,role:role,id:id}:null;
  }

  function isInsidePopup(el){
    // ROOT-FIX-3: expanded to catch Oracle Fusion DataGrid inline dropdowns.
    // These render in various containers that weren't in the original list.
    var p=el;
    while(p&&p!==document.body){
      var r=p.getAttribute&&p.getAttribute('role')||'';
      if(r==='listbox'||r==='dialog'||r==='option') return true;
      var _pt=(p.tagName||'').toLowerCase();
      if(_pt==='oj-option'||_pt==='oj-list-item'||_pt==='oj-select-results-list') return true;
      var c=(p.className||'').toString();
      if(c.indexOf('oj-listbox-drop')>=0||c.indexOf('oj-listbox-searchselect')>=0||
         c.indexOf('af_popup')>=0||c.indexOf('oj-popup')>=0||
         c.indexOf('af_selectItem')>=0||c.indexOf('oj-select-drop')>=0||
         c.indexOf('oj-combobox-drop')>=0||c.indexOf('oj-searchselect-drop')>=0||
         c.indexOf('oj-listview-container')>=0||
         // Oracle Fusion DataGrid inline combobox results:
         c.indexOf('oj-searchselect-results')>=0||
         c.indexOf('oj-complete-list')>=0||
         c.indexOf('oj-listbox-results')>=0||
         c.indexOf('oj-select-results')>=0) return true;
      p=p.parentElement;
    }
    return false;
  }

  function flushAllFills(){
    var keys=Object.keys(_pendingFill);
    for(var i=0;i<keys.length;i++){
      var k=keys[i];
      if(_fillTimers[k]) clearTimeout(_fillTimers[k]);
      delete _fillTimers[k];
      var d=_pendingFill[k]; delete _pendingFill[k];
      if(d) window.__pwRecord(JSON.stringify(d));
    }
  }

  // ── Click handler ─────────────────────────────────────────────────────────
  document.addEventListener('click', function(e){
    // Track OJ DataGrid cell clicks — popup inputs won't be inside the grid DOM
    // FIX-A: Exclude OJ calendar day cells from _clickedCell.
    // Calendar popup cells also use role="gridcell" but live inside
    // .oj-datepicker / oj-date-picker, NOT inside .oj-datagrid.
    // Without this guard the date cell click is swallowed by the
    // datagrid tracking block before data-handler='selectDay' is reached.
    var _inDatePickerPopup = !!(e.target && e.target.closest && (
      e.target.closest('.oj-datepicker') ||
      e.target.closest('.oj-datepicker-calendar') ||
      e.target.closest('oj-date-picker') ||
      e.target.closest('td[data-handler="selectDay"]') ||
      e.target.closest('a[data-handler="selectDay"]')
    ));
    var _clickedCell = !_inDatePickerPopup && e.target && e.target.closest && (
      e.target.closest('.oj-datagrid-data-cell') ||
      e.target.closest('[role="gridcell"]')
    );
    // Suppress ALL non-actionable clicks inside the datagrid or its popups
    var _inDataGrid = e.target.closest && (
      e.target.closest('[data-oj-container="ojDataGrid"]') ||
      e.target.closest('.oj-datagrid') ||
      e.target.closest('.oj-listbox') ||
      e.target.closest('.oj-popup') ||
      e.target.closest('.oj-select-results')
    );
    if (_clickedCell) {
      var _row = _clickedCell.parentElement;
      var _cellIdx = _row ? Array.from(_row.querySelectorAll('[role="gridcell"],.oj-datagrid-data-cell')).indexOf(_clickedCell) : -1;
      var _rowIdx = -1;
      if (_row) {
        // Find row index by vertical position — more reliable than DOM order
        // Collect all sibling rows and sort by Y to get visual row order
        var _parent = _row.parentElement || _row.closest('.oj-datagrid-data-body');
        var _allRows = _parent ? Array.from(_parent.querySelectorAll('[role="row"],.oj-datagrid-row,.oj-datagrid-data-row')) : [];
        if (_allRows.length === 0 && _parent) {
          // Try children directly
          _allRows = Array.from(_parent.children).filter(function(c){ return c.querySelectorAll('[role="gridcell"],.oj-datagrid-data-cell').length > 0; });
        }
        // Sort by top position
        var _sorted = _allRows.slice().sort(function(a,b){ return (a.getBoundingClientRect().top) - (b.getBoundingClientRect().top); });
        _rowIdx = _sorted.indexOf(_row);
        if (_rowIdx < 0) _rowIdx = _allRows.indexOf(_row);
      }
      var _grid = _clickedCell.closest('[data-oj-container="ojDataGrid"], .oj-datagrid');
      if (_grid && _cellIdx >= 0) {
        var _hdrs = _grid.querySelectorAll('.oj-datagrid-column-header-cell, [role="columnheader"]');
        var _hdr = _hdrs[_cellIdx] || null;
        if (_hdr) {
          _lastDataGridCol = cleanLabel((_hdr.textContent || '').trim().replace(/[\s]+/g,' '));
          _lastDataGridRow = _rowIdx;
        }
      }
      return; // suppress cell click from being recorded
    } else if (_inDataGrid) {
      // FIX-A: allow option/popup clicks through even when _inDataGrid is true.
      // Grid dropdowns (.oj-listbox-drop etc.) render OUTSIDE the grid DOM but
      // _inDataGrid matched them via .oj-listbox/.oj-popup — causing early return
      // before isInsidePopup() could record the option selection.
      var _tTag = (e.target.tagName||'').toLowerCase();
      var _tRole = e.target.getAttribute ? (e.target.getAttribute('role')||'') : '';
      var _isAction = (_tTag==='button'||_tTag==='a'||
                       _tRole==='button'||_tRole==='link'||_tRole==='menuitem'||
                       // CRITICAL: allow option clicks (grid dropdown selection)
                       _tRole==='option'||_tRole==='row'||_tRole==='gridcell'||
                       isInsidePopup(e.target));
      if (!_isAction) return; // suppress non-actionable clicks inside grid
    } else if (!e.target.closest(
      '[data-oj-container="ojDataGrid"],.oj-datagrid,.oj-popup,.oj-listbox,.oj-select,' +
      // FIX3a: also keep grid context during dropdown option selection —
      // these popups appear OUTSIDE the grid DOM but are opened BY grid cells.
      '.oj-listbox-drop,.oj-combobox-drop,.oj-searchselect-drop,' +
      '.oj-select-results,[role="listbox"],[role="option"]'
    )) {
      _lastDataGridCol = '';
      _lastDataGridRow = -1;
    }
    var orig=e.target;

    // ADF LOV table row
    var lovAnc=orig;
    while(lovAnc&&lovAnc!==document.body){
      var lid=lovAnc.id||'';
      if(lid.endsWith('::db')||lid.indexOf('afrLovInternalTableId')>=0){
        var td=orig;
        while(td&&td!==lovAnc){var tt=(td.tagName||'').toLowerCase();if(tt==='td')break;td=td.parentElement;}
        if(!td||td===lovAnc) td=orig;
        var cellTxt=(td.innerText||td.textContent||'').trim().replace(/\s+/g,' ').substring(0,80);
        window.__pwRecord(JSON.stringify({evt:'click',tag:'td',type:'',role:'lov_row',label:'',text:cellTxt,id:'',title:'',href:'',placeholder:'',name:''}));
        return;
      }
      lovAnc=lovAnc.parentElement;
    }

    // Oracle Redwood nav tile: <a href="#" title="X"> — walk up from click target
    var _anc=orig;
    while(_anc&&_anc!==document.body){
      var _at=(_anc.tagName||'').toLowerCase();
      if(_at==='a'){
        var _aTitle=(_anc.getAttribute&&_anc.getAttribute('title'))||'';
        var _aHref=(_anc.getAttribute&&_anc.getAttribute('href'))||'';
        var _aOnclick=(_anc.getAttribute&&_anc.getAttribute('onclick'))||'';

        // ── CALENDAR TRIGGER DETECTION (must run BEFORE tile detection) ──
        // Oracle Fusion VB apps set title='[[$flow...dateHeader...]]' on the
        // calendar icon.  That raw title is truthy and would be mis-recorded as
        // a nav tile because _aTitle !== 'Select Date'.  Detect it first.
        var _aHasBinding = (_aTitle.indexOf('[[')>=0 && _aTitle.indexOf(']]')>=0);
        var _aIsCalendar = (_aTitle==='Select Date') ||
            (_aHasBinding && (
                _aTitle.indexOf('dateHeader')>=0 ||
                _aTitle.toLowerCase().indexOf('date')>=0 ||
                _aTitle.toLowerCase().indexOf('calendar')>=0
            )) ||
            !!(_anc.closest && (
                _anc.closest('oj-input-date') ||
                _anc.closest('oj-input-date-time') ||
                _anc.closest('oj-date-picker') ||
                _anc.closest('.oj-inputdatetime-input-wrap') ||
                _anc.closest('.oj-datepicker-trigger')
            ));
        if(_aIsCalendar){
          flushAllFills();
          var _nth0=_dateTriggerCount++;
          var _fl0=getDateFieldLabel(_anc);
          window.__pwRecord(JSON.stringify({evt:'click',role:'date_trigger',label:_fl0,nth:_nth0,id:_anc.id||'',tag:'a',type:'',text:'',title:'Select Date',href:'',placeholder:'',name:''}));
          return;
        }

        // ── NAV TILE DETECTION ────────────────────────────────────────────
        // Only treat as a tile when we have a clean, non-binding title.
                var _isDateTriggerTitle=(_aTitle==='Select Date'||_aTitle==='Select Date.'||_aTitle.startsWith('Select Date'));
        var _isTileAnc=!!(_aTitle && !_isDateTriggerTitle && (_aHref==='#' || _aHref==='' || _aHref==='javascript:void(0)' || _aOnclick.indexOf('this.focus()')>=0));
        if(_isTileAnc){
          flushAllFills();
          window.__pwRecord(JSON.stringify({evt:'click',tag:'a',type:'',role:'tile',label:_aTitle,text:_aTitle,id:_anc.id||'',title:_aTitle,href:'',placeholder:'',name:''}));
          return;
        }
        break;
      }
      var _ar=(_anc.getAttribute&&_anc.getAttribute('role'))||'';
      if(['input','select','textarea','button'].indexOf(_at)>=0) break;
      if(['button','combobox','textbox','listbox','option'].indexOf(_ar)>=0) break;
      _anc=_anc.parentElement;
    }

    var el=orig;
    for(var i=0;i<10&&el&&el!==document.body;i++){
      var t=(el.tagName||'').toLowerCase();
      var r=(el.getAttribute&&el.getAttribute('role'))||'';
      var elId=el.id||'';
      var resolved=resolveADFSuffix(el);
      if(resolved){
        flushAllFills();
        if(resolved.role==='date_trigger'){
          var nth=_dateTriggerCount++; var fl=getDateFieldLabel(el);
          window.__pwRecord(JSON.stringify({evt:'click',role:'date_trigger',label:fl,nth:nth,id:elId,tag:t,type:'',text:'',title:'Select Date',href:'',placeholder:'',name:''}));
        } else {
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:resolved.role,label:resolved.label,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));
        }
        return;
      }

      // Oracle JET Redwood: oj-searchselect-arrow / oj-combobox-open-icon
      var _elClass=(el.className||'').toString();
      if(_elClass.indexOf('oj-searchselect-arrow')>=0||_elClass.indexOf('oj-combobox-open-icon')>=0||_elClass.indexOf('oj-select-open-icon')>=0){
        flushAllFills();
        var _ojLbl=getLabel(el)||'';
        if(!_ojLbl){
          var _ojP=el.parentElement;
          for(var _ojD=0;_ojD<6&&_ojP&&_ojP!==document.body;_ojD++){
            _ojLbl=getLabel(_ojP)||'';
            if(_ojLbl) break;
            var _ojInputs=_ojP.querySelectorAll('input[type="text"],input:not([type]),[role="combobox"]');
            if(_ojInputs.length>0){_ojLbl=getLabel(_ojInputs[0])||'';if(_ojLbl)break;}
            _ojP=_ojP.parentElement;
          }
        }
        if(_ojLbl){
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'adf_drop',label:_ojLbl,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));
          return;
        }
      }

      if(t==='a'||r==='link'){
        flushAllFills();
        var dlTitle=cleanLabel((el.getAttribute&&el.getAttribute('title'))||'');
        var dlLabel=cleanLabel((el.getAttribute&&el.getAttribute('aria-label'))||'');
        // If the a-link has no title/aria-label, Oracle task buttons often keep the label
        // in a sibling title span inside the same tile wrapper.
        if(!dlTitle && !dlLabel && el.closest){
          var _tileAncestor = el.closest('.task-button, .tb-button, [class*="task-button"], [class*="tb-button"]');
          if(!_tileAncestor) _tileAncestor = el.closest('.partial-container, .text');
          if(_tileAncestor){
            // PRIORITY: find span.title ONLY (not .description) to avoid capturing
            // "Add Time Card Add a time card for a selected period" concatenation.
            var _titleNode = _tileAncestor.querySelector('span.title, div.title, .title:not(.description)');
            if(_titleNode){
              var _rawNear = (_titleNode.innerText || _titleNode.textContent || '').trim();
              var _firstLine2 = '';
              var _iLines2 = _rawNear.split('\n');
              for(var _li2=0;_li2<_iLines2.length;_li2++){var _lt2=_iLines2[_li2].trim();if(_lt2){_firstLine2=_lt2;break;}}
              if(!_firstLine2) _firstLine2=_rawNear;
              var _labelText = cleanLabel(_firstLine2.replace(/\s+/g,' ').substring(0,80));
              if(_labelText) dlTitle = _labelText;
            }
          }
        }
        // FIX1: Take only the FIRST non-empty line of innerText.
        // Oracle Fusion tiles contain heading + description on separate lines;
        // joining them produced "Add Time Card Add a time card for a selected period".
        var _rawInner = (el.innerText || el.textContent || '').trim();
        var _firstLine = '';
        var _iLines = _rawInner.split('\n');
        for(var _li=0;_li<_iLines.length;_li++){var _lt=_iLines[_li].trim();if(_lt){_firstLine=_lt;break;}}
        if(!_firstLine) _firstLine = _rawInner;
        var dlText=cleanLabel(_firstLine.trim().replace(/\s+/g,' ').substring(0,80));
        if(!dlText && dlTitle) dlText = dlTitle;
        // FIX2: Detect date triggers even when title is an unresolved VB/KO binding.
        // Oracle Fusion VB apps set title='[[$flow.translations.resourceBundle["dateHeader"]]]'
        // which cleanLabel strips to empty. Also check parent element + CSS class.
        var _rawTitle2 = (el.getAttribute && el.getAttribute('title')) || '';
        var _isDateTrigger = (dlTitle === 'Select Date' || dlTitle === 'Select Date.' || dlTitle.startsWith('Select Date')) ||
            (_rawTitle2.indexOf('dateHeader') >= 0) ||
            (_rawTitle2.indexOf('[[') >= 0 && (_rawTitle2.toLowerCase().indexOf('date') >= 0 || _rawTitle2.toLowerCase().indexOf('calendar') >= 0)) ||
            !!(el.closest && (el.closest('oj-input-date') || el.closest('oj-date-picker') || el.closest('oj-input-date-time')));
        if(!_isDateTrigger){
          // Also check for calendar icon CSS classes (Redwood uses oj-ux-ico-calendar)
          var _elCls2 = (el.className||'').toString();
          var _elParent2 = el.parentElement;
          var _parentCls2 = _elParent2 ? (_elParent2.className||'').toString() : '';
          _isDateTrigger = (_elCls2.indexOf('oj-ux-ico-calendar') >= 0 ||
                            _elCls2.indexOf('oj-inputdatetime-calendar-icon') >= 0 ||
                            _parentCls2.indexOf('oj-inputdatetime-calendar-icon') >= 0 ||
                            _parentCls2.indexOf('oj-datepicker-trigger') >= 0);
        }
        if(_isDateTrigger){
          var nth2=_dateTriggerCount++; var fl2=getDateFieldLabel(el);
          window.__pwRecord(JSON.stringify({evt:'click',role:'date_trigger',label:fl2,nth:nth2,id:elId,tag:t,type:'',text:'',title:'Select Date',href:'',placeholder:'',name:''}));
          return;
        }
        var dlHref=(el.getAttribute&&el.getAttribute('href'))||'';
        var dlOnclick=(el.getAttribute&&el.getAttribute('onclick'))||'';
        var isTile=!!(dlTitle && (dlHref==='#' || dlOnclick.indexOf('this.focus()')>=0 || dlOnclick.indexOf('focus()')>=0 || dlHref.indexOf('javascript:')>=0));
        // EXPANDED TILE DETECTION: Oracle tiles can have various patterns
        if(!isTile && dlTitle){
          // Check for Oracle JET tile patterns
          var _elCls = (el.className||'').toString();
          var _parentEl = el.parentElement;
          var _parentCls = _parentEl ? (_parentEl.className||'').toString() : '';
          var _hasTileClasses = (_elCls.indexOf('tile') >= 0 || _elCls.indexOf('card') >= 0 || _parentCls.indexOf('tile') >= 0 || _parentCls.indexOf('card') >= 0);
          var _hasDataAttrs = !!(el.getAttribute('data-tile') || el.getAttribute('data-navigation') || el.getAttribute('data-action'));
          var _isShortTitle = (dlTitle.length > 0 && dlTitle.length < 50 && dlTitle.split(' ').length <= 4);
          var _hasNavigation = !!(_hasTileClasses || _hasDataAttrs || _isShortTitle || dlHref.indexOf('/faces/') >= 0 || dlHref.indexOf('navigation') >= 0);
          if(_hasNavigation){
            isTile = true;
          }
        }
        if(isTile){
          if(isDropdownTrigger(el)){
            var _dLbl=getDropdownLabel(el)||dlTitle||'';
            if(_dLbl){window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'adf_drop',label:_dLbl,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));return;}
          }
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'tile',label:dlTitle,text:dlTitle,id:elId,title:dlTitle,href:'',placeholder:'',name:''}));
          return;
        }
        // Fallback: check for aria-label as tile identifier (some Oracle tiles use aria-label instead of title)
        var _isAriaTile = false;
        if(dlLabel && dlLabel.length > 0 && dlLabel.length < 80){
          // Use same expanded tile detection logic for aria-label
          var _elCls2 = (el.className||'').toString();
          var _parentEl2 = el.parentElement;
          var _parentCls2 = _parentEl2 ? (_parentEl2.className||'').toString() : '';
          var _hasTileClasses2 = (_elCls2.indexOf('tile') >= 0 || _elCls2.indexOf('card') >= 0 || _parentCls2.indexOf('tile') >= 0 || _parentCls2.indexOf('card') >= 0);
          var _hasDataAttrs2 = !!(el.getAttribute('data-tile') || el.getAttribute('data-navigation') || el.getAttribute('data-action'));
          var _isShortLabel = (dlLabel.length > 0 && dlLabel.length < 50 && dlLabel.split(' ').length <= 4);
          var _hasNavigation2 = !!(_hasTileClasses2 || _hasDataAttrs2 || _isShortLabel || dlHref.indexOf('/faces/') >= 0 || dlHref.indexOf('navigation') >= 0);
          _isAriaTile = _hasNavigation2 || (dlHref==='#' || dlOnclick.indexOf('this.focus()')>=0 || dlOnclick.indexOf('focus()')>=0 || dlHref.indexOf('javascript:')>=0 || !dlHref || dlHref==='' || dlHref==='javascript:void(0)');
        }
        if(_isAriaTile){
          if(isDropdownTrigger(el)){
            var _dLbl3=getDropdownLabel(el)||dlLabel||'';
            if(_dLbl3){window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'adf_drop',label:_dLbl3,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));return;}
          }
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'tile',label:dlLabel,text:dlLabel,id:elId,title:dlLabel,href:'',placeholder:'',name:''}));
          return;
        }
        if(dlTitle && (!dlHref || dlHref==='' || dlHref==='javascript:void(0)' || dlHref.indexOf('javascript:')>=0)){
          if(isDropdownTrigger(el)){
            var _dLbl2=getDropdownLabel(el)||dlTitle||'';
            if(_dLbl2){window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'adf_drop',label:_dLbl2,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));return;}
          }
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'tile',label:dlTitle,text:dlTitle,id:elId,title:dlTitle,href:'',placeholder:'',name:''}));
          return;
        }
        // FINAL TILE FALLBACK: Check for any element with title/label that looks like a tile
        if(dlTitle || dlLabel){
          var _finalLabel = dlTitle || dlLabel;
          var _elCls3 = (el.className||'').toString();
          var _parentEl3 = el.parentElement;
          var _parentCls3 = _parentEl3 ? (_parentEl3.className||'').toString() : '';
          var _hasTileClasses3 = (_elCls3.indexOf('tile') >= 0 || _elCls3.indexOf('card') >= 0 || _parentCls3.indexOf('tile') >= 0 || _parentCls3.indexOf('card') >= 0);
          var _hasDataAttrs3 = !!(el.getAttribute('data-tile') || el.getAttribute('data-navigation') || el.getAttribute('data-action'));
          var _isShortText = (_finalLabel.length > 0 && _finalLabel.length < 50 && _finalLabel.split(' ').length <= 4);
          var _isNavigationLink = (dlHref.indexOf('/faces/') >= 0 || dlHref.indexOf('navigation') >= 0 || dlHref.indexOf('task-flow') >= 0);
          if(_hasTileClasses3 || _hasDataAttrs3 || _isShortText || _isNavigationLink){
            if(isDropdownTrigger(el)){
              var _dLbl4=getDropdownLabel(el)||_finalLabel||'';
              if(_dLbl4){window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'adf_drop',label:_dLbl4,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));return;}
            }
            window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'tile',label:_finalLabel,text:_finalLabel,id:elId,title:_finalLabel,href:'',placeholder:'',name:''}));
            return;
          }
        }
        // OJ Redwood date picker cell — record date from cell data attributes
        // Oracle Fusion OJ uses different attributes depending on version:
        //   Classic JQuery UI:  data-handler="selectDay"
        //   OJ Redwood:        role="gridcell" inside [role="dialog"] / .oj-datepicker
        //   OJ Fusion VB:      td inside .oj-datepicker-calendar table, no data-handler
        var _ojDpCell = null;
        if (el.getAttribute && el.getAttribute('data-handler') === 'selectDay') _ojDpCell = el;
        if (!_ojDpCell && el.closest) _ojDpCell = el.closest('td[data-handler="selectDay"]');
        if (!_ojDpCell && el.parentElement && el.parentElement.getAttribute && el.parentElement.getAttribute('data-handler') === 'selectDay') _ojDpCell = el.parentElement;
        // OJ Redwood / Fusion: gridcell inside .oj-datepicker-calendar or oj-date-picker popup
        if (!_ojDpCell && el.closest) {
          _ojDpCell = el.closest('.oj-datepicker-calendar td, .oj-datepicker td, oj-date-picker td');
          if (!_ojDpCell) {
            var _dpDialog = el.closest('[role="dialog"] [role="gridcell"], .oj-popup-content [role="gridcell"]');
            if (_dpDialog) _ojDpCell = _dpDialog;
          }
          if (!_ojDpCell) {
            // Also match: plain td inside a calendar popup (no specific class)
            var _tdEl = el.closest && el.closest('td');
            if (_tdEl) {
              var _insideDpPopup = !!(
                _tdEl.closest('.oj-datepicker-month') ||
                _tdEl.closest('[data-oj-internal]') ||
                _tdEl.closest('oj-date-picker') ||
                _tdEl.closest('oj-input-date')
              );
              if (_insideDpPopup) _ojDpCell = _tdEl;
            }
          }
        }
        // FIX-B: When _ojDpCell resolved to an <a> (data-handler on <a>),
        // climb to the parent <td> which has data-month / data-year.
        if (_ojDpCell && (_ojDpCell.tagName||'').toLowerCase() === 'a') {
          _ojDpCell = (_ojDpCell.closest && _ojDpCell.closest('td[data-month]')) ||
                      (_ojDpCell.closest && _ojDpCell.closest('td')) ||
                      _ojDpCell.parentElement;
        }
        if (_ojDpCell) {
          var _day = (el.textContent || dlText || '').trim();
          var _dpVal = '';
          // Strategy 1: aria-label="April 25, 2026" on <td> — most reliable
          var _tdAriaLabel = _ojDpCell.getAttribute && _ojDpCell.getAttribute('aria-label');
          if (_tdAriaLabel) {
            var _dMatch = _tdAriaLabel.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
            if (_dMatch) {
              var _mIdx = MONTH_NAMES.indexOf(_dMatch[1]);
              if (_mIdx >= 0) _dpVal = (_mIdx+1) + '/' + _dMatch[2] + '/' + String(_dMatch[3]).slice(-2);
            }
          }
          // Strategy 2: data-month (0-indexed) + data-year
          var _rawMonth = _ojDpCell.getAttribute && _ojDpCell.getAttribute('data-month');
          var _rawYear  = _ojDpCell.getAttribute && _ojDpCell.getAttribute('data-year');
          if (!_dpVal && _rawMonth !== null && _rawYear && _day) {
            var _m = parseInt(_rawMonth) + 1;
            var _y = String(_rawYear).slice(-2);
            _dpVal = _m + '/' + _day + '/' + _y;
          }
          // Find the date input to get its label
          var _dpInput = document.querySelector('input.oj-inputdatetime-input[role="combobox"]') ||
                         document.querySelector('[id$="|input"][role="combobox"]') ||
                         document.querySelector('input[aria-haspopup="dialog"][role="combobox"]');
          var _dpLbl = 'Date';
          if (_dpInput) {
            // FIX2b: Use cleanLabel to strip KO/VB binding expressions from the date label.
            // Oracle Fusion VB apps may leave label text as [[...]] if the binding
            // hasn't resolved at the time of the click.
            var _lid = _dpInput.getAttribute('aria-labelledby') || _dpInput.getAttribute('aria-describedby') || '';
            if (_lid) {
              var _ldDesc = document.getElementById(_lid.split(' ')[0]);
              if (_ldDesc) _dpLbl = cleanLabel(_ldDesc.textContent.trim().replace(/\s*\*.*$/,'').trim());
            }
            // Try label-hint on parent oj-input-date (most reliable for Redwood)
            if (!_dpLbl) {
              var _ojDate = _dpInput.closest('oj-input-date, oj-input-date-time, oj-date-picker');
              if (_ojDate) _dpLbl = cleanLabel(_ojDate.getAttribute('label-hint') || '');
            }
            // Try label[for=id]
            if (!_dpLbl && _dpInput.id) {
              var _lFor = document.querySelector('label[for="' + _dpInput.id + '"]');
              if (_lFor) _dpLbl = cleanLabel(_lFor.textContent.trim().replace(/\s*\*.*$/,'').trim());
            }
            // Try getLabel which handles all Oracle labelling patterns
            if (!_dpLbl) _dpLbl = getLabel(_dpInput) || 'Date';
          }
          // If date was built from cell attributes, confirm with the input value too
          // (the input updates asynchronously; the cell-derived value is already correct)
          if (!_dpVal && _dpInput) _dpVal = _dpInput.value || '';
          // Normalise: ensure we have M/D/YY format
          if (_dpVal) {
            // Strip any 4-digit year to 2-digit to match Oracle display format
            _dpVal = _dpVal.replace(/(\d{1,2}\/\d{1,2}\/)\d{2}(\d{2})$/, '$1$2');
          }
          if (_dpVal && _dpLbl) {
            window.__pwRecord(JSON.stringify({evt:'fill',tag:'INPUT',type:'date',role:'date_input',label:_dpLbl,text:'',value:_dpVal,id:_dpInput?_dpInput.id:'',title:'',href:'',placeholder:'',name:''}));
          } else if (_dpVal) {
            window.__pwRecord(JSON.stringify({evt:'fill',tag:'INPUT',type:'date',role:'date_input',label:'Date',text:'',value:_dpVal,id:'',title:'',href:'',placeholder:'',name:''}));
          }
          return;
        }
        window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'link',label:dlLabel,text:dlText,id:elId,title:dlTitle,href:el.href||'',placeholder:'',name:''}));
        return;
      }

      // ── TILE DETECTION FOR NON-LINK ELEMENTS ──────────────────────────────────
      // Some Oracle tiles are div/span elements with titles but no href/onclick
      if(!r && (t==='div'||t==='span'||t==='section'||t==='article') && !title){
        var _tileTitle = cleanLabel((el.getAttribute&&el.getAttribute('title'))||'');
        var _tileLabel = cleanLabel((el.getAttribute&&el.getAttribute('aria-label'))||'');
        var _tileText = (_tileTitle || _tileLabel);
        if(_tileText && _tileText.length > 0 && _tileText.length < 80){
          // Check if this looks like a tile (short text, possibly clickable)
          var _hasClickHandler = !!(el.onclick || el.getAttribute('onclick') || el.getAttribute('data-action') || el.getAttribute('data-navigation'));
          var _isInTileContainer = !!(el.closest && (el.closest('[data-tile]') || el.closest('.tile') || el.closest('.card') || el.closest('[role="button"]')));
          if(_hasClickHandler || _isInTileContainer || _tileText.split(' ').length <= 4){
            window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'tile',label:_tileText,text:_tileText,id:elId,title:_tileText,href:'',placeholder:'',name:''}));
            return;
          }
        }
      }

      if(t==='button'||r==='button'||(el.type||'').toLowerCase()==='submit'){
        flushAllFills();
        var bText=(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').substring(0,60);
        var bLabel=(el.getAttribute&&el.getAttribute('aria-label'))||'';
        if(isDropdownTrigger(el)){
          var _dLbl3=getDropdownLabel(el)||bText||bLabel||'';
          if(_dLbl3){window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'button',role:'adf_drop',label:_dLbl3,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));return;}
        }
        window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'button',role:'button',label:bLabel,text:bText,id:elId,title:'',href:'',placeholder:'',name:''}));
        return;
      }

      if(r==='menuitem'||r==='menuitemcheckbox'||r==='menuitemradio'||r==='treeitem'){
        flushAllFills();
        var itemText=(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ');
        var itemLabel=getLabel(el)||itemText;
        if(itemLabel){
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:r,label:itemLabel,text:itemText,id:elId,title:title,href:'',placeholder:'',name:''}));
          return;
        }
      }

      // General dropdown trigger (divs, spans, etc.)
      if(isDropdownTrigger(el)){
        var _dLbl4=getDropdownLabel(el)||'';
        if(_dLbl4){
          flushAllFills();
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:'',role:'adf_drop',label:_dLbl4,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));
          return;
        }
      }

      // input[role="combobox"] — Redwood LOV input
      if(t==='input'&&(r==='combobox'||(el.getAttribute&&el.getAttribute('aria-controls')||'').indexOf('lovDropdown')>=0)){
        flushAllFills();
        var _inpLbl=getLabel(el)||'';
        if(_inpLbl){
          var _inpTyp=(el.type||'').toLowerCase();
          window.__pwRecord(JSON.stringify({evt:'click',tag:t,type:_inpTyp,role:'adf_drop',label:_inpLbl,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));
          return;
        }
      }

      if(['input','select','textarea'].includes(t)) break;
      if(['gridcell','spinbutton','combobox','checkbox','radio','tab','menuitem','menuitemcheckbox','menuitemradio','option'].includes(r)) break;
      if(t==='oj-option'||t==='oj-list-item') break;
      if(el.getAttribute&&el.getAttribute('aria-label')&&['cell','row','treeitem'].indexOf(r)<0) break;
      if(el.getAttribute&&el.getAttribute('title')&&SUPPRESS_TITLES.indexOf(el.getAttribute('title'))<0&&MONTH_NAMES.indexOf(el.getAttribute('title'))<0) break;
      el=el.parentElement;
    }

    if(!el||el===document.body) return;
    var tag=el.tagName.toLowerCase(), typ=(el.type||'').toLowerCase();
    var elId=el.id||'', role=(el.getAttribute&&el.getAttribute('role'))||'';
    var title=(el.getAttribute&&el.getAttribute('title'))||'';
    if(tag==='button'||tag==='a'||typ==='submit'||typ==='button'||role==='button'||role==='link') flushAllFills();
    if(title && MONTH_NAMES.indexOf(title)>=0) return;
    if(title==='Previous Month'||title==='Next Month'||title==='Select Month'||title==='Select Year') return;

    // Check popup BEFORE gridcell — Redwood LOV rows use gridcell/row inside a listbox
    if(isInsidePopup(el)){
        var _popTxt='';
        var _popRoot=el;
        for(var _pi=0;_pi<6&&_popRoot&&_popRoot!==document.body;_pi++){
            var _prt=(_popRoot.getAttribute&&_popRoot.getAttribute('role'))||'';
            var _ptag2=(_popRoot.tagName||'').toLowerCase();
            // Stop at any individual option container — gridcell/row (OJet Redwood),
            // option (ADF classic), or li (generic select lists)
            if(_prt==='gridcell'||_prt==='row'||_prt==='option'||_ptag2==='li') break;
            _popRoot=_popRoot.parentElement;
      }
      if(!_popRoot||_popRoot===document.body) _popRoot=el;
      // Strategy 1: primary line text (the option code/name, first div inside gridcell)
      // For UOM rows: "Ca" is in the first child div, "Case" + "Quantity" are secondary.
      // For Category rows: "Printers" is in oj-typography-body-sm (secondary label).
      // We prefer the PRIMARY line (first visible text block) when it's short and clean.
      var _primaryEl=_popRoot.querySelector&&_popRoot.querySelector(
        '.oj-listbox-result-label, .oj-select-item-label, [data-oj-vdom-template-root] span'
      );
      if(_primaryEl){
        var _pt2=(_primaryEl.innerText||_primaryEl.textContent||'').trim().replace(/\s+/g,' ');
        // Only use if it's a short clean value (not a long description)
        if(_pt2&&_pt2.length>=1&&_pt2.length<=60) _popTxt=_pt2;
      }
      // Strategy 2: oj-typography-body-sm = secondary label line (Category LOV uses this)
      // Use this ONLY when primary line has a price code prefix (e.g. "204.54 Printers")
      // In that case, secondary label has the clean name.
      if(!_popTxt||_popTxt.length<2){
        var _secEl=_popRoot.querySelector&&_popRoot.querySelector('.oj-typography-body-sm');
        if(_secEl) _popTxt=(_secEl.innerText||_secEl.textContent||'').trim().replace(/\s+/g,' ');
      }
      // Strategy 3: all direct <span> children — take the first non-empty one
      if(!_popTxt||_popTxt.length<2){
        var _spans=_popRoot.querySelectorAll&&_popRoot.querySelectorAll('span');
        for(var _si=0;_si<_spans.length;_si++){
          var _st=(_spans[_si].innerText||_spans[_si].textContent||'').trim();
          if(_st&&_st.length>=1&&_st.length<=60){_popTxt=_st;break;}
        }
      }
      // Strategy 4: fallback — use full row text, strip leading price code.
      // Guard: take only the FIRST non-empty line to prevent concatenated option text
      // (happens when _popRoot overshoots to a listbox container in ADF classic dropdowns).
      if(!_popTxt||_popTxt.length<2){
        var _popRaw=(el.getAttribute&&el.getAttribute('aria-label'))||'';
        if(!_popRaw){
          // Use innerText (preserves newlines) then take ONLY the first non-empty line
          var _rawLines=(_popRoot.innerText||_popRoot.textContent||'').split(/[\n\r]+/);
          var _firstLine='';
          for(var _li2=0;_li2<_rawLines.length;_li2++){
            var _ln=_rawLines[_li2].trim();
            if(_ln){_firstLine=_ln;break;}
          }
          _popRaw=_firstLine||(_popRoot.textContent||'').trim().replace(/\s+/g,' ');
        }
        _popTxt=_popRaw.replace(/^\d+[\.,]?\d*\s+/,'').substring(0,80).trim();
        if(!_popTxt||_popTxt.length<2) _popTxt=_popRaw.substring(0,80);
      }
      // Strategy 5: if text still contains price code, strip it
      if(_popTxt) _popTxt=_popTxt.replace(/^\d+[\.,]?\d*\s+/,'').trim()||_popTxt;

      if(_popTxt){
        // Find the field label via popup container so Python can synthesize the open step
        var _dropLbl='';
        var _pc=el;
        for(var _ci=0;_ci<25&&_pc&&_pc!==document.body;_ci++){
          var _dcid=_pc.getAttribute&&_pc.getAttribute('data-oj-containerid');
          if(_dcid){var _ai=document.getElementById(_dcid+'|input');if(_ai){_dropLbl=getLabel(_ai)||'';while(_dropLbl.length>0&&(_dropLbl[_dropLbl.length-1]==='*'||_dropLbl[_dropLbl.length-1]===':')){_dropLbl=_dropLbl.slice(0,-1).trim();}break;}}
          var _lvId=_pc.id||'';
          if(_lvId.indexOf('oj-searchselect-results-')===0){var _fid=_lvId.replace('oj-searchselect-results-','');var _ai2=document.getElementById(_fid+'|input');if(_ai2){_dropLbl=getLabel(_ai2)||'';while(_dropLbl.length>0&&(_dropLbl[_dropLbl.length-1]==='*'||_dropLbl[_dropLbl.length-1]===':')){_dropLbl=_dropLbl.slice(0,-1).trim();}break;}}
          _pc=_pc.parentElement;
        }
        flushAllFills();
        // FIX3b: attach grid column context to option pick so the runner knows
        // which column this dropdown selection belongs to.
        var _optDgCol = _lastDataGridCol || '';
        var _optDgRow = (_optDgCol) ? _lastDataGridRow : -1;
        window.__pwRecord(JSON.stringify({evt:'click',tag:tag,type:typ,role:'option',label:'',text:_popTxt,id:elId,title:'',href:'',placeholder:'',name:'',dropLbl:_dropLbl||_optDgCol,dgCol:_optDgCol,dgRow:_optDgRow}));
        return;
      }
    }

    if(role==='gridcell'){
      // ROOT-FIX-2: Detect Oracle JET/Fusion calendar day cells.
      // Emit a date_input fill event with the FULL date value (M/D/YY).
      var _gDay = (el.innerText||el.textContent||'').trim();
      // Cast wide net for datepicker containers — Oracle Fusion may use different
      // class names depending on version (ojInputDate, ojDatePicker, VB-generated).
      var _dpPopup = el.closest && (
        el.closest('.oj-datepicker-popup') ||
        el.closest('.oj-datepicker') ||
        el.closest('.oj-datepicker-calendar') ||
        el.closest('[class*="datepicker"]') ||
        el.closest('[role="dialog"]') ||
        el.closest('oj-date-picker') ||
        el.closest('oj-input-date') ||
        el.closest('oj-input-date-time')
      );
      // Also detect by: cell class, data-afr-adfday (ADF classic), or a child
      // <a data-handler='selectDay'> (jQuery UI / OJ classic calendar).
      var _hasSelectDayChild = !!(el.querySelector && el.querySelector('a[data-handler="selectDay"]'));
      var _isDateCell = !!_dpPopup ||
                        _hasSelectDayChild ||
                        !!(el.getAttribute && el.getAttribute('data-afr-adfday')) ||
                        (el.classList && (
                          el.classList.contains('oj-datepicker-days-cell') ||
                          el.classList.contains('oj-datepicker-days-cell-over') ||
                          el.classList.contains('oj-datepicker-current-day') ||
                          el.classList.contains('oj-datepicker-today')));

      if(_isDateCell && _gDay && /^\d{1,2}$/.test(_gDay)) {
        var _dateVal = '';

        // Strategy 1: aria-label on cell = full date e.g. 'April 25, 2026' or '4/25/2026'
        var _ariaLbl = (el.getAttribute && el.getAttribute('aria-label')) || '';
        if(_ariaLbl && /\d{4}/.test(_ariaLbl)) {
          try {
            var _parsedD = new Date(_ariaLbl);
            if(!isNaN(_parsedD.getTime())) {
              _dateVal = (_parsedD.getMonth()+1) + '/' + _parsedD.getDate() + '/' + String(_parsedD.getFullYear()).slice(-2);
            }
          } catch(e) {}
        }

        // Strategy 2: Read month + year from calendar header text e.g. 'April 2026'
        if(!_dateVal) {
          var _calRoot = _dpPopup || document.querySelector('.oj-datepicker-popup,.oj-datepicker');
          var _monthEl = _calRoot && (
            _calRoot.querySelector('.oj-datepicker-month') ||
            _calRoot.querySelector('[class*="datepicker-month"]') ||
            _calRoot.querySelector('[class*="datepicker-title"] span') ||
            _calRoot.querySelector('[class*="datepicker-title"]')
          );
          if(_monthEl) {
            var _hdr = (_monthEl.innerText||_monthEl.textContent||'').trim();
            var _MMAP = {January:1,February:2,March:3,April:4,May:5,June:6,
                         July:7,August:8,September:9,October:10,November:11,December:12};
            var _hdrM = _hdr.match(/(\w+)\s+(\d{4})/);
            if(_hdrM && _MMAP[_hdrM[1]]) {
              _dateVal = _MMAP[_hdrM[1]] + '/' + parseInt(_gDay) + '/' + String(_hdrM[2]).slice(-2);
            }
          }
        }

        // Strategy 3: data-month + data-year attributes (jQuery UI / ADF hybrid)
        if(!_dateVal) {
          var _cell = el.closest && el.closest('td[data-month]');
          if(!_cell && el.getAttribute('data-month') !== null) _cell = el;
          if(_cell) {
            var _rawM = _cell.getAttribute('data-month');
            var _rawY = _cell.getAttribute('data-year');
            if(_rawM !== null && _rawY) {
              _dateVal = (parseInt(_rawM)+1) + '/' + parseInt(_gDay) + '/' + String(_rawY).slice(-2);
            }
          }
        }

        if(!_dateVal) _dateVal = _gDay; // last resort: just the day number

        // Find the date input element to get its label
        var _dpInp = document.querySelector('input.oj-inputdatetime-input[role="combobox"]') ||
                     document.querySelector('[id$="|input"][role="combobox"]') ||
                     document.querySelector('input[aria-haspopup="dialog"][role="combobox"]');
        var _dpLblDate = 'Date';
        if(_dpInp) {
          var _ojDateHost = _dpInp.closest('oj-input-date,oj-input-date-time,oj-date-picker');
          _dpLblDate = (_ojDateHost && _ojDateHost.getAttribute('label-hint')) ||
                       getLabel(_dpInp) || 'Date';
          _dpLblDate = cleanLabel(_dpLblDate) || 'Date';
        }

        window.__pwRecord(JSON.stringify({
          evt:'fill', tag:'INPUT', type:'date', role:'date_input',
          label:_dpLblDate, text:'', value:_dateVal,
          id:_dpInp ? _dpInp.id : '', title:'', href:'',
          placeholder:'', name:''
        }));
        return;
      }

      // Non-date gridcell (OJ DataGrid, LOV table, etc.)
      var gText=(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').substring(0,20);
      window.__pwRecord(JSON.stringify({evt:'click',tag:tag,type:'',role:'gridcell',label:'',text:gText,todayNum:new Date().getDate().toString(),id:elId,title:'',href:'',placeholder:'',name:''}));
      return;
    }

    var isComboInput=['input','div','span'].includes(tag)&&role==='combobox';
    if(['input','textarea'].includes(tag)&&!['button','submit','reset','checkbox','radio'].includes(typ)&&!isComboInput) return;

    if(isComboInput||role==='combobox'){
      var _cbLbl=getLabel(el)||'';
      if(_cbLbl){
        flushAllFills();
        window.__pwRecord(JSON.stringify({evt:'click',tag:tag,type:typ,role:'adf_drop',label:_cbLbl,text:'',id:elId,title:'',href:'',placeholder:'',name:''}));
        return;
      }
    }

    // Suppress Oracle Redwood section-header and label-blob clicks.
    var _ftText=(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ');
    // Heading tags — always suppress
    if(['h1','h2','h3','h4','h5','h6'].indexOf(tag)>=0) return;
    // Label blobs (long text with "Required", newlines, or many words)
    // BUT: check if this element is inside a tile container with a title attribute
    // (e.g., clicked a <p> inside a tile <a>). If so, use the tile's title instead.
    var _isBlobButMaybeTile = (!role&&_ftText.length>40&&(_ftText.indexOf('Required')>=0||_ftText.indexOf('\n')>=0||_ftText.split(' ').length>6)&&!getLabel(el));
    if(_isBlobButMaybeTile){
      // Check ancestors for title attributes (tile containers)
      var _tileAncestor = el.closest && el.closest('[title]');
      if(_tileAncestor){
        var _tileTitle = cleanLabel((_tileAncestor.getAttribute('title') || '').trim());
        if(_tileTitle && _tileTitle.length > 0 && _tileTitle.length < 80){
          // Treat as a tile click using the ancestor's title
          window.__pwRecord(JSON.stringify({evt:'click',tag:tag,type:typ,role:'tile',label:_tileTitle,text:_tileTitle,id:_tileAncestor.id||elId,title:_tileTitle,href:'',placeholder:'',name:''}));
          return;
        }
      }
      // Not a tile — suppress as blob
      return;
    }
    // Non-interactive divs/spans/p with no role, no title, no label — always suppress.
    // This catches section headers like "Pricing", "Source", "Line Information" etc.
    if(!role&&(tag==='div'||tag==='span'||tag==='p')&&!title&&!getLabel(el)) return;

    window.__pwRecord(JSON.stringify({evt:'click',tag:tag,type:typ,role:role,label:getLabel(el),text:_ftText.substring(0,80),id:elId,placeholder:el.placeholder||'',name:el.name||'',title:title,href:el.href||''}));
  },true);


  // ── LOV mousedown — captures Oracle JET option selections ─────────────────
  // Oracle JET confirms selection on mousedown, not click.
  // composedPath() pierces Shadow DOM so options inside shadow roots are reached.
  document.addEventListener('mousedown', function(e){
    var path=(e.composedPath&&e.composedPath())||[];
    var orig=path.length>0?path[0]:e.target;
    var optEl=null,inLov=false;
    for(var _pi=0;_pi<Math.min(path.length,15);_pi++){
      var _pe=path[_pi];
      if(!_pe||_pe===document||_pe===window) break;
      try{
        var _pr=(_pe.getAttribute&&_pe.getAttribute('role'))||'';
        var _pt=(_pe.tagName||'').toLowerCase();
        var _pc=(_pe.className||'').toString();
        if(_pr==='listbox'||_pr==='dialog'||
           _pc.indexOf('oj-searchselect-drop')>=0||_pc.indexOf('oj-select-drop')>=0||
           _pc.indexOf('oj-combobox-drop')>=0||_pc.indexOf('oj-listbox-drop')>=0||
           _pc.indexOf('oj-floating-layer')>=0||_pc.indexOf('oj-popup-content')>=0||
           _pc.indexOf('af_popup')>=0||_pc.indexOf('af_selectItem')>=0){
          inLov=true;
        }
        if(!optEl&&(_pr==='option'||_pr==='gridcell'||_pr==='row'||
           _pt==='li'||_pt==='oj-option'||_pt==='oj-list-item'||
           _pc.indexOf('oj-listbox-result')>=0||_pc.indexOf('af_selectItem')>=0)){
          optEl=_pe;
        }
      }catch(ex){}
    }
    if(!inLov||!optEl) return;
    var _txt='';
    try{
      var _lbl2=optEl.querySelector&&optEl.querySelector('.oj-listbox-result-label,.oj-select-item-label');
      if(_lbl2) _txt=(_lbl2.innerText||_lbl2.textContent||'').trim();
      if(!_txt){
        var _spans2=optEl.querySelectorAll&&optEl.querySelectorAll('span');
        for(var _si2=0;_si2<(_spans2?_spans2.length:0);_si2++){
          var _st2=(_spans2[_si2].innerText||_spans2[_si2].textContent||'').trim();
          if(_st2&&_st2.length>=1&&_st2.length<=60){_txt=_st2;break;}
        }
      }
      if(!_txt){
        var _lines2=(optEl.innerText||optEl.textContent||'').split(/[\n\r]+/);
        for(var _rli=0;_rli<_lines2.length;_rli++){var _rln=_lines2[_rli].trim();if(_rln){_txt=_rln.substring(0,80);break;}}
        _txt=(_txt||'').replace(/^\d+[\.,]?\d*\s+/,'').trim()||_txt;
      }
    }catch(ex2){}
    if(!_txt||_txt.length<1) return;
    var _dLbl2='';
    try{
      var _walkEl=orig;
      for(var _ci2=0;_ci2<25&&_walkEl&&_walkEl!==document.body;_ci2++){
        var _cid2=_walkEl.getAttribute&&_walkEl.getAttribute('data-oj-containerid');
        if(_cid2){var _inp3=document.getElementById(_cid2+'|input');if(_inp3){_dLbl2=getLabel(_inp3)||'';break;}}
        var _lid2=_walkEl.id||'';
        if(_lid2.indexOf('oj-searchselect-results-')===0){
          var _uid2=_lid2.replace('oj-searchselect-results-','');
          var _inp4=document.getElementById(_uid2+'|input');if(_inp4){_dLbl2=getLabel(_inp4)||'';break;}
        }
        _walkEl=_walkEl.parentElement;
      }
      while(_dLbl2.length>0&&(_dLbl2[_dLbl2.length-1]==='*'||_dLbl2[_dLbl2.length-1]===':'))
        _dLbl2=_dLbl2.slice(0,-1).trim();
    }catch(ex3){}
    flushAllFills();
    window.__pwRecord(JSON.stringify({
      evt:'click',tag:(orig.tagName||'span').toLowerCase(),type:'',
      role:'option',label:'',text:_txt,id:(orig.id||''),
      title:'',href:'',placeholder:'',name:'',dropLbl:_dLbl2
    }));
  },true);

    // ── Input handler ─────────────────────────────────────────────────────────
var _oracleWritebackKeys = {};  // tracks keys where Oracle is writing back a formatted value

document.addEventListener('input', function(e){
    var el = e.target, tag = (el.tagName || '').toLowerCase();
    var role = (el.getAttribute && el.getAttribute('role')) || '';

    // ── IGNORE readonly / disabled cells ──────────────────────────────────
    // Catches Oracle auto-calculated fields like Quantity
    if (el.readOnly || el.disabled ||
        el.getAttribute('readonly') !== null ||
        el.getAttribute('disabled') !== null) return;
    // Also check parent oj-input-text/oj-input-number for readonly attr
    var _ojParent = el.closest && el.closest('oj-input-text, oj-input-number, oj-input-date');
    if (_ojParent) {
        var _ojRo = _ojParent.getAttribute('readonly');
        var _ojDis = _ojParent.getAttribute('disabled');
        if (_ojRo === 'true' || _ojRo === '' || _ojDis === 'true' || _ojDis === '') return;
    }

    // ── IGNORE Oracle write-back events (formatter rewriting the same field) ──
    // Oracle fires a second input event with the formatted value.
    // Detect: the input event comes from an element we just recorded a fill for,
    // AND it arrives within 2000ms of our last flush.
    var key = el.id || el.name || (tag + '_' + (el.getAttribute && el.getAttribute('aria-label') || ''));
    if (_oracleWritebackKeys[key] && (Date.now() - _oracleWritebackKeys[key]) < 2000) {
        // Update the ALREADY-RECORDED step's value to the formatted version
        // by re-emitting with the formatted value. The step processor should
        // deduplicate by key+sequence and keep only the last value.
        delete _oracleWritebackKeys[key];
        // Re-emit with corrected value
        window.__pwRecord(JSON.stringify({
            evt: 'fill_correction',  // special event: replaces last fill for this key
            tag: tag, type: el.type || '', role: role,
            label: getLabel(el) || (_lastDataGridCol || ''),
            value: el.value, id: el.id || '',
            placeholder: el.placeholder || '', name: el.name || '',
            dgRow: _lastDataGridRow
        }));
        return;
    }

    if (_lastSelectTs[key] && (Date.now() - _lastSelectTs[key]) < 1500) return;
    var _isPassword = (el.type || '').toLowerCase() === 'password';
    var delay = _isPassword ? 0 : (role === 'spinbutton') ? 1500 : 1200;
    var _elLabel = getLabel(el);
    var _dgRow = -1;
    if (_lastDataGridCol && (!_elLabel || _elLabel === _lastDataGridCol)) {
        _elLabel = _lastDataGridCol;
        _dgRow = _lastDataGridRow;
        role = 'datagrid_combobox';
    }
    _pendingFill[key] = {evt:'fill', tag:tag, type:el.type||'', role:role, label:_elLabel,
                          value:el.value, id:el.id||'', placeholder:el.placeholder||'',
                          name:el.name||'', dgRow:_dgRow};
    clearTimeout(_fillTimers[key]);
    _fillTimers[key] = setTimeout(function(){
        delete _fillTimers[key];
        var d = _pendingFill[key]; delete _pendingFill[key];
        if (d) {
            // Mark this key so we can detect Oracle's formatter write-back
            _oracleWritebackKeys[key] = Date.now();
            window.__pwRecord(JSON.stringify(d));
        }
    }, delay);
}, true);

    // ── Blur handler — captures Oracle-formatted time values ──────────────────
    document.addEventListener('blur', function(e){
    var el = e.target, tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    if (el.readOnly || el.disabled) return;

    // Only handle DataGrid time/number cells
    var _inDg = !!(el.closest && el.closest('[data-oj-container="ojDataGrid"], .oj-datagrid'));
    if (!_inDg) return;

    // Check if this is a time or numeric cell (not a LOV combobox)
    var role = (el.getAttribute && el.getAttribute('role')) || '';
    if (role === 'combobox') return;  // LOV fields handled by option selection

    var key = el.id || el.name || (tag + '_' + (el.getAttribute && el.getAttribute('aria-label') || ''));
    var formattedVal = el.value;
    if (!formattedVal) return;

    var _elLabel = _lastDataGridCol || getLabel(el);
    if (!_elLabel) return;

    // Cancel any pending debounced fill for this key — blur gives us the final value
    if (_fillTimers[key]) {
        clearTimeout(_fillTimers[key]);
        delete _fillTimers[key];
        delete _pendingFill[key];
    }

    // Mark as write-back safe (Oracle may fire another input event after blur)
    _oracleWritebackKeys[key] = Date.now();

    window.__pwRecord(JSON.stringify({
        evt: 'fill',
        tag: tag, type: el.type || '', role: 'datagrid_time_input',
        label: _elLabel, value: formattedVal,
        id: el.id || '', placeholder: '', name: el.name || '',
        dgRow: _lastDataGridRow
    }));
}, true);

  // ── Keydown handler ───────────────────────────────────────────────────────
  document.addEventListener('keydown', function(e){
    var ctrl=e.ctrlKey||e.metaKey;
    if(ctrl&&e.key.toLowerCase()==='a'){
      var el2=e.target, r2=(el2.getAttribute&&el2.getAttribute('role'))||'';
      if(r2==='spinbutton'){window.__pwRecord(JSON.stringify({evt:'keydown',key:'ControlOrMeta+a',tag:el2.tagName.toLowerCase(),type:el2.type||'',role:r2,label:getLabel(el2),id:el2.id||'',placeholder:'',name:''}));}
      return;
    }
    if(!['Tab','Enter','Escape'].includes(e.key)) return;
    var el=e.target, tag=(el.tagName||'').toLowerCase(), role=(el.getAttribute&&el.getAttribute('role'))||'';
    if(!['input','select','textarea'].includes(tag)&&!['combobox','textbox','spinbutton'].includes(role)) return;
    if(e.key==='Tab' && role==='' && !['input','select','textarea'].includes(tag)) return;

    // ── FIX: flush any pending fill for THIS element before recording keydown ──
    // Without this, the debounced fill fires AFTER Enter/Tab, producing wrong order.
    var _key=el.id||el.name||(tag+'_'+(el.getAttribute&&el.getAttribute('aria-label')||''));
    if(_fillTimers[_key]){
      clearTimeout(_fillTimers[_key]);
      delete _fillTimers[_key];
      var _d=_pendingFill[_key]; delete _pendingFill[_key];
      if(_d){_d.value=el.value; window.__pwRecord(JSON.stringify(_d));}
    }
    // ── END FIX ──

    window.__pwRecord(JSON.stringify({evt:'keydown',key:e.key,tag:tag,type:(el.type||''),role:role,label:getLabel(el),id:el.id||'',placeholder:el.placeholder||'',name:el.name||''}));
  },true);

  // ── Change handler ────────────────────────────────────────────────────────
  document.addEventListener('change', function(e){
    var el=e.target, key=el.id||el.name||el.tagName.toLowerCase();
    var lbl=getLabel(el);
    if(el.tagName.toLowerCase()==='select'){
      _lastSelectTs[key]=Date.now();
      if(lbl.indexOf('Month')>=0||(el.getAttribute&&(el.getAttribute('aria-label')||'').indexOf('Month')>=0)) _lastSelectTs['month']=Date.now();
      clearTimeout(_fillTimers[key]); delete _fillTimers[key]; delete _pendingFill[key];
      window.__pwRecord(JSON.stringify({evt:'select',tag:'select',role:(el.getAttribute&&el.getAttribute('role'))||'',label:lbl,value:el.value,selectedText:el.options[el.selectedIndex]?el.options[el.selectedIndex].text:'',id:el.id||''}));
    } else if((el.type||'').toLowerCase()==='checkbox'){
      window.__pwRecord(JSON.stringify({evt:'check',tag:'input',role:'',label:lbl,checked:el.checked,id:el.id||''}));
    }
  },true);
})();"""


# ── Helpers ───────────────────────────────────────────────────────────────────
def _q(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace('"', '\\"')


def _clean_special_chars(s: str) -> str:
    s = s.strip()
    s = re.sub(r'\s*\(\d+\)?\s*$', '', s)
    s = re.sub(r'\s+[\$€£¥₹₩₺₽]$', '', s)
    s = re.sub(r'\s+[A-Z]{3}$', '', s)
    s = re.sub(r'^[*:\s]+|[*:\s]+$', '', s)
    return s


"""session_manager_core.py - ActiveSession and SessionManagerService
This file is appended to session_manager.py during build.
Contains: ActiveSession, SessionManagerService
"""

# ── ActiveSession ─────────────────────────────────────────────────────────────
class ActiveSession:
    """Mirrors monolith Session class - accumulates actions in memory, saves on stop."""

    def __init__(self, session_key: str, script_id: uuid.UUID,
                 target_url: str, browser: str = "chromium"):
        self.session_key  = session_key
        self.script_id    = script_id
        self.target_url   = target_url
        self.browser_type = browser
        self.started_at   = datetime.now(timezone.utc)
        self._actions: list[dict] = []
        self._stopping    = False
        self._last_url    = target_url
        self._record_start_ts: Optional[float] = None
        self._pw: Optional[Playwright]     = None
        self._browser: Optional[Browser]   = None
        self._ctx: Optional[BrowserContext] = None
        self._page: Optional[Page]         = None
        self._cdp  = None
        self._chrome_proc = None

    # async def launch(self):
    #     """Launch Chrome via CDP (monolith-identical). Shows on Windows via WSLg DISPLAY=:0."""
    #     await self._launch_browser()
    #     self._record_start_ts = time.time()
    #     await ws_manager.broadcast(
    #         self.session_key,
    #         WSMessage(event="recording_started",
    #                   payload={"session_key": self.session_key, "url": self.target_url})
    #     )
    #     log.info("Recording started", session=self.session_key, url=self.target_url)

    async def launch(self):
      await self._launch_browser()

      try:
          await self._page.goto(self.target_url, wait_until="commit", timeout=60_000)
          log.info("Navigation committed", session=self.session_key)
      except Exception as exc:
          log.warning("Navigation exception ok for SSO", error=str(exc))

      # Wait for Oracle ERP + ADF framework to fully settle after SSO redirects
      try:
          await self._page.wait_for_load_state("load", timeout=30_000)
          await asyncio.sleep(1)
      except Exception:
          await asyncio.sleep(4)

      async def _inject():
          for attempt in range(3):
              try:
                  # Pass script as ARGUMENT not as expression — bypasses
                  # Playwright's internal expression wrapping that corrupts 67KB IIFE
                  await self._page.evaluate(
                      "(script) => new Function(script)()", _RECORDER_JS
                  )
                  await self._page.evaluate(
                      "(script) => new Function(script)()", _GRID_AWARE_DROPDOWN_JS
                  )
                  log.info("Recorder injected", session=self.session_key,
                          url=self._page.url[:60])
                  return
              except Exception as e:
                  if "context was destroyed" in str(e).lower():
                      await asyncio.sleep(1)
                      continue
                  log.warning("Recorder inject failed", error=str(e))
                  return

      await _inject()

      # Re-inject on every subsequent Oracle page navigation
      async def _on_load():
          await asyncio.sleep(0.5)
          await _inject()

      self._page.on("load", lambda: asyncio.ensure_future(_on_load()))

      self._record_start_ts = time.time()
      await ws_manager.broadcast(
          self.session_key,
          WSMessage(event="recording_started",
                    payload={"session_key": self.session_key, "url": self.target_url})
      )
      log.info("Recording started", session=self.session_key, url=self.target_url)

    
    async def stop(self) -> list[dict]:
        """Close browser, return deduplicated+merged actions."""
        self._stopping = True
        if self._cdp:
            try: await self._cdp.send("Page.stopScreencast")
            except: pass
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
        await ws_manager.broadcast(
            self.session_key,
            WSMessage(event="recording_stopped", payload={"session_key": self.session_key})
        )
        if not self._actions:
            return []
        cleaned = self._deduplicate(self._actions)
        merged  = self._merge_dropdown_steps(cleaned)
        return merged

    async def _launch_browser(self):
      """
      Launch Chrome on Windows desktop via WSLg (DISPLAY=:0).
      Mirrors V3 monolith exactly — expose_binding on page, add_init_script on context.
      goto is called separately in launch() after this returns.
      """
      _bt = (self.browser_type or "chromium").lower().strip()
      _is_cdp_browser = _bt in ("chromium", "chrome", "edge", "msedge")
      _use_cdp = _is_cdp_browser and not settings.BROWSER_HEADLESS

      if _use_cdp:
          await self._launch_cdp()
      else:
          await self._launch_playwright(_bt)

      await self._page.expose_binding("__pwRecord", self._on_js_event)
      await self._ctx.add_init_script(_RECORDER_JS)
      self._page.on("framenavigated", self._on_nav)
    async def _launch_cdp(self):
        """Launch Chrome/Chromium subprocess and connect via CDP (non-headless)."""
        import urllib.request, glob as _glob
        port = settings.CHROME_CDP_PORT

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
            raise RuntimeError(
                "No Chrome/Chromium binary found for CDP launch. "
                "Install google-chrome-stable or run: playwright install chromium"
            )

        subprocess.run(["pkill", "-f", f"remote-debugging-port={port}"], capture_output=True)
        await asyncio.sleep(0.5)
        shutil.rmtree("/tmp/pw_chrome_profile", ignore_errors=True)

        env = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")}
        self._chrome_proc = subprocess.Popen([
            chrome_bin,
            "--no-sandbox", "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--no-first-run", "--no-default-browser-check",
            "--disable-notifications",
            "--use-gl=swiftshader",
            f"--remote-debugging-port={port}",
            "--remote-debugging-address=127.0.0.1",
            f"--window-size={settings.BROWSER_VIEWPORT_WIDTH},{settings.BROWSER_VIEWPORT_HEIGHT}",
            "--user-data-dir=/tmp/pw_chrome_profile",
            "--lang=en-US",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)

        for _ in range(30):
            await asyncio.sleep(0.5)
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
                break
            except Exception:
                continue

        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

        contexts = self._browser.contexts
        if contexts:
            self._ctx  = contexts[0]
            self._page = self._ctx.pages[0] if self._ctx.pages else await self._ctx.new_page()
        else:
            self._ctx = await self._browser.new_context(
                viewport=settings.viewport,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="en-US", ignore_https_errors=True,
            )
            self._page = await self._ctx.new_page()
        log.info("CDP browser launched", port=port, bin=chrome_bin)

    async def _launch_playwright(self, browser_type: str):
        """Launch any browser via Playwright's standard API (headless or not)."""
        self._pw = await async_playwright().start()

        # Map browser_type string → Playwright engine
        if browser_type in ("firefox", "ff"):
            engine = self._pw.firefox
        elif browser_type in ("webkit", "safari"):
            engine = self._pw.webkit
        else:
            engine = self._pw.chromium  # chromium, chrome, edge all map here

        # Chromium-only args (Firefox/WebKit reject these)
        _is_chromium = browser_type not in ("firefox", "ff", "webkit", "safari")
        launch_kwargs: dict = {
            "headless": settings.BROWSER_HEADLESS,
            "slow_mo":  settings.BROWSER_SLOW_MO,
        }
        if _is_chromium:
            launch_kwargs["args"]               = ["--no-sandbox", "--disable-setuid-sandbox",
                                                    "--disable-dev-shm-usage",
                                                    "--disable-blink-features=AutomationControlled"]
            launch_kwargs["ignore_default_args"] = ["--enable-automation"]

        self._browser = await engine.launch(**launch_kwargs)
        self._ctx     = await self._browser.new_context(
            viewport=settings.viewport,
            locale="en-US",
            ignore_https_errors=True,
        )
        self._page = await self._ctx.new_page()
        log.info("Playwright browser launched", browser=browser_type,
                 headless=settings.BROWSER_HEADLESS)

    def _on_js_event(self, source, data):
        log.info("JS EVENT RECEIVED", data=str(data)[:200])
        asyncio.ensure_future(self._process_event(data))

    def _on_nav(self, frame):
        asyncio.ensure_future(self._record_nav(frame))

    async def _record_nav(self, frame):
        if self._stopping or frame.parent_frame is not None: return
        url = frame.url
        if not url or url == self._last_url: return
        if url.startswith(("about:", "chrome-extension:", "data:")): return
        skip = ["_afrloop=", "sso/", "oauth", "identity.oracle", "?fnd=",
                "AtkHomePageWelcome", "FndOverview", "#", "javascript:"]
        if any(x in url for x in skip):
            self._last_url = url; return
        if self._record_start_ts and (time.time() - self._record_start_ts) < 3: return
        self._last_url = url

    async def _process_event(self, data: str):
        """Process a JS-recorded event. Mirrors monolith _process_event exactly."""
        if self._stopping: return
        try:
            info  = json.loads(data)
            value = info.get("value", "") or ""
            evt   = info.get("evt", "")
            role  = info.get("role", "")
            text  = info.get("text", "") or ""

            # ── Grid DataGrid LOV selection ─────────────────────────────────
            if evt == "grid_dropdown_select":
                col_label = (info.get("col") or "").strip()
                row_idx   = int(info.get("row") or -1)
                selected  = (info.get("selected") or "").strip()
                if col_label and selected:
                    loc_token = f'"__dg__:row={row_idx}:col={col_label}"'
                    code = f'{loc_token}.fill("{_q(selected)}")'
                    comment = f"# In row {row_idx+1}, set '{col_label}' = '{selected}'"
                    action = {
                        "code": code, "comment": comment, "checkpoint": False,
                        "ts": time.time(), "is_dropdown_open": False,
                        "is_option_selection": True,
                        "info": {**info, "evt": "fill", "dgCol": col_label,
                                 "dgRow": row_idx, "label": col_label},
                        "value": selected,
                        "locator_template": f'{loc_token}.fill("{{value}}")',
                        "grid_row": row_idx, "grid_col": col_label,
                    }
                    self._actions.append(action)
                    await ws_manager.broadcast(self.session_key, WSMessage(
                        event="step_recorded",
                        payload={"step_order": len(self._actions), "action_type": "fill",
                                 "description": comment.lstrip("# "), "selector": loc_token,
                                 "value": selected}
                    ))
                return

            if evt == "grid_dropdown_pending":
                return

            # Build locator + comment using monolith helpers
            from app.services._locator_builder import build_locator, make_comment
            loc     = build_locator(info)
            comment = make_comment(info, value or text)
            if not loc or not comment:
                return

            # Filter container labels
            label_raw = info.get("label", "") or ""
            if evt == "click" and role not in ("option","gridcell","button","link","menuitem","tab","tile"):
                _words = label_raw.split()
                _field_keywords = {"Username","Password","Sign","Next","Forgot","Login","Email","Cancel","Submit","Or"}
                _keyword_count = sum(1 for w in _words if w.strip("?.,!") in _field_keywords)
                if len(label_raw) >= 60 or _keyword_count >= 3:
                    return

            if evt == "click":
                if role == "date_trigger": return
                if role == "adf_drop" or "open dropdown" in comment.lower(): return
                if role == "tile" and "select date" in (
                    info.get("title") or info.get("text") or info.get("label") or ""
                ).lower():
                    return

                if role == "option" and text:
                    import re as _re_cday
                    if _re_cday.match(r"^\d{1,2}$", text.strip()):
                        return
                    dg_col = info.get("dgCol", "").strip()
                    dg_row = info.get("dgRow", -1)
                    if dg_col:
                        _clean_text = re.sub(r'^\d+[.,]?\d*\s+', '', text).strip() or text
                        comment = f"# In row {dg_row+1}, set '{dg_col}' = '{_clean_text}'"
                        loc_token = f'"__dg__:row={dg_row}:col={dg_col}"'
                        code = f'{loc_token}.fill("{_q(_clean_text)}")'
                        action = {
                            "code": code, "comment": comment, "checkpoint": False,
                            "ts": time.time(), "is_dropdown_open": False,
                            "is_option_selection": True,
                            "info": info, "value": _clean_text,
                            "locator_template": f'{loc_token}.fill("{{value}}")',
                            "grid_row": dg_row, "grid_col": dg_col,
                        }
                        self._actions.append(action)
                        await ws_manager.broadcast(self.session_key, WSMessage(
                            event="step_recorded",
                            payload={"step_order": len(self._actions), "action_type": "fill",
                                     "description": comment.lstrip("# "), "value": _clean_text}
                        ))
                        return
                    _clean = re.sub(r'^\d+[.,]?\d*\s+', '', text).strip() or text
                    code = f'page.get_by_text("{_q(_clean)}", exact=True).locator("visible=true").click()'
                    comment = f"# Select option: '{_clean}'"
                    drop_lbl = (info.get("dropLbl") or "").strip()
                    if drop_lbl:
                        open_code = f'page.get_by_role("combobox", name="{_q(drop_lbl)}", exact=True).first.click()'
                        open_comment = f"# Open dropdown: '{drop_lbl}'"
                        last_code = self._actions[-1].get("code", "") if self._actions else ""
                        if last_code != open_code:
                            self._actions.append({
                                "code": open_code, "comment": open_comment, "checkpoint": False,
                                "ts": time.time() - 0.01, "is_dropdown_open": True,
                                "is_option_selection": False,
                                "info": {"evt": "click", "role": "adf_drop", "label": drop_lbl},
                                "value": "", "locator_template": open_code
                            })
                elif role == "gridcell":
                    code = f"{loc}.click(force=True)"
                else:
                    code = f"{loc}.click()"

            elif evt == "fill":
                if role == "date_input" and value:
                    date_id = info.get("id", "")
                    date_label = info.get("label", "Date") or "Date"
                    if date_id:
                        date_loc = f'page.locator("#{date_id}")'
                    else:
                        date_loc = 'page.locator(\'input.oj-inputdatetime-input[role="combobox"]\').first'
                    code = f'{date_loc}.fill("{_q(value)}")'
                    comment = f"# Fill date '{date_label}': '{value}'"
                    action = {
                        "code": code, "comment": comment, "checkpoint": False, "ts": time.time(),
                        "is_dropdown_open": False, "is_option_selection": False,
                        "info": info, "value": value,
                        "locator_template": f'{date_loc}.fill("{{value}}")',
                    }
                    self._actions.append(action)
                    tab_action = {
                        "code": "page.keyboard.press('Tab')", "comment": "# Confirm date with Tab",
                        "checkpoint": False, "ts": time.time() + 0.01,
                        "is_dropdown_open": False, "is_option_selection": False,
                        "info": {}, "value": "", "locator_template": "page.keyboard.press('Tab')"
                    }
                    self._actions.append(tab_action)
                    await ws_manager.broadcast(self.session_key, WSMessage(
                        event="step_recorded",
                        payload={"step_order": len(self._actions) - 1, "action_type": "fill",
                                 "description": comment.lstrip("# "), "value": value}
                    ))
                    return
                code = f'{loc}.fill("{_q(value)}")'
            elif evt == "keydown":
                code = f'{loc}.press("{info.get("key", "")}")'
            elif evt == "select":
                code = f'{loc}.select_option("{_q(value)}")'
            elif evt == "check":
                checked = info.get("checked", True)
                code = f"{loc}.{'check()' if checked else 'uncheck()'}"
            else:
                return

            is_dropdown_open    = (evt == "click" and role == "adf_drop")
            is_option_selection = (role == "option")
            _value = value if evt == "fill" else (info.get("selectedText") or value if evt == "select" else "")
            _locator_template = f'{loc}.fill("{{value}}")' if evt == "fill" and loc else code

            action = {
                "code": code, "comment": comment, "checkpoint": False, "ts": time.time(),
                "is_dropdown_open": is_dropdown_open, "is_option_selection": is_option_selection,
                "info": info, "value": _value, "locator_template": _locator_template,
            }

            # Deduplicate consecutive identical actions
            if self._actions and self._actions[-1].get("code") == code:
                return
            self._actions.append(action)

            await ws_manager.broadcast(self.session_key, WSMessage(
                event="step_recorded",
                payload={
                    "step_order":  len(self._actions),
                    "action_type": evt,
                    "description": comment.lstrip("# "),
                    "selector":    loc or "",
                    "value":       _value,
                }
            ))

        except Exception as exc:
            log.warning("Event parse error", error=str(exc), data=str(data)[:80])

    # ── Deduplication (from monolith _deduplicate) ────────────────────────────
    def _deduplicate(self, actions: list) -> list:
        if not actions: return actions
        result = []; i = 0
        while i < len(actions):
            a = actions[i]; code = a["code"]
            if ".fill(" in code:
                loc_part = code.split(".fill(")[0]
                j = i + 1
                while j < len(actions) and ".fill(" in actions[j]["code"]:
                    if actions[j]["code"].split(".fill(")[0] == loc_part: i = j
                    else: break
                    j += 1
                a = actions[i]
            if ".fill(" in a["code"] and result:
                prev = result[-1]["code"]
                if ".select_option(" in prev and prev.split(".select_option(")[0] == a["code"].split(".fill(")[0]:
                    i += 1; continue
            _info      = a.get("info", {})
            _info_role = _info.get("role", "")
            _code_str  = a.get("code", "")
            _cmt       = (a.get("comment") or "").lower()
            _is_date_trigger = (
                _info_role == "date_trigger" or "date_trigger" in _cmt or
                ("locator('a[title=\"Select Date\"]')" in _code_str and ".click()" in _code_str) or
                (_info_role == "tile" and "select date" in (_info.get("label") or _info.get("title") or "").lower())
            )
            if _is_date_trigger:
                _found_fill = False; _steps_to_skip = 0
                for _la_off in range(1, 4):
                    if (i + _la_off) >= len(actions): break
                    _la = actions[i + _la_off]
                    _la_role = _la.get("info", {}).get("role", "")
                    _la_text = (_la.get("info", {}).get("text") or "").strip()
                    _la_code = _la.get("code", ""); _la_cmt = (_la.get("comment") or "").lower()
                    _is_cal = (_la_role in ("option","gridcell") and bool(re.match(r"^\d{1,2}$", _la_text)))
                    if _is_cal: _steps_to_skip = _la_off; continue
                    if ".fill(" in _la_code and ("oj-inputdatetime" in _la_code or "date" in _la_cmt):
                        _found_fill = True; _steps_to_skip = _la_off - 1
                    break
                if _found_fill:
                    i += _steps_to_skip; i += 1; continue
            _is_open = "open dropdown" in (a.get("comment") or "").lower()
            _next_is_opt = ((i + 1) < len(actions) and "select" in (actions[i+1].get("comment") or "").lower())
            if result and result[-1].get("code") == a["code"] and not (_is_open and _next_is_opt):
                i += 1; continue
            result.append(a); i += 1
        return result

    # ── Merge dropdown steps (from monolith _merge_dropdown_steps) ────────────
    def _merge_dropdown_steps(self, actions: list) -> list:
        if not actions: return actions
        merged = []; i = 0
        while i < len(actions):
            a    = actions[i]
            code = a.get("code", "")
            cmt  = (a.get("comment") or "").lower()
            _is_fill = ".fill(" in code and (
                "combobox" in code or "get_by_label" in code or
                a.get("info", {}).get("role") in ("datagrid_combobox", "combobox") or
                "dropdown" in cmt
            )
            if _is_fill and i + 1 < len(actions):
                _nxt = actions[i + 1]
                if _nxt.get("is_option_selection") and '"__dg__:' in _nxt.get("code", ""):
                    merged.append(_nxt); i += 2; continue
            if _is_fill and i + 2 < len(actions):
                nxt  = actions[i + 1]; nnxt = actions[i + 2]
                _is_open = nxt.get("is_dropdown_open", False) or "open dropdown" in (nxt.get("comment") or "").lower()
                _is_sel  = nnxt.get("is_option_selection", False) or "select option" in (nnxt.get("comment") or "").lower()
                if _is_open and _is_sel:
                    selected_val = nnxt.get("value") or nnxt.get("info", {}).get("text") or a.get("value", "")
                    field_label  = a.get("info", {}).get("label") or ""
                    merged.append({
                        "code": code, "comment": f"# Set '{field_label}' = '{selected_val}'",
                        "checkpoint": False, "ts": a["ts"],
                        "is_dropdown_open": False, "is_option_selection": False,
                        "info": a.get("info", {}), "value": selected_val,
                        "locator_template": a.get("locator_template", ""),
                    })
                    i += 3; continue
            merged.append(a); i += 1
        return merged


# ── SessionManagerService ─────────────────────────────────────────────────────
class SessionManagerService:
    def __init__(self):
        self._sessions: dict[str, ActiveSession] = {}

    async def start(self, script_id: uuid.UUID, target_url: str, browser: str) -> str:
        key = str(uuid.uuid4())
        active = ActiveSession(key, script_id, target_url, browser)
        self._sessions[key] = active
        task = asyncio.create_task(active.launch())
        # Propagate launch errors to the frontend via WebSocket
        task.add_done_callback(lambda t: self._on_launch_done(t, key))
        return key

    def _on_launch_done(self, task: asyncio.Task, key: str) -> None:
        if task.cancelled():
            log.warning("Browser launch task cancelled", session=key)
        elif task.exception():
            exc = task.exception()
            log.error("Browser launch failed", session=key, error=str(exc))
            # Remove dead session
            self._sessions.pop(key, None)
            # Broadcast error so the frontend can show a useful message
            asyncio.ensure_future(ws_manager.broadcast(
                key,
                WSMessage(
                    event="recording_error",
                    payload={"session_key": key, "error": str(exc)},
                )
            ))

    async def stop(self, key: str) -> list[dict]:
        active = self._sessions.pop(key, None)
        if not active:
            raise ValueError(f"No active session: {key}")
        return await active.stop()

    def get(self, key: str) -> Optional[ActiveSession]:
        return self._sessions.get(key)


session_manager = SessionManagerService()
