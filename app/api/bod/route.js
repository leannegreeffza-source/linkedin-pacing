import { getToken } from 'next-auth/jwt';

export const dynamic    = 'force-dynamic';
export const maxDuration = 300;

const LI = token => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': '202501',
});

// ── HTTP helper — returns { ok, data, status } ────────────────────────────────
async function liGet(url, accessToken, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: LI(accessToken),
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) {
        const wait = (attempt + 1) * 3000;
        console.log(`[BOD] 429 rate limit — waiting ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[BOD] ${res.status} ${url.slice(0, 120)} — ${body.slice(0, 200)}`);
        return null;
      }
      return res.json();
    } catch (e) {
      console.error(`[BOD] fetch error attempt ${attempt}:`, e.message);
      if (attempt === retries) return null;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

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

async function pooled(items, concurrency, fn) {
  const results = [];
  for (const batch of chunk(items, concurrency)) {
    const res = await Promise.all(batch.map(fn));
    results.push(...res);
  }
  return results;
}

// ── Phase 1: Check ONE account for any spend ──────────────────────────────────
// Uses pivot=CAMPAIGN scoped to one account — the only reliable way to check
// whether an account has spend without hitting the multi-account filter bug.
async function accountHasSpend(accountId, ds, accessToken) {
  try {
    const accUrn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
    const url =
      `https://api.linkedin.com/v2/adAnalyticsV2` +
      `?q=analytics&pivot=ACCOUNT&timeGranularity=ALL` +
      ds +
      `&accounts[0]=urn:li:sponsoredAccount:${accountId}` +
      `&fields=costInLocalCurrency,pivotValues`;
    const data = await liGet(url, accessToken);
    const total = (data?.elements || []).reduce((sum, el) =>
      sum + parseFloat(el.costInLocalCurrency || 0), 0);
    return total > 0;
  } catch { return false; }
}

// ── Phase 1 (fast): batch account scan using campaign pivot ───────────────────
// LinkedIn adAnalyticsV2 with pivot=ACCOUNT only returns data for accounts
// that actually have spend — so we query ALL accounts at once and get back
// only the ones with spend.  Max ~100 accounts per call is safe.
async function scanAccountsForSpend(accountIds, ds, accessToken) {
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
    const accUrn    = `urn:li:sponsoredAccount:${accountId}`;
    const campaigns = [];
    let campStart   = 0;

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

    // Fetch group names (5 concurrent)
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

    // Campaign spend in batches of 20 (3 concurrent)
    const campIds  = campaigns.map(c => String(c.id));
    const spendMap = {};
    await pooled(chunk(campIds, 20), 3, async batch => {
      const res = await getCampaignSpendBatch(batch, ds, accessToken);
      Object.assign(spendMap, res);
    });

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

// ── POST ──────────────────────────────────────────────────────────────────────
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
        send({ phase: 1, pct: 2, message: `Phase 1: Scanning ${total} accounts for spend…` });

        // ── PHASE 1: Scan accounts in batches of 20, 15 concurrent ────────────
        // Each batch is ONE API call. 3000 accounts = 150 calls, 15 concurrent
        // = 10 rounds. LinkedIn returns ONLY accounts that have spend — perfect.
        const accountSpend = {};
        const batches      = chunk(accountIds, 20);
        let batchesDone    = 0;

        await pooled(batches, 15, async batch => {
          const result = await scanAccountsForSpend(batch, ds, token.accessToken);
          Object.assign(accountSpend, result);
          batchesDone++;
          if (batchesDone % 10 === 0 || batchesDone === batches.length) {
            const scanned = Math.min(batchesDone * 20, total);
            const found   = Object.keys(accountSpend).length;
            send({
              phase: 1,
              pct: Math.round((scanned / total) * 42),
              message: `Phase 1: ${scanned.toLocaleString()}/${total.toLocaleString()} accounts scanned · ${found} have spend`,
            });
          }
        });

        const spendingIds = Object.keys(accountSpend);
        console.log(`[BOD] Phase 1 done: ${spendingIds.length}/${total} accounts have spend`);

        send({
          phase: 1, pct: 44,
          spendingCount: spendingIds.length,
          totalCount: total,
          message: `✓ ${spendingIds.length} of ${total} accounts have spend — fetching campaign detail…`,
        });

        if (spendingIds.length === 0) {
          send({ done: true, rows: [], total: 0 });
          controller.close();
          return;
        }

        // ── PHASE 2: Campaign detail for accounts with spend ──────────────────
        let processed = 0;
        const allRows = [];

        await pooled(spendingIds, 8, async accountId => {
          const rows = await processAccount(accountId, ds, token.accessToken);
          allRows.push(...rows);
          processed++;
          if (processed % 3 === 0 || processed === spendingIds.length) {
            send({
              phase: 2,
              pct: 44 + Math.round((processed / spendingIds.length) * 54),
              message: `Phase 2: ${processed}/${spendingIds.length} accounts · ${allRows.length} rows`,
              processed,
              total: spendingIds.length,
              rowsSoFar: allRows.length,
            });
          }
        });

        allRows.sort((a, b) =>
          a.accountId.localeCompare(b.accountId) ||
          (a.campaignGroupId || '').localeCompare(b.campaignGroupId || '')
        );

        console.log(`[BOD] Done: ${allRows.length} rows from ${spendingIds.length} accounts`);
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