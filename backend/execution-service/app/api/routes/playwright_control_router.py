"""
Playwright Live Control API
==========================
APIs for live browser session control, pause/resume/stop, and element selection.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from typing import Optional
import uuid

router = APIRouter(prefix="/playwright", tags=["playwright"])

# In-memory session store (for demo; replace with persistent/session-aware in prod)
live_sessions = {}

@router.post("/open/{run_id}/{trs_id}")
async def open_live_browser(run_id: uuid.UUID, trs_id: uuid.UUID, bg: BackgroundTasks):
    """
    Open a live Playwright browser for the given test run/script.
    """
    # TODO: Launch Playwright browser, store session info
    session_id = str(uuid.uuid4())
    live_sessions[session_id] = {
        "run_id": str(run_id),
        "trs_id": str(trs_id),
        "status": "running",
        # Add browser/process handle here
    }
    # bg.add_task(start_browser, ...)
    return {"session_id": session_id, "status": "running"}

@router.post("/pause/{session_id}")
async def pause_live_run(session_id: str):
    """
    Pause the live Playwright session.
    """
    sess = live_sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found")
    sess["status"] = "paused"
    # TODO: Actually pause browser execution
    return {"ok": True, "status": "paused"}

@router.post("/resume/{session_id}")
async def resume_live_run(session_id: str):
    """
    Resume the paused Playwright session.
    """
    sess = live_sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found")
    sess["status"] = "running"
    # TODO: Actually resume browser execution
    return {"ok": True, "status": "running"}

@router.post("/stop/{session_id}")
async def stop_live_run(session_id: str):
    """
    Stop the live Playwright session.
    """
    sess = live_sessions.pop(session_id, None)
    if not sess:
        raise HTTPException(404, "Session not found")
    # TODO: Actually stop browser/process
    return {"ok": True, "status": "stopped"}

@router.get("/elements/{session_id}")
async def get_elements(session_id: str, text: Optional[str] = Query(None)):
    """
    Fetch/select elements for the given text from the live page (when paused).
    """
    sess = live_sessions.get(session_id)
    if not sess or sess["status"] != "paused":
        raise HTTPException(400, "Session must be paused to select elements")
    # TODO: Use Playwright to find elements matching text
    # Example: elements = playwright_find_elements(sess, text)
    elements = [{"text": text, "selector": "#demo"}]  # Placeholder
    return {"elements": elements}

@router.post("/stop-preview/{session_id}")
async def stop_preview(session_id: str):
    """
    Stop the preview session (if any).
    """
    # For now, same as stop
    return await stop_live_run(session_id)
