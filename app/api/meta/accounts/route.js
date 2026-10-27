// app/api/meta/accounts/route.js
//
// GET /api/meta/accounts            →  [{ id, name, currency, timezone, status, bm }]
// GET /api/meta/accounts?debug=1    →  { accounts, diagnostics }   (open it in the browser while signed in)
//
// Response header `x-meta-token-type` says which token was used: `system_user` or `facebook_session`.
// The two can see very different sets of accounts, so the Meta tab shows it.

import { getToken }     from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { listAdAccounts, resolveToken } from '../../../../lib/metaClient';

export const dynamic = 'force-dynamic';

// Meta account_status values:
//   1   = ACTIVE
//   2   = DISABLED            ← exclude
//   3   = UNSETTLED           ← INCLUDE (has spend)
//   7   = PENDING_RISK_REVIEW ← INCLUDE (has spend)
//   8   = PENDING_SETTLEMENT  ← INCLUDE (has spend)
//   9   = IN_GRACE_PERIOD     ← INCLUDE
//   100 = PENDING_CLOSURE     ← INCLUDE (may still have spend)
//   101 = CLOSED              ← exclude
//   201 = ANY_ACTIVE          ← INCLUDE
//   202 = ANY_CLOSED          ← exclude
// NOTE: an account that was closed/disabled part-way through the reporting period still has
// spend from before it closed. The debug output lists every excluded account so you can check.
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

    const accounts    = await listAdAccounts(tokenInfo);
    const diagnostics = accounts.diagnostics || null;

    // Keep all accounts except truly closed/disabled ones
    const usable = accounts.filter(a => !EXCLUDED_STATUSES.has(a.status));

    console.log(`[meta/accounts] token: ${tokenInfo.isSystemUser ? 'system_user' : 'facebook_session'} | fetched: ${accounts.length} | usable: ${usable.length} | excluded: ${accounts.length - usable.length}`);

    const payload = usable.map(a => ({
      id:       a.accountId,
      metaId:   a.id,
      name:     a.name,
      currency: a.currency,
      timezone: a.timezone,
      status:   a.status,
      bm:       a.bm || null,
    }));

    const headers = { 'x-meta-token-type': tokenInfo.isSystemUser ? 'system_user' : 'facebook_session' };

    if (new URL(request.url).searchParams.get('debug')) {
      return NextResponse.json({ accounts: payload, diagnostics }, { headers });
    }
    return NextResponse.json(payload, { headers });
  } catch (err) {
    console.error('[meta/accounts] error:', err.message);
    return NextResponse.json({
      error:  err.message,
      code:   err.code,
      status: err.status,
    }, { status: 502 });
  }
}
