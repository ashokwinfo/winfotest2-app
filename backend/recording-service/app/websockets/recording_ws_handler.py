"""Recording WebSocket Handler"""
import json
from typing import Dict, Set
import structlog
from fastapi import WebSocket, WebSocketDisconnect
from app.models.domain import WSMessage

log = structlog.get_logger(__name__)


class RecordingWSManager:
    def __init__(self):
        self._connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, ws: WebSocket, session_key: str):
        await ws.accept()
        self._connections.setdefault(session_key, set()).add(ws)

    def disconnect(self, ws: WebSocket, session_key: str):
        if session_key in self._connections:
            self._connections[session_key].discard(ws)
            if not self._connections[session_key]:
                del self._connections[session_key]

    async def broadcast(self, session_key: str, msg: WSMessage):
        clients = self._connections.get(session_key, set())
        if not clients:
            return
        payload = msg.model_dump_json()
        dead = []
        for ws in clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, session_key)


ws_manager = RecordingWSManager()


async def handle_recording_ws(ws: WebSocket, session_key: str):
    await ws_manager.connect(ws, session_key)
    try:
        while True:
            data = await ws.receive_text()
            if data.strip() == "ping":
                await ws.send_text(json.dumps({"event": "pong"}))
    except WebSocketDisconnect:
        ws_manager.disconnect(ws, session_key)
