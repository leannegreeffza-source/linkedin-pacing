import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LI = (t) => ({ Authorization: `Bearer ${t}`, 'LinkedIn-Version': '202401' });

function pad2(n) { return String(n).padStart(2, '0'); }
function toMMDDYYYY(str) { const [y, m, d] = str.split('-'); return `${m}/${d}/${y}`; }

async function liGet(url, token) {
  try {
    const res = await fetch(url, { headers: LI(token), signal: AbortSignal.timeout(20000) });
    if (!res.ok) { console.error(`liGet ${res.status}: ${url.slice(0, 120)}`); return null; }
    return res.json();
  } catch (e) { console.error(`liGet err: ${e.message}`); return null; }
}

// ── GET: return all accounts for the signed-in user ──────────────────────────
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

// ── POST: fetch all campaigns for an account, then daily analytics ───────────
export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const { accountId, campaignIds, startDate, endDate } = await request.json();

  // ── If only accountId given (no campaignIds) → return campaign list ─────────
  if (accountId && (!campaignIds || !campaignIds.length)) {
    const campaigns = [];
    const accUrn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
    let start = 0;
    while (start < 5000) {
      const data = await liGet(
        `https://api.linkedin.com/v2/adCampaignsV2?q=search&search.account.values[0]=${accUrn}&count=200&start=${start}`,
        token.accessToken
      );
      const els = data?.elements || [];
      for (const c of els) {
        campaigns.push({ id: String(c.id), name: c.name || `Campaign ${c.id}`, status: c.status || '', type: c.type || '' });
      }
      if (els.length < 200) break;
      start += 200;
    }
    campaigns.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ campaigns });
  }

  // ── campaignIds given → stream daily analytics ───────────────────────────────
  if (!campaignIds?.length || !startDate || !endDate) {
    return new Response(JSON.stringify({ error: 'campaignIds, startDate and endDate required' }), { status: 400 });
  }

  const start = new Date(startDate);
  const end   = new Date(endDate);
  const clEnd = end > new Date() ? new Date() : end;

  const dp = {
    'dateRange.start.year':  start.getFullYear(),
    'dateRange.start.month': start.getMonth() + 1,
    'dateRange.start.day':   start.getDate(),
    'dateRange.end.year':    clEnd.getFullYear(),
    'dateRange.end.month':   clEnd.getMonth() + 1,
    'dateRange.end.day':     clEnd.getDate(),
  };

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      try {
        const allRows = [];
        let processed = 0;

        send({ pct: 5, message: `Fetching daily data for ${campaignIds.length} campaign${campaignIds.length !== 1 ? 's' : ''}…`, total: campaignIds.length });

        for (const camp of campaignIds) {
          // ── Fetch at CREATIVE pivot for creative names + full video metrics ──
          const p = new URLSearchParams({
            q: 'analytics',
            pivot: 'CREATIVE',
            timeGranularity: 'DAILY',
            ...dp,
            fields: [
              'dateRange',
              'costInLocalCurrency',
              'impressions',
              'clicks',
              'totalEngagements',
              'videoViews',
              'videoStarts',
              'videoCompletions',
              'videoThruPlayActions',          // 3-second views
              'videoFirstQuartileCompletions', // 25%
              'videoMidpointCompletions',      // 50%
              'videoThirdQuartileCompletions', // 75%
              'mobileAppInstall',              // app downloads
              'pivotValues',
            ].join(','),
          });
          p.append('campaigns[0]', `urn:li:sponsoredCampaign:${camp.id}`);

          // Collect creative metadata (name) for all creatives in this campaign
          const creativeNames = {};
          try {
            const crData = await liGet(
              `https://api.linkedin.com/v2/adCreativesV2?q=search&search.campaign.values[0]=urn:li:sponsoredCampaign:${camp.id}&count=100`,
              token.accessToken
            );
            (crData?.elements || []).forEach(cr => {
              const crId = String(cr.id);
              // Creative name: use reference name, or variables title, or fallback
              const name = cr.name
                || cr.variables?.data?.['com.linkedin.ads.SponsoredUpdateCreativeVariables']?.activity?.split(':').pop()
                || cr.reference?.split(':').pop()
                || `Creative ${crId}`;
              creativeNames[crId] = name;
            });
          } catch {}

          const data = await liGet(
            `https://api.linkedin.com/v2/adAnalyticsV2?${p.toString()}`,
            token.accessToken
          );

          const elements = data?.elements || [];

          if (elements.length > 0) {
            for (const el of elements) {
              const dr      = el.dateRange?.start;
              const dateStr = dr
                ? `${pad2(dr.month)}/${pad2(dr.day)}/${dr.year}`
                : toMMDDYYYY(startDate);

              // Extract creative ID from pivotValues
              const creativeUrn  = el.pivotValues?.[0] || '';
              const creativeId   = creativeUrn.split(':').pop();
              const creativeName = creativeNames[creativeId] || creativeUrn || '';

              const spend  = parseFloat(el.costInLocalCurrency              || 0);
              const imps   = parseInt(el.impressions                         || 0);
              const clks   = parseInt(el.clicks                              || 0);
              const engs   = el.totalEngagements  != null ? parseInt(el.totalEngagements)              : null;
              const views  = el.videoViews        != null ? parseInt(el.videoViews)                    : null;
              const starts = el.videoStarts       != null ? parseInt(el.videoStarts)                   : null;
              const comps  = el.videoCompletions  != null ? parseInt(el.videoCompletions)              : null;
              const v3sec  = el.videoThruPlayActions          != null ? parseInt(el.videoThruPlayActions)          : null;
              const v25    = el.videoFirstQuartileCompletions != null ? parseInt(el.videoFirstQuartileCompletions) : null;
              const v50    = el.videoMidpointCompletions      != null ? parseInt(el.videoMidpointCompletions)      : null;
              const v75    = el.videoThirdQuartileCompletions != null ? parseInt(el.videoThirdQuartileCompletions) : null;
              const appDl  = el.mobileAppInstall  != null ? parseInt(el.mobileAppInstall)              : null;

              // VCR = video completions / video starts (when both available)
              const vcr = (starts != null && starts > 0 && comps != null)
                ? parseFloat((comps / starts).toFixed(4))
                : null;

              const cpm = imps > 0 ? parseFloat(((spend / imps) * 1000).toFixed(4)) : 0;

              allRows.push({
                date: dateStr, currency: 'USD', siteName: 'LinkedIn',
                campaignName: camp.name, placementName: camp.name,
                packageName: '', creativeName,
                netSpend: spend, impressions: imps, clicks: clks,
                engagements: engs, videoViews: views, videoStarts: starts,
                video3sec: v3sec, video25: v25, video50: v50, video75: v75,
                video100: comps, vcr, appDownloads: appDl,
                custom1: null, custom2: null, cpm,
              });
            }
          }
          // Campaigns with no data in the period are omitted

          processed++;
          send({
            pct: 5 + Math.round((processed / campaignIds.length) * 93),
            message: `${processed}/${campaignIds.length} campaigns processed…`,
            processed, total: campaignIds.length, rowsSoFar: allRows.length,
          });
        }

        // Sort by date then campaign name
        allRows.sort((a, b) => {
          const toD = s => { const [m, d, y] = s.split('/'); return new Date(`${y}-${m}-${d}`); };
          return toD(a.date) - toD(b.date) || a.campaignName.localeCompare(b.campaignName);
        });

        send({ done: true, rows: allRows, total: allRows.length });
      } catch (err) {
        console.error('Kenya analytics error:', err);
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