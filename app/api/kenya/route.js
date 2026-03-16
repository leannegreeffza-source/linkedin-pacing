import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LI_HEADERS = (t) => ({
  Authorization: `Bearer ${t}`,
  'LinkedIn-Version': '202401',
});

function pad2(n) { return String(n).padStart(2, '0'); }
function toMMDDYYYY(str) { const [y, m, d] = str.split('-'); return `${m}/${d}/${y}`; }

async function liGet(url, token) {
  try {
    const res = await fetch(url, { headers: LI_HEADERS(token), signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      const body = await res.text();
      console.error(`liGet ${res.status}: ${url.slice(0, 150)} — ${body.slice(0, 300)}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.error(`liGet exception: ${e.message}`);
    return null;
  }
}

// Helper: LinkedIn returns money as {amount:"123.45",currencyCode:"USD"} OR plain string
const toMoney = (v) => {
  if (v == null) return 0;
  if (typeof v === 'object' && v.amount != null) return parseFloat(v.amount) || 0;
  return parseFloat(v) || 0;
};
const toN = (v) => v != null ? (parseInt(v) || 0) : null;

// ── GET: all ad accounts for signed-in user ───────────────────────────────────
export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const accounts = [];
  let start = 0;
  while (start < 10000) {
    const data = await liGet(
      `https://api.linkedin.com/v2/adAccountsV2?q=search&count=100&start=${start}`,
      token.accessToken
    );
    const els = data?.elements || [];
    for (const a of els) {
      const id   = a.id ? String(a.id) : (a.reference?.split(':').pop() ?? '');
      const name = a.name || `Account ${id}`;
      if (id) accounts.push({ id, name, status: a.status || '' });
    }
    if (els.length < 100) break;
    if (data?.paging?.total != null && start + 100 >= data.paging.total) break;
    start += 100;
  }
  accounts.sort((a, b) => a.name.localeCompare(b.name));
  return Response.json(accounts);
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const body = await request.json();
  const { accountId, campaignIds, startDate, endDate } = body;

  // ── accountId only → return full campaign list ───────────────────────────
  if (accountId && (!campaignIds || campaignIds.length === 0)) {
    const campaigns = [];
    let start = 0;
    while (start < 5000) {
      const data = await liGet(
        `https://api.linkedin.com/v2/adCampaignsV2?q=search` +
        `&search.account.values[0]=urn:li:sponsoredAccount:${accountId}` +
        `&count=200&start=${start}`,
        token.accessToken
      );
      if (!data) break;
      const els = data.elements || [];
      for (const c of els) {
        campaigns.push({
          id:     String(c.id),
          name:   c.name   || `Campaign ${c.id}`,
          status: c.status || '',
          type:   c.type   || '',
        });
      }
      if (els.length < 200) break;
      start += 200;
    }
    campaigns.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ campaigns, total: campaigns.length });
  }

  // ── campaignIds + dates → stream daily analytics ─────────────────────────
  if (!campaignIds?.length || !startDate || !endDate) {
    return new Response(
      JSON.stringify({ error: 'campaignIds, startDate and endDate required' }),
      { status: 400 }
    );
  }

  const startDt = new Date(startDate);
  const endDt   = new Date(endDate);
  const clEnd   = endDt > new Date() ? new Date() : endDt;

  const drStr =
    `dateRange.start.year=${startDt.getFullYear()}` +
    `&dateRange.start.month=${startDt.getMonth() + 1}` +
    `&dateRange.start.day=${startDt.getDate()}` +
    `&dateRange.end.year=${clEnd.getFullYear()}` +
    `&dateRange.end.month=${clEnd.getMonth() + 1}` +
    `&dateRange.end.day=${clEnd.getDate()}`;

  // LinkedIn adAnalyticsV2 field projection using Restli 2.0 syntax.
  // Fields are listed in parentheses appended to the endpoint URL path.
  // This is the correct way to request non-default fields.
  const PROJECTION = [
    'dateRange',
    'costInLocalCurrency',
    'impressions',
    'clicks',
    'totalEngagements',
    'videoViews',
    'videoStarts',
    'videoCompletions',
    'videoThruPlayActions',
    'videoFirstQuartileCompletions',
    'videoMidpointCompletions',
    'videoThirdQuartileCompletions',
    'mobileAppInstall',
  ].join(',');

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      try {
        const allRows = [];
        let processed = 0;

        send({
          pct: 5,
          message: `Fetching data for ${campaignIds.length} campaign${campaignIds.length !== 1 ? 's' : ''}…`,
          total: campaignIds.length,
        });

        for (const camp of campaignIds) {
          // Try with field projection first; fall back to no projection if it fails
          const urlWithProjection =
            `https://api.linkedin.com/v2/adAnalyticsV2` +
            `?q=analytics` +
            `&pivot=CAMPAIGN` +
            `&timeGranularity=DAILY` +
            `&${drStr}` +
            `&campaigns[0]=urn:li:sponsoredCampaign:${camp.id}` +
            `&fields=${PROJECTION}`;

          const urlNoProjection =
            `https://api.linkedin.com/v2/adAnalyticsV2` +
            `?q=analytics` +
            `&pivot=CAMPAIGN` +
            `&timeGranularity=DAILY` +
            `&${drStr}` +
            `&campaigns[0]=urn:li:sponsoredCampaign:${camp.id}`;

          let data = await liGet(urlWithProjection, token.accessToken);

          // If projection caused an empty response, fall back to no projection
          if (!data?.elements?.length) {
            data = await liGet(urlNoProjection, token.accessToken);
          }

          const elements = data?.elements || [];

          for (const el of elements) {
            const dr      = el.dateRange?.start;
            const dateStr = dr
              ? `${pad2(dr.month)}/${pad2(dr.day)}/${dr.year}`
              : toMMDDYYYY(startDate);

            const spend  = toMoney(el.costInLocalCurrency);
            const imps   = parseInt(el.impressions ?? 0) || 0;
            const clks   = parseInt(el.clicks      ?? 0) || 0;
            const engs   = toN(el.totalEngagements);
            const views  = toN(el.videoViews);
            const starts = toN(el.videoStarts);
            const comps  = toN(el.videoCompletions);
            const v3sec  = toN(el.videoThruPlayActions);
            const v25    = toN(el.videoFirstQuartileCompletions);
            const v50    = toN(el.videoMidpointCompletions);
            const v75    = toN(el.videoThirdQuartileCompletions);
            const appDl  = toN(el.mobileAppInstall);
            const vcr    = (starts && comps != null) ? parseFloat((comps / starts).toFixed(4)) : null;
            const cpm    = imps > 0 ? parseFloat(((spend / imps) * 1000).toFixed(4)) : 0;

            allRows.push({
              date: dateStr, currency: 'USD', siteName: 'LinkedIn',
              campaignName: camp.name, placementName: camp.name,
              packageName: '', creativeName: '',
              netSpend: spend, impressions: imps, clicks: clks,
              engagements: engs, videoViews: views, videoStarts: starts,
              video3sec: v3sec, video25: v25, video50: v50, video75: v75,
              video100: comps, vcr, appDownloads: appDl,
              custom1: null, custom2: null, cpm,
            });
          }

          processed++;
          send({
            pct: 5 + Math.round((processed / campaignIds.length) * 93),
            message: `${processed} / ${campaignIds.length} campaigns…`,
            processed, total: campaignIds.length, rowsSoFar: allRows.length,
          });
        }

        allRows.sort((a, b) => {
          const toD = s => { const [m, d, y] = s.split('/'); return new Date(`${y}-${m}-${d}`); };
          return toD(a.date) - toD(b.date) || a.campaignName.localeCompare(b.campaignName);
        });

        send({ done: true, rows: allRows, total: allRows.length });

      } catch (err) {
        console.error('Kenya stream error:', err);
        send({ error: err.message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
      'Cache-Control': 'no-cache',
    },
  });
}