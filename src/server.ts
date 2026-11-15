import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { functionDeclarations } from './agent/declarations.ts';
import { CONSENT_LINE, systemPrompt } from './agent/system-prompt.ts';
import { loadConfig } from './config.ts';
import { connect } from './db.ts';
import { Gemini } from './gemini.ts';
import { MatchError, proposeMatch } from './matcher.ts';
import { ChertClient, Messenger, normalizePhone } from './messenger.ts';
import { enqueue } from './queue.ts';
import { TOOLS } from './tools.ts';
import type { ToolContext } from './tools.ts';
import { deleteUser } from './users.ts';

const config = loadConfig();
const dbs = await connect(config);
const ctx: ToolContext = { dbs, gemini: new Gemini(config) };
const chert = config.CHERT_API_KEY ? new ChertClient(config) : undefined;
const messenger = chert ? new Messenger(dbs, chert) : undefined;
if (!messenger) console.warn('[messenger] CHERT_API_KEY not set: intros are saved but not texted');

const app = Fastify({ logger: { level: 'info' } });
const UserId = z.object({ user_id: z.uuid() });

app.post('/tools/:name', async (request, reply) => {
  const { name } = request.params as { name: string };
  const tool = TOOLS[name as keyof typeof TOOLS];
  if (!tool) return reply.code(404).send({ ok: false, error: `Unknown tool ${name}` });
  try {
    return await tool(ctx, request.body);
  } catch (error) {
    if (error instanceof z.ZodError) return reply.code(400).send({ ok: false, error: z.prettifyError(error) });
    throw error;
  }
});

// Called by the voice agent when a FaceTime call connects: who is calling, plus the prompt and tools for the call.
app.post('/calls/:call_id/start', async (request, reply) => {
  const { call_id } = z.object({ call_id: z.uuid() }).parse(request.params);
  if (!chert) return reply.code(503).send({ error: 'CHERT_API_KEY is not set' });
  const from = await chert.callerOf(call_id);
  const phone = from && /^\+?\d{10,15}$/.test(from.value.replace(/[\s().-]/g, '')) ? normalizePhone(from.value) : null;
  const user = phone ? await dbs.users.findOne({ phone }, { projection: { first_name: 1, consent: 1 } }) : null;
  const call = { user_id: user?._id ?? randomUUID(), phone, call_id, returning_name: user?.consent ? user.first_name : undefined };
  request.log.info({ call_id, known_user: Boolean(user), has_phone: Boolean(phone) }, 'call started');
  return { ...call, consent_line: CONSENT_LINE, instructions: systemPrompt(call), tools: functionDeclarations };
});

app.post('/match/:user_id', async (request, reply) => {
  const { user_id } = UserId.parse(request.params);
  try {
    const match = await proposeMatch(dbs, ctx.gemini, user_id);
    if (messenger) enqueue('send_intro', () => messenger.sendIntro(match));
    return reply.code(201).send(match);
  } catch (error) {
    if (error instanceof MatchError) return reply.code(error.status).send({ error: error.message });
    throw error;
  }
});

app.delete('/users/:user_id', async request => {
  const { user_id } = UserId.parse(request.params);
  return deleteUser(dbs, user_id);
});

app.get('/health', async () => ({ ok: true }));

app.addHook('onClose', async () => { messenger?.stop(); await dbs.close(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close());

await app.listen({ port: config.PORT, host: '0.0.0.0' });
messenger?.start(5000);
