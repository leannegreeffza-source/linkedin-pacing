import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

// Vercel serverless — no persistent filesystem.
// Exclusions are stored client-side in localStorage.
// This endpoint exists only for compatibility — returns empty list.
export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  return Response.json({ excludedAccountIds: [] });
}

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  return Response.json({ ok: true });
}