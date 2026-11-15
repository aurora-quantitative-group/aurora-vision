# Aurora Vision

An AI visual companion on a real FaceTime call, built for HackUTA's Chert track.
**Chert managed FaceTime → LiveKit → ElevenLabs STT → Gemini → ElevenLabs TTS.**
The caller's camera also feeds Gemini vision and a separate ASL model boundary.

Implemented:
- Identify visible cash denominations and currencies; calculate visible totals.
- Sample the camera continuously, announcing high-confidence, high-priority
  visible hazards with interruption and duplicate-alert suppression.
- Translate spoken exchanges with Gemini after ElevenLabs transcription.
- Recap the current call on request, using bounded in-memory notes.
- Publish a caption/status video from the same participant that speaks.
- Reject missing, muted, stale, and identically frozen camera frames.
- Send ASL clips to a separate model; optional local static-letter prototype.

Full sentence-level ASL requires a validated temporal model; the bundled optional
model recognizes static letters only. Facial cue inference is excluded from the
demo. This is an assistive prototype: it cannot establish that a route is safe,
authenticate currency, or replace a mobility aid or interpreter.

## Local setup

Use Python 3.12+ and Node 24. Node is required by Chert, not the Python agent.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
cp .env.example .env.local
chmod 600 .env.local
```

If `.env.local` already exists, preserve it. Fill its values privately in your
editor. Never paste provider keys into chat or commit them.

| Variable | Where it comes from |
| --- | --- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | One LiveKit Cloud project |
| `GOOGLE_API_KEY` | Google AI Studio, with access to the configured Gemini model |
| `ELEVEN_API_KEY` | Your ElevenLabs account, with STT and TTS access |
| `AGENT_NAME` | `aurora-vision`; use the same name in Chert dispatch |

`GEMINI_MODEL`, voice, and speech model IDs are configurable in `.env.local`.
Provider availability and credits must be checked in your own accounts. Calls
use model-provider and LiveKit credits; Chert's trial does not cover those costs.

## Connect the sponsor line

With `.env.local` filled in and dependencies installed, start everything with:

```sh
.venv/bin/python -m aurora.run
```

This checks Chert sign-in, runs first-time onboarding when needed, starts the
configured local ASL service, waits for LiveKit registration, and connects the
FaceTime line. Follow the printed browser steps on first use. Ctrl+C stops all
services; private logs are in `.local/logs/`. Use `--check` to validate local
settings without starting services. The individual commands follow below.

Use [Chert's official onboarding skill](https://app.trychert.com/skills.md).
For a first-time account:

```sh
./scripts/chert onboard --json --no-browser --plan trial --stack demo
```

Open the printed approval URL, sign in, verify your phone with the iMessage code,
and answer Chert's hosted demo call. Wait for `onboarding_done` with
`demo_outcome: "ended"`. If already onboarded, reuse that project and skip the
demo. `./scripts/chert whoami` checks the selected project. Sign-in state and npm
cache are private under `.local/`; the wrapper pins Chert beta.21.

After onboarding, configure that verified project:

```sh
./scripts/chert setup --env-file .env.local --project YOUR_VERIFIED_PROJECT_ID
.venv/bin/python -m aurora.agent download-files
.venv/bin/python -m aurora.agent start
```

Leave the agent running. In a second terminal in this repository:

```sh
./scripts/chert doctor
./scripts/chert dev --agent aurora-vision
```

Call the assigned Chert line from your verified iPhone using **FaceTime Video**.
Keep both processes running. The agent waits for the bridge-ready room signal
before greeting. A warm-room job alone does not start a paid model session.

Confirm with Chert staff that **caller-camera capture is enabled** on your line.
Receiving audio or publishing our status card does not establish caller capture.
Chert capture can include controls or self-preview; test that the model observes
the main caller view. Our stale-frame check catches exact freezes, not every
possible failure or a wrong capture region with changing UI.

## Try it

Show one bill: “What cash am I holding?”
Point at the surroundings: “What can you see?”
Ask: “Translate what I say into Spanish,” then speak a short sentence.
Ask: “Pause environmental alerts,” “Resume environmental alerts,” or
“Give me a quick recap.”

For signing, see [ASL setup and limits](docs/asl.md). For the pitch and two-call
rehearsal, see [demo guide](docs/demo.md). Keep the phone's camera unobstructed and
route FaceTime audio through the user's earpiece/headphones using iOS controls.

## Verify

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m pip check
.venv/bin/python scripts/check_commits.py
```

Tests use synthetic frames and mocked providers; they do not establish real
FaceTime media quality, perception accuracy, live latency, or ASL accuracy.
Run the rehearsal on the assigned line before presenting. No raw call media is
saved by application code and LiveKit session recording is disabled. Provider,
framework, and platform logs/retention remain separate considerations.
