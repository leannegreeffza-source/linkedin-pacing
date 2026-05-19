import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ── Concurrency limiter — prevents EMFILE and OOM crashes ─────────────────────
// The old code used Promise.all() on ALL accounts simultaneously.
// With 2800 accounts that's 2800 concurrent HTTP requests → EMFILE crash.
// This pools requests in batches of MAX_CONCURRENT.
const MAX_CONCURRENT = 10;

async function pooled(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const out   = await Promise.all(batch.map(fn));
    results.push(...out);
  }
  return results;
}

// ── Date string builder (raw — avoids %2C encoding on fields) ─────────────────
function dateParams(start, end) {
  return (
    `&dateRange.start.year=${start.getFullYear()}` +
    `&dateRange.start.month=${start.getMonth() + 1}` +
    `&dateRange.start.day=${start.getDate()}` +
    `&dateRange.end.year=${end.getFullYear()}` +
    `&dateRange.end.month=${end.getMonth() + 1}` +
    `&dateRange.end.day=${end.getDate()}`
  );
}

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { accountIds, campaignGroupIds, campaignIds, startDate, endDate } = await request.json();
    if (!accountIds || accountIds.length === 0) {
      return NextResponse.json({ error: 'No accounts provided' }, { status: 400 });
    }

    const now        = new Date();
    const start      = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end        = endDate   ? new Date(endDate)   : now;
    const clampedEnd = end > now ? now : end;
    const ds         = dateParams(start, clampedEnd);

    const LI = {
      Authorization:    `Bearer ${token.accessToken}`,
      'LinkedIn-Version': '202401',
    };

    // Fetch one account — capped at MAX_CONCURRENT concurrent
    const fetchAccount = async (accountId) => {
      try {
        let url =
          `https://api.linkedin.com/v2/adAnalyticsV2` +
          `?q=analytics&pivot=ACCOUNT&timeGranularity=DAILY` +
          ds +
          `&accounts[0]=urn:li:sponsoredAccount:${accountId}` +
          `&fields=dateRange,costInLocalCurrency,impressions,clicks,oneClickLeads`;

        // Optional campaign/group filters
        if (campaignIds && campaignIds.length > 0) {
          campaignIds.forEach((cId, idx) => {
            url += `&campaigns[${idx}]=urn:li:sponsoredCampaign:${cId}`;
          });
        } else if (campaignGroupIds && campaignGroupIds.length > 0) {
          campaignGroupIds.forEach((gId, idx) => {
            url += `&campaignGroups[${idx}]=urn:li:sponsoredCampaignGroup:${gId}`;
          });
        }

        const res = await fetch(url, { headers: LI, signal: AbortSignal.timeout(20000) });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error(`Failed for account ${accountId}: ${res.status} ${body.slice(0, 200)}`);
          return { accountId, dailyData: [], error: true };
        }

        const data = await res.json();
        const dailyData = (data.elements || []).map(el => {
          const dr = el.dateRange?.start || el.dateRange;
          return {
            date:        `${dr.year}-${String(dr.month).padStart(2,'0')}-${String(dr.day).padStart(2,'0')}`,
            day:         dr.day,
            month:       dr.month,
            year:        dr.year,
            spend:       parseFloat(el.costInLocalCurrency || 0),
            impressions: parseInt(el.impressions  || 0),
            clicks:      parseInt(el.clicks       || 0),
            leads:       parseInt(el.oneClickLeads || 0),
          };
        }).sort((a, b) => a.date.localeCompare(b.date));

        return { accountId, dailyData };
      } catch (err) {
        console.error(`Error for account ${accountId}:`, err.message || err);
        return { accountId, dailyData: [], error: true };
      }
    };

    // Run with concurrency limit
    const accountResults = await pooled(accountIds, MAX_CONCURRENT, fetchAccount);

    // Merge daily data across all accounts
    const dateMap = {};
    for (const result of accountResults) {
      for (const day of result.dailyData) {
        if (!dateMap[day.date]) {
          dateMap[day.date] = { date: day.date, day: day.day, month: day.month, year: day.year, spend: 0, impressions: 0, clicks: 0, leads: 0 };
        }
        dateMap[day.date].spend       += day.spend;
        dateMap[day.date].impressions += day.impressions;
        dateMap[day.date].clicks      += day.clicks;
        dateMap[day.date].leads       += day.leads;
      }
    }

    const mergedDailyData = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    const todayStr     = now.toISOString().split('T')[0];
    const yesterday    = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const totalSpend     = mergedDailyData.reduce((s, d) => s + d.spend, 0);
    const todaySpend     = dateMap[todayStr]?.spend     || 0;
    const yesterdaySpend = dateMap[yesterdayStr]?.spend || 0;

    const msPerDay      = 1000 * 60 * 60 * 24;
    const startMidnight = new Date(start.getFullYear(),      start.getMonth(),      start.getDate());
    const endMidnight   = new Date(clampedEnd.getFullYear(), clampedEnd.getMonth(), clampedEnd.getDate());
    const nowMidnight   = new Date(now.getFullYear(),        now.getMonth(),        now.getDate());
    const totalDays     = Math.max(1, Math.round((endMidnight - startMidnight) / msPerDay) + 1);
    const daysElapsed   = Math.max(1, Math.min(totalDays, Math.round((nowMidnight - startMidnight) / msPerDay) + 1));

    const accountTotals = accountResults.map(r => ({
      accountId:      r.accountId,
      totalSpend:     r.dailyData.reduce((s, d) => s + d.spend, 0),
      todaySpend:     r.dailyData.find(d => d.date === todayStr)?.spend     || 0,
      yesterdaySpend: r.dailyData.find(d => d.date === yesterdayStr)?.spend || 0,
      error:          r.error || false,
    }));

    return NextResponse.json({
      dailyData: mergedDailyData,
      accountTotals,
      summary: {
        totalSpend, todaySpend, yesterdaySpend,
        totalDays, daysElapsed,
        startDate:   start.toISOString().split('T')[0],
        endDate:     clampedEnd.toISOString().split('T')[0],
        currentDay:  now.getDate(),
        daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
        targetMonth: now.getMonth() + 1,
        targetYear:  now.getFullYear(),
        lastDay:     now.getDate(),
      },
    });
  } catch (error) {
    console.error('Pacing API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}