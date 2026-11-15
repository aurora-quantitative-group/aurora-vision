import asyncio
import logging
import os

from dotenv import load_dotenv
from livekit.agents import AgentServer, AgentSession, AutoSubscribe, JobContext, cli, room_io
from livekit.plugins import elevenlabs, google, silero

from aurora.asl import ASL
from aurora.companion import Companion, scan_loop
from aurora.config import Settings
from aurora.lifecycle import wait_for_bridge
from aurora.media import Media
from aurora.state import CallState
from aurora.vision import Vision


load_dotenv(".env.local")
logger = logging.getLogger("aurora")
server = AgentServer()


def create_session(settings: Settings) -> AgentSession:
    return AgentSession(
        stt=elevenlabs.STT(api_key=settings.eleven_key, model=settings.stt_model, use_realtime=True),
        llm=google.LLM(api_key=settings.google_key, model=settings.gemini_model),
        tts=elevenlabs.TTS(api_key=settings.eleven_key, voice_id=settings.voice_id, model=settings.tts_model),
        vad=silero.VAD.load(),
    )


@server.rtc_session(agent_name=os.getenv("AGENT_NAME", "aurora-vision"))
async def entrypoint(ctx: JobContext) -> None:
    settings = Settings.load()
    state = CallState(settings.frame_max_age, settings.alert_cooldown)
    media = Media(ctx.room, state)
    session = None
    vision = None
    asl = None
    scan = None

    async def close() -> None:
        if scan:
            scan.cancel()
            await asyncio.gather(scan, return_exceptions=True)
        resources = [media]
        if session:
            resources.append(session)
        if vision:
            resources.append(vision)
        if asl:
            resources.append(asl)
        try:
            results = await asyncio.gather(
                *(resource.aclose() if resource is session else resource.close()
                  for resource in resources), return_exceptions=True,
            )
            for result in results:
                if isinstance(result, Exception):
                    logger.error("Call resource cleanup failed: %s", type(result).__name__)
        finally:
            state.clear()

    ctx.add_shutdown_callback(close)
    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
    caller = await ctx.wait_for_participant()
    if not caller.identity.startswith("chert-bridge-"):
        raise ValueError("Expected the managed Chert bridge participant")
    media.bind(caller.identity)
    await media.publish_card()
    await wait_for_bridge(ctx.room)
    vision = Vision(settings.google_key, settings.gemini_model)
    asl = ASL(settings.asl_endpoint, settings.asl_key)
    session = create_session(settings)

    @session.on("conversation_item_added")
    def remember(event) -> None:
        item = event.item
        if item.role not in ("user", "assistant"):
            return
        text = item.text_content
        if text:
            state.remember(f"{item.role}: {text}")
            if item.role == "assistant":
                state.caption = text[:240]

    await session.start(
        agent=Companion(state, vision, asl),
        room=ctx.room,
        record=False,
        room_options=room_io.RoomOptions(
            participant_identity=caller.identity,
            audio_input=True,
            video_input=False,
            text_input=False,
            text_output=False,
            close_on_disconnect=True,
            delete_room_on_close=False,
        ),
    )
    greeting = "Hi, I'm Aurora, your AI visual companion. What would you like help with?"
    state.caption = greeting
    await session.say(greeting, allow_interruptions=True)
    scan = asyncio.create_task(scan_loop(state, vision, session, settings.scan_interval))


if __name__ == "__main__":
    cli.run_app(server)
