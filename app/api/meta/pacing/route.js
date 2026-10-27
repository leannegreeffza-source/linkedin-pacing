// app/api/meta/pacing/route.js
import { getToken }     from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { getInsights, resolveToken, isRetryableError } from '../../../../lib/metaClient';

export const dynamic = 'force-dynamic';
// Vercel Hobby caps functions at 60s regardless of what is set here. The route is written to
// finish inside that window (see START_CUTOFF_MS) and hand back whatever it did not get to.
export const maxDuration = 60;

const MAX_PARALLEL     = 6;       // concurrent Graph calls per request
const START_CUTOFF_MS  = 35_000;  // resilient mode: don't START a new account after this long
const HARD_DEADLINE_MS = 52_000;  // resilient mode: rate-limit back-off never sleeps past this

// "Today" / "yesterday" are SAST dates. Vercel runs in UTC, so shift the clock +2h before
// reading the date (SAST is UTC+2 all year, no DST).
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
function sastNow() { return new Date(Date.now() + SAST_OFFSET_MS); }
function todayStr()     { return sastNow().toISOString().split('T')[0]; }
function yesterdayStr() { const d = sastNow(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().split('T')[0]; }

function daysBetween(a, b) {
  return Math.max(1, Math.round((new Date(b+'T00:00:00Z') - new Date(a+'T00:00:00Z')) / 86_400_000) + 1);
}

// Worker pool: `size` workers pull items off a shared queue.
async function runPool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function POST(request) {
  try {
    const startedAt = Date.now();

    let sessionMetaToken = null;
    try { const t = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }); sessionMetaToken = t?.metaAccessToken || null; } catch {}

    let tokenInfo;
    try { tokenInfo = resolveToken(sessionMetaToken); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: 401 }); }

    let body;
    try { body = await request.json(); } catch { body = {}; }

    // Coerce all IDs to strings before passing to metaClient
    const accountIds  = Array.isArray(body.accountIds)  ? body.accountIds.map(String)  : [];
    const campaignIds = Array.isArray(body.campaignIds) ? body.campaignIds.map(String) : null;
    const adsetIds    = Array.isArray(body.adsetIds)    ? body.adsetIds.map(String)    : null;
    const startDate   = body.startDate;
    const endDate     = body.endDate;
    // Opt-in: callers that can re-request leftovers (the Meta tab) set resilient:true and get a
    // time budget. Other callers keep the old "run everything" behaviour.
    const resilient   = body.resilient === true;

    if (!accountIds.length) return NextResponse.json({ summary:{totalSpend:0,todaySpend:0,yesterdaySpend:0,totalDays:1,daysElapsed:1}, accountTotals:[], dailyData:[], failedAccounts:[], partial:false, queried:0 });
    if (!startDate || !endDate) return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });

    let level, filterField, filterIds;
    if (adsetIds?.length)         { level='adset';    filterField='adset.id';    filterIds=adsetIds; }
    else if (campaignIds?.length) { level='campaign'; filterField='campaign.id'; filterIds=campaignIds; }
    else                          { level='account';  filterField=null;          filterIds=null; }

    const deadline = resilient ? startedAt + HARD_DEADLINE_MS : null;

    // One result per requested account — success (rows may be empty = genuinely no spend)
    // or failure (with the reason). Nothing is dropped silently.
    const results = await runPool(accountIds, MAX_PARALLEL, async (accId) => {
      if (resilient && Date.now() - startedAt > START_CUTOFF_MS) {
        return { accId, error: { message: 'Not reached before the server time limit — will be retried', retryable: true } };
      }
      try {
        const rows = await getInsights(tokenInfo, accId, { startDate, endDate, level, filterField, filterIds, deadline });
        return { accId, rows };
      } catch (err) {
        console.error(`[meta/pacing] account ${accId} failed:`, err.message);
        return { accId, error: { message: err.message, code: err.code, retryable: isRetryableError(err) } };
      }
    });

    const today = todayStr(), yest = yesterdayStr();
    const byDate = new Map(), byAcc = new Map();
    const failedAccounts = [];

    for (const r of results) {
      if (r.error) {
        failedAccounts.push({ accountId: r.accId, error: r.error.message, code: r.error.code ?? null, retryable: r.error.retryable });
        continue;
      }
      // Key by the id we asked for, and always create the entry — an account that succeeded
      // with no rows is "no spend", which is different from "failed".
      const a = { accountId: r.accId, totalSpend:0, todaySpend:0, yesterdaySpend:0, totalImpressions:0, totalClicks:0, totalLeads:0 };
      byAcc.set(r.accId, a);
      for (const row of r.rows) {
        const d = byDate.get(row.date) || { date:row.date, spend:0, impressions:0, clicks:0, leads:0 };
        d.spend+=row.spend; d.impressions+=row.impressions; d.clicks+=row.clicks; d.leads+=row.leads;
        byDate.set(row.date, d);
        a.totalSpend+=row.spend; a.totalImpressions+=row.impressions; a.totalClicks+=row.clicks; a.totalLeads+=row.leads;
        if (row.date===today) a.todaySpend+=row.spend;
        if (row.date===yest)  a.yesterdaySpend+=row.spend;
      }
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
      failedAccounts,
      partial: failedAccounts.length > 0,
      queried: accountIds.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 502 });
  }
}
