import { put, list } from '@vercel/blob';

export const dynamic = 'force-dynamic';

// Single shared exclusion list for everyone who logs into the account.
// Stored as one JSON blob at a fixed pathname (addRandomSuffix: false) so
// every upload overwrites the same file rather than creating a new one.
const EXCLUSION_PATHNAME = 'exclusions/account-exclusions.json';

async function readExclusions() {
  try {
    const { blobs } = await list({ prefix: EXCLUSION_PATHNAME });
    const match = blobs.find(b => b.pathname === EXCLUSION_PATHNAME);
    if (!match) return { ids: [], updatedAt: null, updatedBy: null };
    const res = await fetch(match.url, { cache: 'no-store' });
    if (!res.ok) return { ids: [], updatedAt: null, updatedBy: null };
    return await res.json();
  } catch (err) {
    console.error('[exclusions] read error:', err);
    return { ids: [], updatedAt: null, updatedBy: null };
  }
}

// ── GET — every logged-in user reads the same shared list ─────────────────
export async function GET() {
  const data = await readExclusions();
  return Response.json(data);
}

// ── POST — upload/replace the shared list (applies to everyone) ──────────
export async function POST(request) {
  try {
    const { ids, updatedBy } = await request.json();
    if (!Array.isArray(ids)) {
      return new Response(JSON.stringify({ error: 'ids must be an array' }), { status: 400 });
    }
    const payload = JSON.stringify({
      ids: [...new Set(ids.map(String))],
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || 'unknown',
    });
    await put(EXCLUSION_PATHNAME, payload, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return Response.json({ ok: true, count: ids.length });
  } catch (err) {
    console.error('[exclusions] POST error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// ── DELETE — clear the shared list for everyone ────────────────────────────
export async function DELETE() {
  try {
    const payload = JSON.stringify({ ids: [], updatedAt: new Date().toISOString(), updatedBy: null });
    await put(EXCLUSION_PATHNAME, payload, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[exclusions] DELETE error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
