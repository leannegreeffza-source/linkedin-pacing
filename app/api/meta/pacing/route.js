// app/api/meta/pacing/route.js
import { getToken }     from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { getInsights, resolveToken } from '../../../../lib/metaClient';

export const dynamic = 'force-dynamic';
const MAX_PARALLEL = 4;

// FIX: previously used new Date().toISOString() which reads the SERVER's
// UTC clock. Vercel functions run in UTC, so between 00:00-01:59 SAST the
// server's UTC clock is still on "yesterday" — misclassifying today/yesterday
// spend and throwing off the DoD% flag. SAST is UTC+2 year-round (no DST),
// so we shift the clock forward 2h before reading the date, same fix pattern
// as the Pacing tab's toDateInput() bug.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
function sastNow() { return new Date(Date.now() + SAST_OFFSET_MS); }
function todayStr()     { return sastNow().toISOString().split('T')[0]; }
function yesterdayStr() { const d = sastNow(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().split('T')[0]; }

function daysBetween(a, b) {
  return Math.max(1, Math.round((new Date(b+'T00:00:00Z') - new Date(a+'T00:00:00Z')) / 86_400_000) + 1);
}
async function inBatches(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...await Promise.all(items.slice(i, i+size).map(fn)));
  }
  return results;
}

export async function POST(request) {
  try {
    let sessionMetaToken = null;
    try { const t = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }); sessionMetaToken = t?.metaAccessToken || null; } catch {}

    let tokenInfo;
    try { tokenInfo = resolveToken(sessionMetaToken); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: 401 }); }

    let body;
    try { body = await request.json(); } catch { body = {}; }

    // ← KEY FIX: coerce all IDs to strings before passing to metaClient
    // t.startsWith is not a function = accountId was a number not a string
    const accountIds  = Array.isArray(body.accountIds)  ? body.accountIds.map(String)  : [];
    const campaignIds = Array.isArray(body.campaignIds) ? body.campaignIds.map(String) : null;
    const adsetIds    = Array.isArray(body.adsetIds)    ? body.adsetIds.map(String)    : null;
    const startDate   = body.startDate;
    const endDate     = body.endDate;

    if (!accountIds.length) return NextResponse.json({ summary:{totalSpend:0,todaySpend:0,yesterdaySpend:0,totalDays:1,daysElapsed:1}, accountTotals:[], dailyData:[] });
    if (!startDate || !endDate) return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });

    let level, filterField, filterIds;
    if (adsetIds?.length)    { level='adset';    filterField='adset.id';    filterIds=adsetIds; }
    else if (campaignIds?.length) { level='campaign'; filterField='campaign.id'; filterIds=campaignIds; }
    else                     { level='campaign'; filterField=null;          filterIds=null; }

    const nested = await inBatches(accountIds, MAX_PARALLEL, async (accId) => {
      try { return await getInsights(tokenInfo, String(accId), { startDate, endDate, level, filterField, filterIds }); }
      catch (err) { console.error(`[meta/pacing] account ${accId} failed:`, err.message); return []; }
    });
    const allRows = nested.flat();

    const today = todayStr(), yest = yesterdayStr();
    const byDate = new Map(), byAcc = new Map();
    for (const r of allRows) {
      const d = byDate.get(r.date) || { date:r.date, spend:0, impressions:0, clicks:0, leads:0 };
      d.spend+=r.spend; d.impressions+=r.impressions; d.clicks+=r.clicks; d.leads+=r.leads;
      byDate.set(r.date, d);
      const a = byAcc.get(r.accountId) || { accountId:r.accountId, totalSpend:0, todaySpend:0, yesterdaySpend:0 };
      a.totalSpend+=r.spend;
      if (r.date===today) a.todaySpend+=r.spend;
      if (r.date===yest)  a.yesterdaySpend+=r.spend;
      byAcc.set(r.accountId, a);
    }

    const dailyData      = Array.from(byDate.values()).sort((x,y)=>x.date.localeCompare(y.date));
    const totalSpend     = dailyData.reduce((s,d)=>s+d.spend, 0);
    const todaySpend     = byDate.get(today)?.spend || 0;
    const yesterdaySpend = byDate.get(yest)?.spend  || 0;
    const clampedEnd     = endDate > today ? today : endDate;

    return NextResponse.json({
      summary:       { totalSpend, todaySpend, yesterdaySpend, totalDays:daysBetween(startDate,endDate), daysElapsed:daysBetween(startDate,clampedEnd) },
      accountTotals: Array.from(byAcc.values()),
      dailyData,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 502 });
  }
}
