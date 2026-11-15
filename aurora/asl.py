import asyncio
import base64
from collections import Counter
from io import BytesIO

import httpx
from PIL import Image
from pydantic import BaseModel, Field

from aurora.state import Frame


class ASLResult(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    confidence: float = Field(ge=0, le=1)
    model: str = Field(min_length=1, max_length=200)


class ASL:
    def __init__(self, endpoint: str, key: str):
        self.endpoint = endpoint
        self.key = key
        self.client = httpx.AsyncClient(timeout=8, follow_redirects=False)

    async def translate(self, frames: list[Frame]) -> str:
        if not self.endpoint:
            return ("ASL translation isn't configured. It needs a separate validated sign-language "
                    "model; Gemini is not used for sign recognition.")
        if len(frames) < 8 or frames[-1].received_at - frames[0].received_at < 1:
            return "I need a longer camera clip. Keep your hands and upper body visible for two seconds."
        response = await self.client.post(
            self.endpoint,
            headers={"Authorization": f"Bearer {self.key}"} if self.key else {},
            json={"frames": [{"jpeg": base64.b64encode(f.jpeg).decode(),
                              "time_ms": round((f.received_at - frames[0].received_at) * 1000)}
                             for f in frames]},
        )
        response.raise_for_status()
        result = ASLResult.model_validate(response.json())
        if result.confidence < 0.9:
            return "I couldn't confidently recognize that sign. Please repeat it with your hands visible."
        return f"The sign model suggests: {result.text}. Please confirm."

    async def close(self) -> None:
        await self.client.aclose()


def classify_letters(images: list[bytes], classifier) -> ASLResult:
    predictions = []
    for jpeg in images[-5:]:
        image = Image.open(BytesIO(jpeg)).convert("RGB")
        best = classifier(image, top_k=1)[0]
        label = best["label"].upper()
        if len(label) == 1 and label in "ABCDEFGHIKLMNOPQRSTUVWXY" and best["score"] >= 0.9:
            predictions.append((label, best["score"]))
    if not predictions:
        return ASLResult(text="Unrecognized", confidence=0, model="asl-efficientnet-b0")
    label, count = Counter(label for label, _ in predictions).most_common(1)[0]
    confidence = min(score for letter, score in predictions if letter == label) if count >= 3 else 0
    return ASLResult(text=f"Letter {label}", confidence=confidence, model="asl-efficientnet-b0")


async def load_letter_classifier():
    from transformers import pipeline

    return await asyncio.to_thread(
        pipeline, "image-classification", model="abdollahhh/asl-sign-language-efficientnet-b0",
        revision="28c016f94a07aa9d0c7a747b960d8d9931309c9a",
        trust_remote_code=False,
    )
