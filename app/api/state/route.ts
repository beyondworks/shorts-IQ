import { readVisibleState } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json(await readVisibleState());
}
