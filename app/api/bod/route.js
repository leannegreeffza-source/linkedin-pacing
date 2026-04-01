import { getToken } from 'next-auth/jwt';

export const dynamic   = 'force-dynamic';
export const maxDuration = 300;

const LI = token => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': '202501',
});

// ── HTTP helper with retry on 429 ─────────────────────────────────────────────
async function liGet(url, accessToken, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: LI(accessToken),
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) {
        // Rate limited — wait and retry
        const wait = (attempt + 1) * 2000;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }
  return null;
}

// ── Date string builder (raw, no URLSearchParams) ─────────────────────────────
function dateStr(start, end) {
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

// Run N concurrent promises at a time, in rolling batches
async function pooled(items, concurrency, fn) {
  const results = [];
  for (const batch of chunk(items, concurrency)) {
    const res = await Promise.all(batch.map(fn));
    results.push(...res);
  }
  return results;
}

// ── Phase 1: Bulk account-level spend scan ────────────────────────────────────
// Fetches spend for up to 20 accounts in ONE API call using pivot=ACCOUNT.
// Raw URL so fields= commas are not encoded as %2C.
async function getAccountSpendBatch(accountIds, ds, accessToken) {
  const accParams = accountIds
    .map((id, i) => `&accounts[${i}]=urn:li:sponsoredAccount:${id}`)
    .join('');
  const url =
    `https://api.linkedin.com/v2/adAnalyticsV2` +
    `?q=analytics&pivot=ACCOUNT&timeGranularity=ALL` +
    ds + accParams +
    `&fields=costInLocalCurrency,pivotValues`;
  const data = await liGet(url, accessToken);
  const result = {};
  (data?.elements || []).forEach(el => {
    const id    = (el.pivotValues?.[0] || '').split(':').pop();
    const spend = parseFloat(el.costInLocalCurrency || 0);
    if (id && spend > 0) result[id] = spend;
  });
  return result;
}

// ── Phase 2: Campaign spend for a batch of campaign IDs ───────────────────────
async function getCampaignSpendBatch(campaignIds, ds, accessToken) {
  const campParams = campaignIds
    .map((cid, i) => `&campaigns[${i}]=urn:li:sponsoredCampaign:${cid}`)
    .join('');
  const url =
    `https://api.linkedin.com/v2/adAnalyticsV2` +
    `?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL` +
    ds + campParams +
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

// ── Phase 2: Full campaign detail for one account that has spend ───────────────
async function processAccount(accountId, ds, accessToken) {
  try {
    const accUrn   = `urn:li:sponsoredAccount:${accountId}`;
    const campaigns = [];
    let campStart  = 0;

    // Fetch ALL campaigns for this account
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

    // Build meta map and collect unique group IDs
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

    // Fetch spend for campaigns in batches of 20 (3 concurrent)
    const campIds  = campaigns.map(c => String(c.id));
    const spendMap = {};
    await pooled(chunk(campIds, 20), 3, async batch => {
      const res = await getCampaignSpendBatch(batch, ds, accessToken);
      Object.assign(spendMap, res);
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
    console.error(`[BOD] processAccount ${accountId} error:`, err.message);
    return [];
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────
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
  const ds       = dateStr(start, clampEnd);

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = obj => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      try {
        const total = accountIds.length;

        // ── PHASE 1: Scan ALL accounts for spend in bulk ─────────────────────
        // 20 accounts per API call, 20 calls concurrent = 400 accounts at a time
        // For 3000 accounts: 150 API calls → ~8 batches of 20 concurrent = very fast
        send({ phase: 1, pct: 2, message: `Phase 1: Scanning ${total} accounts for spend…` });

        const accountSpend = {};
        const accountBatches = chunk(accountIds, 20); // 20 accounts per API call
        let batchesDone = 0;

        await pooled(accountBatches, 20, async batch => {
          const result = await getAccountSpendBatch(batch, ds, token.accessToken);
          Object.assign(accountSpend, result);
          batchesDone++;
          if (batchesDone % 10 === 0 || batchesDone === accountBatches.length) {
            const scanned = Math.min(batchesDone * 20, total);
            send({
              phase: 1,
              pct: Math.round((scanned / total) * 40),
              message: `Phase 1: Scanned ${scanned}/${total} accounts — ${Object.keys(accountSpend).length} have spend…`,
            });
          }
        });

        const spendingIds = Object.keys(accountSpend);
        send({
          phase: 1, done: true, pct: 42,
          spendingCount: spendingIds.length,
          totalCount: total,
          message: `✓ Phase 1 complete — ${spendingIds.length} of ${total} accounts have spend`,
        });

        if (spendingIds.length === 0) {
          send({ done: true, rows: [], total: 0 });
          controller.close();
          return;
        }

        // ── PHASE 2: Campaign detail only for accounts with spend ─────────────
        // Typically 50-150 accounts — very manageable
        send({
          phase: 2, pct: 45,
          message: `Phase 2: Fetching campaign detail for ${spendingIds.length} accounts…`,
        });

        let processed = 0;
        const allRows = [];

        await pooled(spendingIds, 8, async accountId => {
          const rows = await processAccount(accountId, ds, token.accessToken);
          allRows.push(...rows);
          processed++;
          if (processed % 3 === 0 || processed === spendingIds.length) {
            send({
              phase: 2,
              pct: 45 + Math.round((processed / spendingIds.length) * 53),
              message: `Phase 2: ${processed}/${spendingIds.length} accounts · ${allRows.length} rows`,
              processed,
              total: spendingIds.length,
              rowsSoFar: allRows.length,
            });
          }
        });

        // Sort: account → campaign group
        allRows.sort((a, b) =>
          a.accountId.localeCompare(b.accountId) ||
          (a.campaignGroupId || '').localeCompare(b.campaignGroupId || '')
        );

        send({ done: true, rows: allRows, total: allRows.length });

      } catch (err) {
        console.error('[BOD] stream error:', err);
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