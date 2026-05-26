import json, uuid
from typing import Dict, Set
import structlog
from fastapi import WebSocket, WebSocketDisconnect
log = structlog.get_logger(__name__)

class ExecutionWSManager:
    def __init__(self): self._c: Dict[str, Set[WebSocket]] = {}
    async def connect(self, ws: WebSocket, run_id: str):
        await ws.accept(); self._c.setdefault(run_id, set()).add(ws)
    def disconnect(self, ws: WebSocket, run_id: str):
        if run_id in self._c:
            self._c[run_id].discard(ws)
            if not self._c[run_id]: del self._c[run_id]
    async def broadcast(self, run_id: uuid.UUID, event: str, payload: dict):
        msg = json.dumps({"event": event, "payload": payload})
        dead = []
        for ws in self._c.get(str(run_id), set()):
            try: await ws.send_text(msg)
            except: dead.append(ws)
        for ws in dead: self.disconnect(ws, str(run_id))

ws_manager = ExecutionWSManager()

async def handle_execution_ws(ws: WebSocket, run_id: str):
    await ws_manager.connect(ws, run_id)
    try:
        while True:
            d = await ws.receive_text()
            if d.strip() == "ping": await ws.send_text(json.dumps({"event":"pong"}))
    except WebSocketDisconnect: ws_manager.disconnect(ws, run_id)
