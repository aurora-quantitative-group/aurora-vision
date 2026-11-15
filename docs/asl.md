# ASL model boundary

Gemini never receives signing frames for sign recognition. `translate_asl` sends
the latest three seconds (up to 24 JPEG frames at 8 fps) to `ASL_ENDPOINT`.
No configured endpoint means an explicit unavailable response, never fabricated
sign translation. The request has `frames: [{jpeg: "<base64>", time_ms: 0}, ...]`.
The response must have `text`, `confidence` (0–1), and `model`. Outputs below 0.9
are rejected. Confidence values are model scores, not calibrated guarantees.

For a **static fingerspelling prototype** using a separate EfficientNet model:

```sh
.venv/bin/python -m pip install 'transformers>=4.52,<6' torch torchvision
.venv/bin/python -m aurora.letters_server
```

Set `ASL_ENDPOINT=http://127.0.0.1:8090/translate` in `.env.local`. The model weights
download from Hugging Face on first use. Remote model code is disabled. This
optional service is bound to loopback, never expose it as a public API.

Hold one static letter close enough to fill the camera view, with a plain
background; ask Aurora to read the sign. At least three recent predictions must
agree above 0.9. J and Z require motion and are deliberately excluded. This is
**not full ASL translation**, and classifier confidence cannot establish that a
hand is present or the sign is correct. Do not present it as an interpreter.

For word/sentence ASL, connect a validated temporal model implementing the same
clip contract. Evaluate with Deaf/ASL users, held-out signers, real Chert captures,
camera framing changes, unknown signs, and no-hand clips. A high model-card
accuracy on isolated alphabet images does not establish live-call performance.

Model and license: Apache-2.0,
https://huggingface.co/abdollahhh/asl-sign-language-efficientnet-b0
