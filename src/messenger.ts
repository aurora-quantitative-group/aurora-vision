import type { Config } from './config.ts';
import type { Dbs, Match, User } from './db.ts';

const BASE_URL = 'https://app.trychert.com/api/v1';

export interface InboundMessage { id: string; phone: string; text: string; at: Date }

const pick = (o: Record<string, unknown>, ...keys: string[]) => keys.map(k => o[k]).find(v => v !== undefined && v !== null);

// Chert wraps lists as { data: { items: [...] } }.
function listFrom(body: unknown): Record<string, unknown>[] {
  const items = (body as { data?: { items?: unknown } } | null)?.data?.items;
  return Array.isArray(items) ? items : [];
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

// Chert's message payload is not documented field by field, so this accepts the likely names and skips
// anything that is not clearly an inbound text.
export function toInbound(raw: Record<string, unknown>): InboundMessage | null {
  const direction = String(pick(raw, 'direction', 'type', 'kind') ?? '').toLowerCase();
  if (!direction.startsWith('in') && direction !== 'received') return null;
  const id = pick(raw, 'id', 'message_id');
  const phone = pick(raw, 'sender', 'from', 'phone', 'handle', 'recipient');
  const text = pick(raw, 'text', 'body');
  const at = pick(raw, 'created_at', 'received_at', 'sent_at', 'timestamp');
  if (typeof id !== 'string' || typeof phone !== 'string' || typeof text !== 'string') return null;
  return { id, phone: normalizePhone(phone), text, at: at ? new Date(String(at)) : new Date() };
}

export function parseReply(text: string): 'yes' | 'no' | null {
  const word = text.trim().toLowerCase().replace(/[^a-z]/g, ' ').trim().split(/\s+/)[0];
  if (word === 'yes' || word === 'y' || word === 'yeah' || word === 'yep') return 'yes';
  if (word === 'no' || word === 'n' || word === 'nope' || word === 'pass') return 'no';
  return null;
}

export class ChertClient {
  private readonly key: string;
  private readonly projectId: string;
  private lineId: string | undefined;

  constructor(config: Pick<Config, 'CHERT_API_KEY' | 'CHERT_PROJECT_ID' | 'CHERT_LINE_ID'>) {
    if (!config.CHERT_API_KEY || !config.CHERT_PROJECT_ID) throw new Error('CHERT_API_KEY and CHERT_PROJECT_ID are required for the messenger');
    this.key = config.CHERT_API_KEY;
    this.projectId = config.CHERT_PROJECT_ID;
    this.lineId = config.CHERT_LINE_ID;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        'x-chert-project-id': this.projectId,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Chert ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  private async line(): Promise<string> {
    if (this.lineId) return this.lineId;
    const lines = listFrom(await this.request('GET', '/lines'));
    const id = lines[0]?.id;
    if (typeof id !== 'string') throw new Error('Chert returned no line for this project');
    this.lineId = id;
    return id;
  }

  // The caller's handle for a call: a phone number, or an Apple ID email when they called from one.
  async callerOf(callId: string): Promise<{ type: string; value: string } | null> {
    const body = await this.request('GET', `/calls/${encodeURIComponent(callId)}`) as { data?: { from?: { type?: string; value?: string } } } | null;
    const from = body?.data?.from;
    return from?.value ? { type: String(from.type ?? ''), value: from.value } : null;
  }

  async send(recipient: string, text: string, idempotencyKey: string): Promise<void> {
    await this.request('POST', '/shared-messages', { line_id: await this.line(), recipient, text }, idempotencyKey);
  }

  async recentInbound(): Promise<InboundMessage[]> {
    const raw = listFrom(await this.request('GET', '/shared-messages'));
    return raw.map(toInbound).filter((m): m is InboundMessage => m !== null);
  }
}

export const INTRO_SUFFIX = "Reply YES if you'd like to be introduced, or NO to pass.";
// The same text goes to both people whoever declined, so nobody learns who said NO.
export const CLOSED_TEXT = "This introduction has closed. We'll keep looking for your next match.";
export const WAITING_TEXT = "Got it. We'll text you if it's mutual.";

export class Messenger {
  private readonly dbs: Dbs;
  private readonly chert: ChertClient;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(dbs: Dbs, chert: ChertClient) {
    this.dbs = dbs;
    this.chert = chert;
  }

  private async log(matchId: string, userId: string | null, event: string) {
    await this.dbs.tiger.query('INSERT INTO match_events (match_id, user_id, event) VALUES ($1, $2, $3)', [matchId, userId, event]);
  }

  // Seed users have fake numbers and are never texted.
  private async text(user: User, body: string, key: string): Promise<boolean> {
    if (user.seed) { console.log(`[messenger] not texting seed user ${user.first_name}: ${body.split('\n')[0]}`); return false; }
    await this.chert.send(user.phone, body, key);
    return true;
  }

  async sendIntro(match: Match): Promise<void> {
    const users = await this.dbs.users.find({ _id: { $in: match.user_ids } }).toArray();
    for (const user of users) {
      try {
        if (await this.text(user, `Aurora, your AI matchmaker, here.\n${match.intro}\n\n${INTRO_SUFFIX}`, `intro-${match._id}-${user._id}`)) {
          await this.log(match._id, user._id, 'intro_sent');
        }
      } catch (error) {
        console.error(`[messenger] intro to ${user._id} failed`, (error as Error).message);
        await this.log(match._id, user._id, 'intro_failed');
      }
    }
  }

  async handleReply(phone: string, text: string): Promise<void> {
    const reply = parseReply(text);
    if (!reply) return;
    const user = await this.dbs.users.findOne({ phone });
    if (!user) return;
    const match = await this.dbs.matches.findOneAndUpdate(
      { user_ids: user._id, status: 'proposed', [`replies.${user._id}`]: { $exists: false } },
      { $set: { [`replies.${user._id}`]: reply } },
      { returnDocument: 'after' },
    );
    if (!match) return;
    await this.log(match._id, user._id, reply);
    const users = await this.dbs.users.find({ _id: { $in: match.user_ids } }).toArray();

    if (reply === 'no') {
      const closed = await this.dbs.matches.updateOne({ _id: match._id, status: 'proposed' }, { $set: { status: 'declined', closed_at: new Date() } });
      if (!closed.modifiedCount) return;
      await this.log(match._id, null, 'declined');
      for (const u of users) await this.text(u, CLOSED_TEXT, `closed-${match._id}-${u._id}`);
      return;
    }

    if (Object.values(match.replies).filter(r => r === 'yes').length < 2) {
      await this.text(user, WAITING_TEXT, `waiting-${match._id}-${user._id}`);
      return;
    }
    const connected = await this.dbs.matches.updateOne({ _id: match._id, status: 'proposed' }, { $set: { status: 'connected', closed_at: new Date() } });
    if (!connected.modifiedCount) return;
    await this.log(match._id, null, 'connected');
    for (const u of users) {
      const other = users.find(o => o._id !== u._id)!;
      await this.text(u, `It's mutual! ${other.first_name}'s number is ${other.phone}. Say hi!`, `connected-${match._id}-${u._id}`);
    }
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const state = await this.dbs.messenger.findOne({ _id: 'chert' })
        ?? { _id: 'chert', last_seen_at: new Date(), seen_ids: [] };
      const fresh = (await this.chert.recentInbound())
        .filter(m => m.at > new Date(state.last_seen_at.getTime() - 60_000) && !state.seen_ids.includes(m.id))
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      for (const message of fresh) {
        try { await this.handleReply(message.phone, message.text); }
        catch (error) { console.error('[messenger] reply failed', error); }
        state.seen_ids.push(message.id);
        if (message.at > state.last_seen_at) state.last_seen_at = message.at;
      }
      await this.dbs.messenger.updateOne(
        { _id: 'chert' },
        { $set: { last_seen_at: state.last_seen_at, seen_ids: state.seen_ids.slice(-200) } },
        { upsert: true },
      );
    } catch (error) {
      console.error('[messenger] poll failed', (error as Error).message);
    } finally {
      this.polling = false;
    }
  }

  start(intervalMs = 5000): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
