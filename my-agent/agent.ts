import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { ActivityHandling } from '@google/genai';
import type { JSONSchema7 } from 'json-schema';
import { runAgent } from './chert-rooms.ts';
import { greetOnBridgeReady } from './greet.ts';

const API = process.env.MATCHMAKER_API_URL || 'http://localhost:3001';

interface ToolDeclaration { name: string; description: string; parametersJsonSchema: JSONSchema7 }

interface CallSetup {
  user_id: string;
  phone: string | null;
  call_id: string;
  consent_line: string;
  instructions: string;
  tools: ToolDeclaration[];
}

const OFFLINE_LINE = "Hi, I'm Aurora, an AI matchmaker. Sorry, my matchmaking service is offline right now, so I can't save anything. Please call back a little later.";

async function startCall(callId: string): Promise<CallSetup | null> {
  try {
    const response = await fetch(`${API}/calls/${callId}/start`, { method: 'POST', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return await response.json() as CallSetup;
  } catch (error) {
    console.error('[matchmaker] could not start the call', error);
    return null;
  }
}

// Each Gemini tool is forwarded to the matchmaker API. Identity fields come from the call, never from the model.
function matchmakerTools(setup: CallSetup) {
  return Object.fromEntries(setup.tools.map(declaration => [declaration.name, llm.tool({
    description: declaration.description,
    parameters: declaration.parametersJsonSchema,
    execute: async (args: Record<string, unknown>) => {
      const body = { ...args, user_id: setup.user_id, call_id: setup.call_id, ...(declaration.name === 'record_consent' && setup.phone ? { phone: setup.phone } : {}) };
      try {
        const response = await fetch(`${API}/tools/${declaration.name}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
        const result = await response.json();
        console.log(`[matchmaker] ${declaration.name}(${String(args.key ?? '')}) -> ${JSON.stringify(result).slice(0, 160)}`);
        return result;
      } catch (error) {
        console.error(`[matchmaker] ${declaration.name} failed`, error);
        return { ok: false, error: 'The matchmaking service did not respond. Tell the caller you could not save that.' };
      }
    },
  })]));
}

const agent = defineAgent({
  entry: async ctx => {
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    // Join promptly so Chert can find us, but wait for a caller before opening a paid model session.
    const caller = await ctx.waitForParticipant();
    const setup = await startCall(caller.identity.replace(/^chert-bridge-/, ''));
    const session = new voice.AgentSession({
      // FaceTime background noise kept cutting speech off mid-sentence, so neither Gemini nor LiveKit may interrupt it.
      llm: new google.realtime.RealtimeModel({
        model: 'gemini-3.1-flash-live-preview',
        apiVersion: 'v1alpha',
        voice: 'Kore',
        realtimeInputConfig: { activityHandling: ActivityHandling.NO_INTERRUPTION },
      }),
      // gemini-3.1-flash-live-preview ignores generateReply, so the opening line is spoken through TTS with session.say.
      tts: new google.beta.TTS({ model: 'gemini-3.1-flash-tts-preview', voiceName: 'Kore' }),
      turnHandling: { interruption: { enabled: false } },
    });
    ctx.addShutdownCallback(() => session.close());
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({
        instructions: setup?.instructions ?? 'You are Aurora. The matchmaking service is offline: you cannot save anything. Apologise and suggest calling back later.',
        tools: setup ? matchmakerTools(setup) : undefined,
      }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: true,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });
    // The Mac ends the call if it hears nothing within 10 seconds of bridge_ready, so speak on that signal only.
    const stopGreeting = greetOnBridgeReady(ctx.room, () => session.say(setup?.consent_line ?? OFFLINE_LINE));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'student-agent' });
