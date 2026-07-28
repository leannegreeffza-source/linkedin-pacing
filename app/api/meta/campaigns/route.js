// app/api/meta/campaigns/route.js
import { getToken }     from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { listCampaigns, resolveToken } from '../../../../lib/metaClient';

export const dynamic = 'force-dynamic';
const MAX_PARALLEL = 4;  // reduced to avoid EMFILE

async function inBatches(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const out = await Promise.all(items.slice(i, i + size).map(fn));
    results.push(...out);
  }
  return results;
}

export async function POST(request) {
  try {
    let sessionMetaToken = null;
    try {
      const t = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      sessionMetaToken = t?.metaAccessToken || null;
    } catch { /* fine */ }

    let tokenInfo;
    try { tokenInfo = resolveToken(sessionMetaToken); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: 401 }); }

    let body;
    try { body = await request.json(); } catch { body = {}; }
    const accountIds = Array.isArray(body.accountIds)
      ? body.accountIds.map(String)  // ensure strings
      : [];
    if (accountIds.length === 0) return NextResponse.json([]);

    const nested = await inBatches(accountIds, MAX_PARALLEL, async (accId) => {
      try { return await listCampaigns(tokenInfo, String(accId)); }
      catch (err) {
        console.error(`[meta/campaigns] account ${accId} failed:`, err.message);
        return [];
      }
    });
    return NextResponse.json(nested.flat());
  } catch (err) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 502 });
  }
}