import asyncio
import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from PIL import Image

from aurora.asl import ASL, classify_letters
from aurora.companion import Companion, scan_loop
from aurora.state import CallState
from aurora.vision import CashReading, Hazard, Scene, Vision


def jpeg_image() -> bytes:
    output = BytesIO()
    Image.new("RGB", (32, 32), "white").save(output, "JPEG")
    return output.getvalue()


async def test_asl_uses_separate_model_and_preserves_clip_timing():
    state = CallState(3, 12)
    for index in range(10):
        state.add_frame(jpeg_image(), now=index / 8)
    received = []

    def handle(request):
        received.append(json.loads(request.content))
        assert request.headers["Authorization"] == "Bearer local-test"
        return httpx.Response(200, json={"text": "Hello", "confidence": 0.95, "model": "temporal-asl"})

    asl = ASL("http://localhost/translate", "local-test")
    await asl.client.aclose()
    asl.client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    try:
        result = await asl.translate(list(state.frames))
        assert "Hello" in result
        assert len(received[0]["frames"]) == 10
        assert received[0]["frames"][-1]["time_ms"] == 1125
    finally:
        await asl.close()


async def test_asl_missing_model_never_falls_back_to_gemini():
    asl = ASL("", "")
    try:
        assert "isn't configured" in await asl.translate([])
    finally:
        await asl.close()


async def test_asl_rejects_low_confidence_output():
    asl = ASL("http://localhost/translate", "")
    await asl.client.aclose()
    asl.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, json={"text": "invented", "confidence": 0.5, "model": "test"})))
    state = CallState(3, 12)
    for index in range(9):
        state.add_frame(jpeg_image(), now=index / 8)
    try:
        assert "invented" not in await asl.translate(list(state.frames))
    finally:
        await asl.close()


@pytest.mark.parametrize("letter,score,accepted", [("A", 0.99, True), ("J", 1, False),
                                                   ("Z", 1, False), ("A", 0.3, False)])
def test_static_classifier_requires_supported_letters_and_confidence(letter, score, accepted):
    classifier = Mock(return_value=[{"label": letter, "score": score}])
    result = classify_letters([jpeg_image()] * 5, classifier)
    assert (result.confidence >= 0.9) is accepted


async def test_gemini_receives_images_and_structured_cash_schema():
    vision = Vision("test-not-a-real-key", "test-model")
    response = CashReading(clear=True, bills=[{"currency": "USD", "denomination": 20, "count": 1}],
                           confidence=0.95, guidance="")
    generate = AsyncMock(return_value=SimpleNamespace(text=response.model_dump_json()))
    vision.client.aio.models.generate_content = generate
    state = CallState(3, 12)
    state.add_frame(jpeg_image())
    try:
        result = await vision.cash(state.current())
        assert "USD 20" in result.spoken()
        arguments = generate.call_args.kwargs
        assert arguments["model"] == "test-model"
        assert arguments["contents"][0].inline_data.mime_type == "image/jpeg"
        assert arguments["config"].response_schema is CashReading
    finally:
        await vision.close()


async def test_cash_tool_discards_result_after_camera_mute():
    state = CallState(3, 12)
    state.add_frame(jpeg_image())

    async def cash(frame):
        state.clear_camera()
        return CashReading(clear=True, bills=[{"currency": "USD", "denomination": 20, "count": 1}],
                           confidence=0.95, guidance="")

    companion = Companion(state, SimpleNamespace(cash=cash), None)
    assert "expired" in await companion.read_cash()
    assert not state.events


async def run_scan(state, vision, session):
    task = asyncio.create_task(scan_loop(state, vision, session, 0.001))
    await asyncio.wait_for(session.called.wait(), timeout=1)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


class TestSession:
    __test__ = False

    def __init__(self):
        self.called = asyncio.Event()
        self.speech = []
        self.interrupt = Mock()

    async def say(self, text, **kwargs):
        self.speech.append(text)
        self.called.set()


async def test_hazard_alert_preempts_speech_and_is_remembered():
    state = CallState(3, 12)
    state.add_frame(jpeg_image())
    scene = Scene(usable=True, description="street", hazards=[Hazard(
        category="vehicle", location="left", severity="high", confidence=0.99,
        observation="A car occupies the left side of the view.")])
    vision = SimpleNamespace(scene=AsyncMock(return_value=scene))
    session = TestSession()
    await run_scan(state, vision, session)
    assert "left" in session.speech[0]
    session.interrupt.assert_called_once()
    assert state.events
    assert not state.should_alert("vehicle:left")


async def test_scan_reports_lost_camera_once():
    state = CallState(3, 12)
    session = TestSession()
    vision = SimpleNamespace(scene=AsyncMock())
    task = asyncio.create_task(scan_loop(state, vision, session, 0.001))
    await asyncio.wait_for(session.called.wait(), timeout=1)
    await asyncio.sleep(0.01)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert len(session.speech) == 1
    vision.scene.assert_not_called()


async def test_paused_scan_makes_no_model_requests():
    state = CallState(3, 12)
    state.scanning = False
    session = TestSession()
    vision = SimpleNamespace(scene=AsyncMock())
    task = asyncio.create_task(scan_loop(state, vision, session, 0.001))
    await asyncio.sleep(0.01)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    vision.scene.assert_not_called()
    assert not session.speech
