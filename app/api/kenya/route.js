import { getToken } from 'next-auth/jwt';

export const dynamic  = 'force-dynamic';
export const maxDuration = 300;

function pad2(n) { return String(n).padStart(2, '0'); }

// Standard LinkedIn headers — same as the working pacing API
const HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': '202401',
});

async function liGet(url, token) {
  try {
    const res = await fetch(url, {
      headers: HEADERS(token),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Kenya] ${res.status}: ${url.slice(0, 120)} — ${body.slice(0, 300)}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.error(`[Kenya] fetch error: ${e.message}`);
    return null;
  }
}

// ── GET: all ad accounts ──────────────────────────────────────────────────────
export async function GET(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) return Response.json({ error: 'Not authenticated' }, { status: 401 });

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

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const { accountId, campaignIds, startDate, endDate } = await request.json();

  // ── Campaign list for an account ─────────────────────────────────────────
  if (accountId && (!campaignIds || !campaignIds.length)) {
    const campaigns = [];
    let start = 0;
    while (start < 5000) {
      // Plain URL, no extra headers, same pattern that worked before
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

  // ── Stream daily analytics ────────────────────────────────────────────────
  if (!campaignIds?.length || !startDate || !endDate) {
    return new Response(JSON.stringify({ error: 'Missing required params' }), { status: 400 });
  }

  const now      = new Date();
  const startDt  = new Date(startDate);
  const endDt    = new Date(endDate);
  const clampEnd = endDt > now ? now : endDt;

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      try {
        const allRows   = [];
        let processed   = 0;
        let firstLogged = false;

        send({ pct: 5, message: `Fetching ${campaignIds.length} campaign${campaignIds.length !== 1 ? 's' : ''}…`, total: campaignIds.length });

        for (const camp of campaignIds) {
          // Only request fields we know are permitted on this account.
          // videoThruPlayActions and mobileAppInstall both return 403 ACCESS_DENIED.
          // We request only the safe core fields here.
          const safeFields = [
            'dateRange',
            'costInLocalCurrency',
            'impressions',
            'clicks',
            'totalEngagements',
            'videoViews',
            'videoStarts',
            'videoCompletions',
            'videoFirstQuartileCompletions',
            'videoMidpointCompletions',
            'videoThirdQuartileCompletions',
          ].join(',');

          // Build URL as raw string so commas in fields stay as literal commas
          // (URLSearchParams encodes them as %2C which LinkedIn ignores)
          const url =
            `https://api.linkedin.com/v2/adAnalyticsV2` +
            `?q=analytics` +
            `&pivot=CAMPAIGN` +
            `&timeGranularity=DAILY` +
            `&dateRange.start.year=${startDt.getFullYear()}` +
            `&dateRange.start.month=${startDt.getMonth() + 1}` +
            `&dateRange.start.day=${startDt.getDate()}` +
            `&dateRange.end.year=${clampEnd.getFullYear()}` +
            `&dateRange.end.month=${clampEnd.getMonth() + 1}` +
            `&dateRange.end.day=${clampEnd.getDate()}` +
            `&campaigns[0]=urn:li:sponsoredCampaign:${camp.id}` +
            `&fields=${safeFields}`;

          const data     = await liGet(url, token.accessToken);
          const elements = data?.elements || [];

          if (!firstLogged && elements.length > 0) {
            firstLogged = true;
            console.log('[Kenya] keys:', Object.keys(elements[0]).join(', '));
            console.log('[Kenya] sample:', JSON.stringify(elements[0]));
          }

          for (const el of elements) {
            const d       = el.dateRange?.start;
            const dateStr = d ? `${pad2(d.month)}/${pad2(d.day)}/${d.year}` : '';

            const spend  = parseFloat(el.costInLocalCurrency || 0);
            const imps   = parseInt(el.impressions   || 0);
            const clks   = parseInt(el.clicks        || 0);
            const engs   = el.totalEngagements  != null ? parseInt(el.totalEngagements)  : null;
            const views  = el.videoViews        != null ? parseInt(el.videoViews)        : null;
            const starts = el.videoStarts       != null ? parseInt(el.videoStarts)       : null;
            const comps  = el.videoCompletions  != null ? parseInt(el.videoCompletions)  : null;
            const v25    = el.videoFirstQuartileCompletions != null ? parseInt(el.videoFirstQuartileCompletions) : null;
            const v50    = el.videoMidpointCompletions      != null ? parseInt(el.videoMidpointCompletions)      : null;
            const v75    = el.videoThirdQuartileCompletions != null ? parseInt(el.videoThirdQuartileCompletions) : null;
            const vcr    = (starts > 0 && comps != null) ? parseFloat((comps / starts).toFixed(4)) : null;
            const cpm    = imps > 0 ? parseFloat(((spend / imps) * 1000).toFixed(4)) : 0;

            allRows.push({
              date: dateStr, currency: 'USD', siteName: 'LinkedIn',
              campaignName: camp.name, placementName: camp.name,
              packageName: '', creativeName: '',
              netSpend: spend, impressions: imps, clicks: clks,
              engagements: engs, videoViews: views, videoStarts: starts,
              video3sec: null,   // videoThruPlayActions — restricted field
              video25: v25, video50: v50, video75: v75, video100: comps,
              vcr, appDownloads: null,
              custom1: null, custom2: null, cpm,
            });
          }

          processed++;
          send({
            pct:       5 + Math.round((processed / campaignIds.length) * 93),
            message:   `${processed} / ${campaignIds.length} campaigns…`,
            processed, total: campaignIds.length, rowsSoFar: allRows.length,
          });
        }

        allRows.sort((a, b) => {
          const toD = s => { const [m, d, y] = s.split('/'); return new Date(`${y}-${m}-${d}`); };
          return toD(a.date) - toD(b.date) || a.campaignName.localeCompare(b.campaignName);
        });

        send({ done: true, rows: allRows, total: allRows.length });

      } catch (err) {
        console.error('[Kenya] stream error:', err);
        send({ error: err.message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
      'Cache-Control':     'no-cache',
    },
  });
}