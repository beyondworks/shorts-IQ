import { simulateLiveSync } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  return Response.json(await simulateLiveSync());
}
