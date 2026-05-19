// app/api/meta/accounts/route.js
//
// GET /api/meta/accounts  →  [{ id, name, currency, timezone, status }]

import { getToken }     from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { listAdAccounts, resolveToken } from '../../../../lib/metaClient';

export const dynamic = 'force-dynamic';

// Meta account_status values:
//   1   = ACTIVE
//   2   = DISABLED            ← exclude (no spend)
//   3   = UNSETTLED           ← INCLUDE (has spend — was wrongly excluded before)
//   7   = PENDING_RISK_REVIEW ← INCLUDE (has spend — was wrongly excluded before)
//   8   = PENDING_SETTLEMENT  ← INCLUDE (has spend — was wrongly excluded before)
//   9   = IN_GRACE_PERIOD     ← INCLUDE
//   100 = PENDING_CLOSURE     ← INCLUDE (may still have spend)
//   101 = CLOSED              ← exclude (no spend)
//   201 = ANY_ACTIVE          ← INCLUDE
//   202 = ANY_CLOSED          ← exclude
//
// The old filter [1, 9, 201, 202] excluded status 3, 7, 8 which all have
// real active spend — that's why only ~114 of 700+ accounts appeared.
const EXCLUDED_STATUSES = new Set([2, 101, 202]);

export async function GET(request) {
  try {
    let sessionMetaToken = null;
    try {
      const t = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      sessionMetaToken = t?.metaAccessToken || null;
    } catch { /* fine */ }

    let tokenInfo;
    try {
      tokenInfo = resolveToken(sessionMetaToken);
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }

    const accounts = await listAdAccounts(tokenInfo);

    // Keep all accounts except truly closed/disabled ones
    const usable = accounts.filter(a => !EXCLUDED_STATUSES.has(a.status));

    console.log(`[meta/accounts] fetched: ${accounts.length} | usable: ${usable.length} | excluded: ${accounts.length - usable.length}`);

    return NextResponse.json(usable.map(a => ({
      id:       a.accountId,
      metaId:   a.id,
      name:     a.name,
      currency: a.currency,
      timezone: a.timezone,
      status:   a.status,
    })));
  } catch (err) {
    console.error('[meta/accounts] error:', err.message);
    return NextResponse.json({
      error:  err.message,
      code:   err.code,
      status: err.status,
    }, { status: 502 });
  }
}