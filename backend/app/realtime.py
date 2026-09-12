from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, channel: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._channels[channel].add(websocket)

    def disconnect(self, channel: str, websocket: WebSocket) -> None:
        self._channels[channel].discard(websocket)

    async def broadcast(self, channel: str, message: dict) -> None:
        stale_connections: list[WebSocket] = []
        for websocket in list(self._channels[channel]):
            try:
                await websocket.send_json(message)
            except RuntimeError:
                stale_connections.append(websocket)

        for websocket in stale_connections:
            self.disconnect(channel, websocket)


manager = ConnectionManager()
