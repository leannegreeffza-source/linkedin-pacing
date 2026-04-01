import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LI = (token) => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': '202401',
});

async function liGet(url, accessToken) {
  try {
    const res = await fetch(url, {
      headers: LI(accessToken),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function dp(start, end) {
  return (
    `&dateRange.start.year=${start.getFullYear()}` +
    `&dateRange.start.month=${start.getMonth() + 1}` +
    `&dateRange.start.day=${start.getDate()}` +
    `&dateRange.end.year=${end.getFullYear()}` +
    `&dateRange.end.month=${end.getMonth() + 1}` +
    `&dateRange.end.day=${end.getDate()}`
  );
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function pooled(items, concurrency, fn) {
  const results = [];
  for (const batch of chunk(items, concurrency)) {
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// Fetch campaign-level spend for a batch of campaign IDs.
// Uses raw URL string so commas in fields stay literal (not %2C).
async function getCampaignSpend(campaignIds, dateStr, accessToken) {
  const campaignParams = campaignIds
    .map((cid, i) => `&campaigns[${i}]=urn:li:sponsoredCampaign:${cid}`)
    .join('');
  const url =
    `https://api.linkedin.com/v2/adAnalyticsV2` +
    `?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL` +
    dateStr +
    campaignParams +
    `&fields=costInLocalCurrency,pivotValues`;
  const data = await liGet(url, accessToken);
  const result = {};
  (data?.elements || []).forEach(el => {
    const cid   = (el.pivotValues?.[0] || '').split(':').pop();
    const spend = parseFloat(el.costInLocalCurrency || 0);
    if (cid && spend > 0) result[cid] = (result[cid] || 0) + spend;
  });
  return result;
}

// For one account: fetch all campaigns, then get spend for each in batches of 20.
async function processAccount(accountId, dateStr, accessToken) {
  try {
  const accUrn   = `urn:li:sponsoredAccount:${accountId}`;
  const campaigns = [];
  let campStart  = 0;

  while (campStart < 5000) {
    const data = await liGet(
      `https://api.linkedin.com/v2/adCampaignsV2?q=search` +
      `&search.account.values[0]=${encodeURIComponent(accUrn)}` +
      `&count=200&start=${campStart}`,
      accessToken
    );
    const els = data?.elements || [];
    campaigns.push(...els);
    if (els.length < 200) break;
    campStart += 200;
  }

  if (!campaigns.length) return [];

  // Build campaign metadata map
  const campMeta = {};
  const groupIds = new Set();
  campaigns.forEach(c => {
    const cid = String(c.id);
    const gid = (c.campaignGroup || '').split(':').pop();
    campMeta[cid] = {
      name:      c.name || '',
      type:      c.type || '',
      groupId:   gid,
      groupName: '',
      campStart: c.runSchedule?.start
        ? new Date(c.runSchedule.start).toISOString().split('T')[0] : '',
      campEnd:   c.runSchedule?.end
        ? new Date(c.runSchedule.end).toISOString().split('T')[0]   : '',
    };
    if (gid) groupIds.add(gid);
  });

  // Fetch campaign group names (5 concurrent)
  await pooled([...groupIds], 5, async gid => {
    const g = await liGet(
      `https://api.linkedin.com/v2/adCampaignGroupsV2/${gid}`,
      accessToken
    );
    if (g?.name) {
      Object.values(campMeta).forEach(m => {
        if (m.groupId === gid) m.groupName = g.name;
      });
    }
  });

  // Fetch spend for all campaigns in batches of 20 (3 concurrent)
  const campIds  = campaigns.map(c => String(c.id));
  const spendMap = {};
  await pooled(chunk(campIds, 20), 3, async batch => {
    const result = await getCampaignSpend(batch, dateStr, accessToken);
    Object.assign(spendMap, result);
  });

  // Return one row per campaign that has spend
  return Object.entries(spendMap)
    .map(([cid, localSpend]) => {
      const meta = campMeta[cid];
      if (!meta) return null;
      return {
        accountId:         String(accountId),
        campaignGroupId:   meta.groupId   || '',
        campaignGroupName: meta.groupName || '',
        campaignName:      meta.name,
        adUnit:            meta.type,
        campStartDate:     meta.campStart,
        campEndDate:       meta.campEnd,
        localSpend,
        mediaSpendUSD:     localSpend,
      };
    })
    .filter(Boolean);
  } catch (err) {
    console.error(`[BOD] processAccount ${accountId} failed:`, err.message);
    return []; // skip failed accounts, don't crash the whole stream
  }
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

  const now      = new Date();
  const start    = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end      = endDate   ? new Date(endDate)   : now;
  const clampEnd = end > now ? now : end;
  const dateStr  = dp(start, clampEnd);

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = obj => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      try {
        const total   = accountIds.length;
        let processed = 0;
        const allRows = [];

        send({ phase: 1, message: `Fetching spend for ${total} accounts…`, pct: 0, total });

        // Process all accounts — 5 concurrent.
        // No pre-scan phase: go straight to campaign-level spend.
        await pooled(accountIds, 5, async accountId => {
          const rows = await processAccount(accountId, dateStr, token.accessToken);
          allRows.push(...rows);
          processed++;

          if (processed % 5 === 0 || processed === total) {
            send({
              phase: 1,
              pct:   Math.round((processed / total) * 90),
              message: `Fetching campaigns… ${processed}/${total} accounts · ${allRows.length} rows so far`,
              processed,
              total,
              rowsSoFar: allRows.length,
            });
          }
        });

        // Sort by account → campaign group
        allRows.sort((a, b) =>
          a.accountId.localeCompare(b.accountId) ||
          (a.campaignGroupId || '').localeCompare(b.campaignGroupId || '')
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
      'Content-Type':      'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
      'Cache-Control':     'no-cache',
    },
  });
}