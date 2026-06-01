import { listTemplates } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const templates = await listTemplates();

  return Response.json({
    templates,
    total: templates.length,
  });
}
