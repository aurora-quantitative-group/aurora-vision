import asyncio
import json


def bridge_ready(metadata: str) -> bool:
    try:
        data = json.loads(metadata or "{}")
    except (ValueError, TypeError):
        return False
    return isinstance(data, dict) and data.get("chert_bridge_ready") is True


async def wait_for_bridge(room) -> None:
    ready = asyncio.Event()

    def changed(metadata: str) -> None:
        if bridge_ready(metadata):
            ready.set()

    room.on("room_metadata_changed", changed)
    try:
        changed(room.metadata)
        await ready.wait()
    finally:
        room.off("room_metadata_changed", changed)
