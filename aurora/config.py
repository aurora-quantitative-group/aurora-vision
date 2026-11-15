import os
from dataclasses import dataclass
from math import isfinite

from dotenv import load_dotenv


def positive_number(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive finite number")
    return value


@dataclass(frozen=True)
class Settings:
    agent_name: str
    google_key: str
    gemini_model: str
    eleven_key: str
    voice_id: str
    stt_model: str
    tts_model: str
    scan_interval: float
    frame_max_age: float
    alert_cooldown: float
    asl_endpoint: str
    asl_key: str

    @classmethod
    def load(cls) -> "Settings":
        load_dotenv(".env.local")
        required = ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
                    "GOOGLE_API_KEY", "ELEVEN_API_KEY")
        missing = [name for name in required if not os.getenv(name)]
        if missing:
            raise ValueError("Set these values privately in .env.local: " + ", ".join(missing))
        return cls(
            agent_name=os.getenv("AGENT_NAME", "aurora-vision"),
            google_key=os.environ["GOOGLE_API_KEY"],
            gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
            eleven_key=os.environ["ELEVEN_API_KEY"],
            voice_id=os.getenv("ELEVEN_VOICE_ID", "hpp4J3VqNfWAUOO0d1Us"),
            stt_model=os.getenv("ELEVEN_STT_MODEL", "scribe_v2_realtime"),
            tts_model=os.getenv("ELEVEN_TTS_MODEL", "eleven_turbo_v2_5"),
            scan_interval=positive_number("SCAN_INTERVAL_SECONDS", 2),
            frame_max_age=positive_number("FRAME_MAX_AGE_SECONDS", 3),
            alert_cooldown=positive_number("ALERT_COOLDOWN_SECONDS", 12),
            asl_endpoint=os.getenv("ASL_ENDPOINT", ""),
            asl_key=os.getenv("ASL_API_KEY", ""),
        )
