// app/api/meta/accounts/route.js
//
// GET /api/meta/accounts  →  [{ id, name, ... }]
//
// resolveToken returns { token, isSystemUser }. For System User tokens we
// need to pass the full info object through so listAdAccounts knows to use
// the business-scoped endpoints instead of /me/adaccounts (which fails on
// System User tokens with OAuthException code 2500).

import { getToken }     from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { listAdAccounts, resolveToken } from '../../../../lib/metaClient';

export const dynamic = 'force-dynamic';

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
    // Filter out closed/disabled accounts; 1=ACTIVE, 9=IN_GRACE_PERIOD.
    // Keep 201 and 202 as well — Meta uses these for some account types.
    const usable = accounts.filter(a => [1, 9, 201, 202].includes(a.status));

    return NextResponse.json(usable.map(a => ({
      id:       a.accountId,
      metaId:   a.id,
      name:     a.name,
      currency: a.currency,
      timezone: a.timezone,
    })));
  } catch (err) {
    // Surface Meta errors so we don't silently return [] when something's wrong.
    return NextResponse.json({
      error:   err.message,
      code:    err.code,
      status:  err.status,
    }, { status: 502 });
  }
}