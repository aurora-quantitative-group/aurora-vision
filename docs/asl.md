# ASL model boundary

Gemini never receives signing frames for sign recognition. `translate_asl` sends
the latest three seconds (up to 24 JPEG frames at 8 fps) to `ASL_ENDPOINT`.
No configured endpoint means an explicit unavailable response, never fabricated
sign translation. The request has `frames: [{jpeg: "<base64>", time_ms: 0}, ...]`.
The response must have `text`, `confidence` (0–1), and `model`. Outputs below 0.9
are rejected. Confidence values are model scores, not calibrated guarantees.

For a **static fingerspelling prototype** using a separate EfficientNet model:

```sh
.venv/bin/python -m pip install -e '.[asl]'
.venv/bin/python -m aurora.letters_server
```

Set `ASL_ENDPOINT=http://127.0.0.1:8090/translate` in `.env.local`. The model weights
download from Hugging Face on first use, pinned to a specific revision. A separate
MediaPipe hand detector downloads from Google with a verified checksum. Remote
model code is disabled. This
optional service is bound to loopback, never expose it as a public API.

Hold one static letter close enough to fill the camera view, with a plain
background; ask Aurora to read the sign. At least three recent predictions must
agree above 0.9, and each classified image must contain exactly one detected,
fully visible hand. J and Z require motion and are deliberately excluded. This is
**not full ASL translation**, and classifier confidence cannot establish that a
sign is correct. Do not present it as an interpreter. In a smoke test, the raw
letter classifier labeled a blank frame as I at 0.9999999 confidence; the hand
detector gate exists to reject that failure before classification.

The actual pinned EfficientNet model plus MediaPipe detector passed the blank-
frame rejection smoke test locally. This establishes that specific input gate,
not recognition accuracy for real signers or FaceTime captures.

For word/sentence ASL, connect a validated temporal model implementing the same
clip contract. Evaluate with Deaf/ASL users, held-out signers, real Chert captures,
camera framing changes, unknown signs, and no-hand clips. A high model-card
accuracy on isolated alphabet images does not establish live-call performance.

Model and license: Apache-2.0,
https://huggingface.co/abdollahhh/asl-sign-language-efficientnet-b0
