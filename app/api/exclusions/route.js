import { put, get } from '@vercel/blob';

export const dynamic = 'force-dynamic';

// Single shared exclusion list for everyone who logs into the account.
// Stored as one JSON blob at a fixed pathname (addRandomSuffix: false) so
// every upload overwrites the same file rather than creating a new one.
//
// NOTE: this store is PRIVATE (Vercel's current Blob stores don't offer a
// public option), so reads must go through the authenticated get() SDK
// method rather than a plain fetch() of a public URL.
const EXCLUSION_PATHNAME = 'exclusions/account-exclusions.json';

async function readExclusions() {
  try {
    // useCache: false — guarantees we read the just-written version rather
    // than a CDN-cached copy of the previous upload (cache can lag up to
    // 60s on overwrite otherwise).
    const result = await get(EXCLUSION_PATHNAME, { access: 'private', useCache: false });
    if (!result?.stream) return { ids: [], updatedAt: null, updatedBy: null };
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (err) {
    // Not found on first-ever run is expected — everything else gets logged.
    if (err?.message && !err.message.includes('not found')) {
      console.error('[exclusions] read error:', err);
    }
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
      access: 'private',
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
      access: 'private',
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
