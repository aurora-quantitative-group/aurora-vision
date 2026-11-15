import hashlib
import time
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class Frame:
    jpeg: bytes
    received_at: float
    changed_at: float
    generation: int


class CallState:
    def __init__(self, max_age: float, cooldown: float):
        self.max_age = max_age
        self.cooldown = cooldown
        self.frames: deque[Frame] = deque(maxlen=24)
        self.events: deque[str] = deque(maxlen=60)
        self.alerts: dict[str, float] = {}
        self.scanning = True
        self.caption = "Waiting for FaceTime"
        self.video_status = "No caller camera"
        self.generation = 0
        self._digest = b""

    def clear_camera(self) -> None:
        self.generation += 1
        self.frames.clear()
        self._digest = b""
        self.video_status = "Camera unavailable"

    def add_frame(self, jpeg: bytes, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        digest = hashlib.sha256(jpeg).digest()
        changed_at = now
        if digest == self._digest and self.frames:
            changed_at = self.frames[-1].changed_at
        self._digest = digest
        self.frames.append(Frame(jpeg, now, changed_at, self.generation))
        self.video_status = "Caller camera receiving"

    def current(self, now: float | None = None) -> Frame:
        now = time.monotonic() if now is None else now
        if not self.frames:
            raise ValueError("I don't have a caller camera image. Turn on your camera.")
        frame = self.frames[-1]
        if now - min(frame.received_at, frame.changed_at) > self.max_age:
            self.video_status = "Camera stale or frozen"
            raise ValueError("The camera image is stale or frozen. Move the camera slightly.")
        return frame

    def is_current(self, frame: Frame) -> bool:
        try:
            current = self.current()
        except ValueError:
            return False
        return (frame.generation == current.generation
                and time.monotonic() - frame.received_at <= self.max_age)

    def should_alert(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        if now - self.alerts.get(key, -float("inf")) < self.cooldown:
            return False
        self.alerts = {k: t for k, t in self.alerts.items() if now - t < self.cooldown}
        self.alerts[key] = now
        return True

    def remember(self, text: str) -> None:
        self.events.append(text[:1000])

    def clear(self) -> None:
        self.clear_camera()
        self.events.clear()
        self.alerts.clear()
