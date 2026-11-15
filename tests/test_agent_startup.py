import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from livekit.rtc.event_emitter import EventEmitter

from aurora import agent


async def test_audio_starts_before_bridge_readiness_but_greeting_waits(monkeypatch):
    room = EventEmitter()
    room.metadata = "{}"
    callbacks = []
    ctx = SimpleNamespace(
        room=room,
        connect=AsyncMock(),
        wait_for_participant=AsyncMock(return_value=SimpleNamespace(identity="chert-bridge-call")),
        add_shutdown_callback=callbacks.append,
    )
    settings = SimpleNamespace(frame_max_age=3, alert_cooldown=12, google_key="test",
                               gemini_model="test", asl_endpoint="", asl_key="", scan_interval=2)
    started = asyncio.Event()
    session = SimpleNamespace(start=AsyncMock(side_effect=lambda **kwargs: started.set()),
                              say=AsyncMock(), aclose=AsyncMock(), on=lambda event: lambda fn: fn)
    media = SimpleNamespace(bind=Mock(), publish_card=AsyncMock(), close=AsyncMock())
    vision = SimpleNamespace(close=AsyncMock())
    asl = SimpleNamespace(close=AsyncMock())
    monkeypatch.setattr(agent.Settings, "load", lambda: settings)
    monkeypatch.setattr(agent, "Media", lambda *args: media)
    monkeypatch.setattr(agent, "Vision", lambda *args: vision)
    monkeypatch.setattr(agent, "ASL", lambda *args: asl)
    monkeypatch.setattr(agent, "create_session", lambda *args: session)
    monkeypatch.setattr(agent, "Companion", lambda *args: object())
    monkeypatch.setattr(agent, "scan_loop", AsyncMock())
    task = asyncio.create_task(agent.entrypoint(ctx))
    try:
        await asyncio.wait_for(started.wait(), timeout=1)
        session.say.assert_not_called()
        assert not task.done()
        room.metadata = '{"chert_bridge_ready":true}'
        room.emit("room_metadata_changed", "{}", room.metadata)
        await asyncio.wait_for(task, timeout=1)
        session.say.assert_awaited_once()
        assert session.start.call_args.kwargs["record"] is False
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        for close in callbacks:
            await close()
    session.aclose.assert_awaited_once()
    media.close.assert_awaited_once()
    vision.close.assert_awaited_once()
