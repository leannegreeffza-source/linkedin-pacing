// app/api/meta/adsets/route.js
//
// POST /api/meta/adsets
//   body: { accountIds: ['123'], campaignIds?: ['c1','c2'] }
//   →  [{ id, name, campaignId, accountId, ... }]

import { getToken }     from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { listAdSets, resolveToken } from '../../../../lib/metaClient';

export const dynamic = 'force-dynamic';

const MAX_PARALLEL = 8;

async function inBatches(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const out   = await Promise.all(batch.map(fn));
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
    const accountIds  = Array.isArray(body.accountIds)  ? body.accountIds  : [];
    const campaignIds = Array.isArray(body.campaignIds) ? body.campaignIds : null;
    if (accountIds.length === 0) return NextResponse.json([]);

    const nested = await inBatches(accountIds, MAX_PARALLEL, async (accId) => {
      try { return await listAdSets(tokenInfo, accId, campaignIds); }
      catch (err) {
        console.error(`[meta/adsets] account ${accId} failed:`, err.message);
        return [];
      }
    });
    return NextResponse.json(nested.flat());
  } catch (err) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 502 });
  }
}