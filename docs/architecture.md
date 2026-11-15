# Aurora Vision

The HackUTA integration uses the **managed Chert FaceTime API**, not the separate
open-source Chrome connector. Chert accepts incoming calls and dispatches our
named LiveKit agent through `chert dev`. Each call gets independent memory and
perception state.

FaceTime → Chert → LiveKit caller audio → ElevenLabs STT → Gemini text reasoning
→ ElevenLabs TTS → LiveKit agent audio → Chert → FaceTime.

Caller video → bounded, expiring frame buffer → Gemini visual analysis and
periodic hazard checks. ASL clips go exclusively to a separate model endpoint.
The speaking participant also publishes a status-card video track with captions.
Frames and recaps remain in memory and disappear when the call ends. Provider
retention policies still apply; this does not imply provider zero retention.

Startup waits for `chert_bridge_ready` before greeting. Caller capture must be
enabled on the assigned Chert line. Capture can include FaceTime controls and
self-preview; a received track alone does not prove usable caller-camera video.

Facial-cue inference is excluded from the demo. Do not infer stress, intent,
dangerousness, identity, or medical conditions from appearance.

Sources:
- https://www.trychert.com/uta
- https://app.trychert.com/skills.md
- https://docs.trychert.com/facetime/audio-video
- https://docs.trychert.com/facetime-cli/build-agent
