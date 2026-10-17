import asyncio
import logging
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger("ristoos.ws")


class Hub:
    def __init__(self):
        self.rooms: Dict[str, Set[WebSocket]] = {}

    async def connect(self, tenant_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(tenant_id, set()).add(ws)

    def disconnect(self, tenant_id: str, ws: WebSocket):
        room = self.rooms.get(tenant_id)
        if room:
            room.discard(ws)
            if not room:
                self.rooms.pop(tenant_id, None)

    async def emit(self, tenant_id: str, event: str, data: dict | None = None):
        room = list(self.rooms.get(tenant_id, ()))
        if not room:
            return
        msg = {"event": event, "data": data or {}}
        results = await asyncio.gather(*(ws.send_json(msg) for ws in room), return_exceptions=True)
        for ws, r in zip(room, results):
            if isinstance(r, Exception):
                self.disconnect(tenant_id, ws)


hub = Hub()
