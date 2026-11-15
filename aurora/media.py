import asyncio
import logging
import textwrap
import time
from io import BytesIO

from livekit import rtc
from PIL import Image, ImageDraw, ImageFont

from aurora.state import CallState


logger = logging.getLogger("aurora.media")


def encode_frame(frame: rtc.VideoFrame) -> bytes:
    rgb = frame.convert(rtc.VideoBufferType.RGB24)
    image = Image.frombytes("RGB", (rgb.width, rgb.height), bytes(rgb.data))
    image.thumbnail((640, 480))
    output = BytesIO()
    image.save(output, format="JPEG", quality=80)
    return output.getvalue()


def status_image(state: CallState) -> Image.Image:
    image = Image.new("RGB", (640, 360), "#091e29")
    draw = ImageDraw.Draw(image)
    title = ImageFont.load_default(size=32)
    body = ImageFont.load_default(size=23)
    small = ImageFont.load_default(size=17)
    draw.text((28, 22), "AURORA VISION", font=title, fill="#91e8c2")
    try:
        state.current()
    except ValueError:
        pass
    draw.text((28, 72), state.video_status, font=small, fill="white")
    for index, line in enumerate(textwrap.wrap(state.caption[:240], width=42)[:6]):
        draw.text((28, 112 + index * 29), line, font=body, fill="white")
    label = "Alerts active" if state.scanning else "Alerts paused"
    draw.text((28, 314), f"{label}  |  AI demo - ask when unsure", font=small, fill="#91e8c2")
    return image


class Media:
    def __init__(self, room: rtc.Room, state: CallState):
        self.room = room
        self.state = state
        self.identity = ""
        self.camera_sid = ""
        self.camera_task: asyncio.Task | None = None
        self.card_task: asyncio.Task | None = None
        self.publication = None
        self.handlers = [
            ("track_subscribed", self.subscribed),
            ("track_unsubscribed", self.unsubscribed),
            ("track_muted", self.muted),
            ("track_unmuted", self.unmuted),
            ("participant_disconnected", self.disconnected),
        ]
        for name, handler in self.handlers:
            room.on(name, handler)

    def bind(self, identity: str) -> None:
        self.identity = identity
        participant = self.room.remote_participants.get(identity)
        if participant:
            for publication in participant.track_publications.values():
                if publication.track and not publication.muted:
                    self.subscribed(publication.track, publication, participant)

    def subscribed(self, track, publication, participant) -> None:
        if (participant.identity != self.identity or publication.name != "facetime-remote-video"
                or track.kind != rtc.TrackKind.KIND_VIDEO or publication.muted):
            return
        if self.camera_sid == publication.sid:
            return
        self.stop_camera()
        self.camera_sid = publication.sid
        self.camera_task = asyncio.create_task(self.capture(track))

    def stop_camera(self) -> None:
        if self.camera_task:
            self.camera_task.cancel()
        self.camera_task = None
        self.camera_sid = ""
        self.state.clear_camera()

    def unsubscribed(self, track, publication, participant) -> None:
        self.muted(publication, participant)

    def muted(self, publication, participant) -> None:
        if participant.identity == self.identity and publication.sid == self.camera_sid:
            self.stop_camera()

    def unmuted(self, publication, participant) -> None:
        if publication.track:
            self.subscribed(publication.track, publication, participant)

    def disconnected(self, participant) -> None:
        if participant.identity == self.identity:
            self.stop_camera()

    async def capture(self, track) -> None:
        stream = rtc.VideoStream(track, capacity=1)
        last_frame = 0.0
        try:
            async for event in stream:
                now = time.monotonic()
                if now - last_frame < 0.125:
                    continue
                self.state.add_frame(encode_frame(event.frame))
                last_frame = now
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Caller video capture failed")
        finally:
            await stream.aclose()
            self.state.clear_camera()

    async def publish_card(self) -> None:
        source = rtc.VideoSource(640, 360)
        track = rtc.LocalVideoTrack.create_video_track("aurora-status", source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
        self.publication = await self.room.local_participant.publish_track(track, options)

        async def render() -> None:
            while True:
                image = status_image(self.state)
                source.capture_frame(rtc.VideoFrame(640, 360, rtc.VideoBufferType.RGB24, image.tobytes()))
                await asyncio.sleep(0.25)

        self.card_task = asyncio.create_task(render())

    async def close(self) -> None:
        for name, handler in self.handlers:
            self.room.off(name, handler)
        tasks = [task for task in (self.camera_task, self.card_task) if task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.state.clear_camera()
        if self.publication and self.room.isconnected():
            await self.room.local_participant.unpublish_track(self.publication.sid)
