import hashlib
from pathlib import Path
from urllib.request import urlopen


MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
             "hand_landmarker/float16/1/hand_landmarker.task")
MODEL_SHA = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"


def model_path() -> Path:
    path = Path(".local/models/hand_landmarker.task")
    if not path.exists():
        with urlopen(MODEL_URL, timeout=30) as response:
            data = response.read(10 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != MODEL_SHA:
            raise ValueError("Hand detector download checksum mismatch")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    if hashlib.sha256(path.read_bytes()).hexdigest() != MODEL_SHA:
        raise ValueError("Hand detector model checksum mismatch")
    return path


class HandClassifier:
    def __init__(self, classifier):
        import mediapipe as mp

        self.mp = mp
        self.classifier = classifier
        options = mp.tasks.vision.HandLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path())),
            num_hands=2,
            min_hand_detection_confidence=0.8,
            min_hand_presence_confidence=0.8,
        )
        self.detector = mp.tasks.vision.HandLandmarker.create_from_options(options)

    def __call__(self, image, top_k=1):
        import numpy as np

        frame = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.array(image))
        hands = self.detector.detect(frame).hand_landmarks
        if len(hands) != 1:
            return [{"label": "unknown", "score": 0}]
        if any(point.x < 0 or point.x > 1 or point.y < 0 or point.y > 1 for point in hands[0]):
            return [{"label": "unknown", "score": 0}]
        return self.classifier(image, top_k=top_k)

    def close(self) -> None:
        self.detector.close()
