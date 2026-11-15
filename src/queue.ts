// In-process background queue so tool handlers can answer Gemini fast. Jobs are lost on restart, which is
// acceptable for the demo; a durable queue would replace this.
const jobs: { name: string; run: () => Promise<void> }[] = [];
let running: Promise<void> | undefined;

export function enqueue(name: string, run: () => Promise<void>): void {
  jobs.push({ name, run });
  running ??= work().finally(() => { running = undefined; });
}

async function work() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const started = Date.now();
    try { await job.run(); }
    catch (error) { console.error(`[queue] ${job.name} failed`, error); }
    if (Date.now() - started > 2000) console.warn(`[queue] ${job.name} took ${Date.now() - started} ms`);
  }
}

export async function drain(): Promise<void> {
  while (running) await running;
}
