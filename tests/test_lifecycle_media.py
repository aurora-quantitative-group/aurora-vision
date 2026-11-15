import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from livekit import rtc
from livekit.rtc.event_emitter import EventEmitter
from PIL import Image

from aurora.lifecycle import bridge_ready, wait_for_bridge
from aurora.media import Media, encode_frame, status_image
from aurora.state import CallState


@pytest.mark.parametrize("metadata", ["", "bad", "[]", "null", '{"chert_bridge_ready":"true"}',
                                      '{"chert_bridge_ready":false}'])
def test_readiness_requires_an_actual_boolean(metadata):
    assert not bridge_ready(metadata)


async def test_readiness_handles_python_sdk_old_and_new_metadata_arguments():
    room = EventEmitter()
    room.metadata = "{}"
    waiting = asyncio.create_task(wait_for_bridge(room))
    await asyncio.sleep(0)
    room.metadata = '{"chert_bridge_ready":true}'
    room.emit("room_metadata_changed", "{}", room.metadata)
    await asyncio.wait_for(waiting, timeout=1)
    assert not room._events["room_metadata_changed"]


async def test_readiness_handles_signal_before_subscription():
    room = EventEmitter()
    room.metadata = '{"chert_bridge_ready":true}'
    await asyncio.wait_for(wait_for_bridge(room), timeout=1)


async def test_readiness_cancellation_removes_listener():
    room = EventEmitter()
    room.metadata = "{}"
    waiting = asyncio.create_task(wait_for_bridge(room))
    await asyncio.sleep(0)
    waiting.cancel()
    await asyncio.gather(waiting, return_exceptions=True)
    assert not room._events["room_metadata_changed"]


def test_frame_encoding_and_status_card():
    source = Image.new("RGB", (800, 600), "red")
    frame = rtc.VideoFrame(800, 600, rtc.VideoBufferType.RGB24, source.tobytes())
    image = Image.open(BytesIO(encode_frame(frame)))
    assert image.size == (640, 480)
    assert image.getpixel((0, 0))[0] >= 250
    yuv = frame.convert(rtc.VideoBufferType.I420)
    assert Image.open(BytesIO(encode_frame(yuv))).size == (640, 480)
    state = CallState(3, 12)
    state.caption = "Possible hazard: obstacle to your left"
    assert status_image(state).size == (640, 360)


async def test_camera_only_accepts_selected_bridge_track_and_honors_mute(monkeypatch):
    room = EventEmitter()
    room.remote_participants = {}
    room.isconnected = lambda: False
    state = CallState(3, 12)
    media = Media(room, state)
    media.bind("chert-bridge-call")
    started = asyncio.Event()

    async def capture(track, generation):
        started.set()
        await asyncio.Future()

    monkeypatch.setattr(media, "capture", capture)
    participant = SimpleNamespace(identity="chert-bridge-call")
    wrong = SimpleNamespace(identity="another-publisher")
    publication = SimpleNamespace(name="facetime-remote-video", sid="video1", muted=False)
    track = SimpleNamespace(kind=rtc.TrackKind.KIND_VIDEO)
    publication.track = track
    room.emit("track_subscribed", track, publication, wrong)
    assert media.camera_task is None
    room.emit("track_subscribed", track, publication, participant)
    await started.wait()
    state.add_frame(b"current")
    task = media.camera_task
    room.emit("track_muted", participant, publication)
    assert not state.frames
    await asyncio.gather(task, return_exceptions=True)
    room.emit("track_unmuted", participant, publication)
    assert media.camera_task is not None
    await media.close()
