import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';
// Vercel max duration — set this in vercel.json too
export const maxDuration = 300;

const LI = (token) => ({ Authorization: `Bearer ${token}`, 'LinkedIn-Version': '202401' });

async function liGet(url, accessToken) {
  try {
    const res = await fetch(url, { headers: LI(accessToken), signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function dateParams(start, end) {
  return {
    'dateRange.start.year':  start.getFullYear(),
    'dateRange.start.month': start.getMonth() + 1,
    'dateRange.start.day':   start.getDate(),
    'dateRange.end.year':    end.getFullYear(),
    'dateRange.end.month':   end.getMonth() + 1,
    'dateRange.end.day':     end.getDate(),
  };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Run promises with max N concurrent at a time
async function pooled(items, concurrency, fn) {
  const results = [];
  for (const batch of chunk(items, concurrency)) {
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function getAccountSpend(accountIds, dp, accessToken) {
  const p = new URLSearchParams({
    q: 'analytics', pivot: 'ACCOUNT', timeGranularity: 'ALL', ...dp,
    fields: 'costInLocalCurrency,pivotValues',
  });
  accountIds.forEach((id, i) => p.append(`accounts[${i}]`, `urn:li:sponsoredAccount:${id}`));
  const data = await liGet(`https://api.linkedin.com/v2/adAnalyticsV2?${p}`, accessToken);
  const result = {};
  (data?.elements || []).forEach(el => {
    const id = (el.pivotValues?.[0] || '').split(':').pop();
    const spend = parseFloat(el.costInLocalCurrency || 0);
    if (spend > 0) result[id] = (result[id] || 0) + spend;
  });
  return result;
}

async function getCampaignSpend(campaignIds, dp, accessToken) {
  const p = new URLSearchParams({
    q: 'analytics', pivot: 'CAMPAIGN', timeGranularity: 'ALL', ...dp,
    fields: 'costInLocalCurrency,pivotValues',
  });
  campaignIds.forEach((cid, i) => p.append(`campaigns[${i}]`, `urn:li:sponsoredCampaign:${cid}`));
  const data = await liGet(`https://api.linkedin.com/v2/adAnalyticsV2?${p}`, accessToken);
  const result = {};
  (data?.elements || []).forEach(el => {
    const cid = (el.pivotValues?.[0] || '').split(':').pop();
    const spend = parseFloat(el.costInLocalCurrency || 0);
    if (spend > 0) result[cid] = (result[cid] || 0) + spend;
  });
  return result;
}

async function processAccount(accountId, dp, accessToken) {
  const accUrn = `urn:li:sponsoredAccount:${accountId}`;
  const campaigns = [];
  let campStart = 0;
  while (campStart < 2000) {
    const data = await liGet(
      `https://api.linkedin.com/v2/adCampaignsV2?q=search` +
      `&search.account.values[0]=${encodeURIComponent(accUrn)}&count=200&start=${campStart}`,
      accessToken
    );
    const els = data?.elements || [];
    campaigns.push(...els);
    if (els.length < 200) break;
    campStart += 200;
  }
  if (!campaigns.length) return [];

  const campMeta = {};
  const groupIds = new Set();
  campaigns.forEach(c => {
    const cid = String(c.id);
    const gid = (c.campaignGroup || '').split(':').pop();
    campMeta[cid] = {
      name: c.name || '', type: c.type || '', groupId: gid, groupName: '',
      campStart: c.runSchedule?.start ? new Date(c.runSchedule.start).toISOString().split('T')[0] : '',
      campEnd:   c.runSchedule?.end   ? new Date(c.runSchedule.end).toISOString().split('T')[0]   : '',
    };
    if (gid) groupIds.add(gid);
  });

  // Fetch group names (pooled, 5 at a time)
  await pooled([...groupIds], 5, async (gid) => {
    const g = await liGet(`https://api.linkedin.com/v2/adCampaignGroupsV2/${gid}`, accessToken);
    if (g?.name) Object.values(campMeta).forEach(m => { if (m.groupId === gid) m.groupName = g.name; });
  });

  // Get campaign spend in batches of 20, pooled 3 at a time
  const campIds = campaigns.map(c => String(c.id));
  const spendMap = {};
  await pooled(chunk(campIds, 20), 3, async (batch) => {
    const result = await getCampaignSpend(batch, dp, accessToken);
    Object.assign(spendMap, result);
  });

  return Object.entries(spendMap).map(([cid, localSpend]) => {
    const meta = campMeta[cid];
    if (!meta) return null;
    return {
      accountId: String(accountId), campaignGroupId: meta.groupId || '',
      campaignGroupName: meta.groupName || '', campaignName: meta.name,
      adUnit: meta.type, campStartDate: meta.campStart, campEndDate: meta.campEnd,
      localSpend, mediaSpendUSD: localSpend,
    };
  }).filter(Boolean);
}

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const { accountIds, startDate, endDate } = await request.json();
  if (!accountIds?.length) {
    return new Response(JSON.stringify({ error: 'No accounts provided' }), { status: 400 });
  }

  const now   = new Date();
  const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = endDate   ? new Date(endDate)   : now;
  const dp    = dateParams(start, end > now ? now : end);

  // ── Stream response back to client ──────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      try {
        // Phase 1: find all accounts with spend (pool 10 batches of 20 at a time)
        send({ phase: 1, message: 'Identifying accounts with spend…', progress: 0 });

        const accountSpend = {};
        const batches = chunk(accountIds, 20);
        await pooled(batches, 10, async (batch) => {
          const result = await getAccountSpend(batch, dp, token.accessToken);
          Object.assign(accountSpend, result);
        });

        const spendingIds = Object.keys(accountSpend);
        send({ phase: 1, done: true, spendingCount: spendingIds.length, totalCount: accountIds.length });

        if (spendingIds.length === 0) {
          send({ done: true, rows: [], total: 0 });
          controller.close();
          return;
        }

        // Phase 2: process each spending account (pool 5 at a time to avoid rate limits)
        send({ phase: 2, message: `Fetching campaign detail for ${spendingIds.length} accounts…`, progress: 0 });

        let processed = 0;
        const allRows = [];

        await pooled(spendingIds, 5, async (accountId) => {
          const rows = await processAccount(accountId, dp, token.accessToken);
          allRows.push(...rows);
          processed++;
          // Send progress every 5 accounts
          if (processed % 5 === 0 || processed === spendingIds.length) {
            send({
              phase: 2,
              progress: Math.round((processed / spendingIds.length) * 100),
              processed,
              total: spendingIds.length,
              rowsSoFar: allRows.length,
            });
          }
        });

        allRows.sort((a, b) =>
          a.accountId.localeCompare(b.accountId) ||
          a.campaignGroupId.localeCompare(b.campaignGroupId)
        );

        send({ done: true, rows: allRows, total: allRows.length });
      } catch (err) {
        send({ error: err.message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx/Vercel)
      'Cache-Control': 'no-cache',
    },
  });
}