import { loadStats } from '../../../lib/tiger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await loadStats());
  } catch (error) {
    console.error('[stats]', error);
    return Response.json({ error: 'Could not read Tiger Data' }, { status: 500 });
  }
}
