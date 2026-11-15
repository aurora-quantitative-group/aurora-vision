// chert dev sets room metadata to {"chert_bridge_ready":true,...} when FaceTime is ready; the Mac ends
// a call that hears nothing within 10 seconds of that, so the agent greets then and only then.

// RoomEvent.RoomMetadataChanged in @livekit/rtc-node. The room's metadata is already updated when it fires.
const METADATA_CHANGED = 'roomMetadataChanged';

interface MetadataRoom {
  metadata?: string;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

export function bridgeReady(metadata: string | undefined): boolean {
  try { return JSON.parse(metadata || '{}')?.chert_bridge_ready === true; } catch { return false; }
}

export function greetOnBridgeReady(room: MetadataRoom, greet: () => unknown): () => void {
  let done = false;
  const stop = () => { done = true; room.off(METADATA_CHANGED, check); };
  function check() {
    if (done || !bridgeReady(room.metadata)) return;
    stop();
    try { greet(); } catch { /* the call ended first */ }
  }
  room.on(METADATA_CHANGED, check);
  check();
  return stop;
}
