import { getToken } from 'next-auth/jwt';

export const dynamic    = 'force-dynamic';
export const maxDuration = 300;

// ── LinkedIn API helper ───────────────────────────────────────────────────────
const LI = token => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': '202501',
});

async function liGet(url, accessToken, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: LI(accessToken),
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) {
        const wait = (attempt + 1) * 3000;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[BOD] ${res.status} — ${url.slice(0, 120)} — ${body.slice(0, 200)}`);
        return null;
      }
      return res.json();
    } catch (e) {
      if (attempt === retries) return null;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

// ── Date string (raw, avoids %2C encoding) ────────────────────────────────────
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
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

// ── PHASE 1: Scan a batch of accounts for spend using costInUsd ───────────────
// Matches Dataslayer exactly: costInUsd, pivot=ACCOUNT, timeGranularity=ALL
// LinkedIn returns ONLY accounts that have spend — perfect for filtering.
// Up to 20 accounts per call, 15 calls concurrent = 300 accounts/round.
async function scanAccountsBatch(accountIds, ds, accessToken) {
  const accParams = accountIds
    .map((id, i) => `&accounts[${i}]=urn:li:sponsoredAccount:${id}`)
    .join('');
  const url =
    `https://api.linkedin.com/v2/adAnalyticsV2` +
    `?q=analytics&pivot=ACCOUNT&timeGranularity=ALL` +
    ds + accParams +
    `&fields=costInUsd,pivotValues`;
  const data = await liGet(url, accessToken);
  const result = {};
  (data?.elements || []).forEach(el => {
    const id    = (el.pivotValues?.[0] || '').split(':').pop();
    const spend = parseFloat(el.costInUsd || 0);
    if (id && spend > 0) result[id] = spend;
  });
  return result;
}

// ── PHASE 2: Get campaign-group-level spend for one account ───────────────────
// Matches Dataslayer dimensions: account_id, campaign_group_id, campaign_group_name
// Aggregates all campaign spend UP to campaign-group level.
async function getAccountCampaignGroups(accountId, ds, accessToken) {
  try {
    const accUrn = `urn:li:sponsoredAccount:${accountId}`;

    // Step A: Fetch all campaign groups for this account
    const groups = [];
    let gStart = 0;
    while (gStart < 2000) {
      const data = await liGet(
        `https://api.linkedin.com/v2/adCampaignGroupsV2?q=search` +
        `&search.account.values[0]=${encodeURIComponent(accUrn)}` +
        `&count=100&start=${gStart}`,
        accessToken
      );
      const els = data?.elements || [];
      groups.push(...els);
      if (els.length < 100) break;
      gStart += 100;
    }

    // Step B: Fetch all campaigns to get start/end dates and ad unit types
    const campaigns = [];
    let cStart = 0;
    while (cStart < 5000) {
      const data = await liGet(
        `https://api.linkedin.com/v2/adCampaignsV2?q=search` +
        `&search.account.values[0]=${encodeURIComponent(accUrn)}` +
        `&count=200&start=${cStart}`,
        accessToken
      );
      const els = data?.elements || [];
      campaigns.push(...els);
      if (els.length < 200) break;
      cStart += 200;
    }

    // Build group metadata map
    const groupMeta = {};
    groups.forEach(g => {
      groupMeta[String(g.id)] = { name: g.name || '' };
    });

    // Map campaign → group, get start/end dates
    const campToGroup = {};
    campaigns.forEach(c => {
      const cid = String(c.id);
      const gid = (c.campaignGroup || '').split(':').pop();
      campToGroup[cid] = {
        groupId:   gid,
        groupName: groupMeta[gid]?.name || '',
        campName:  c.name || '',
        type:      c.type || '',
        campStart: c.runSchedule?.start
          ? new Date(c.runSchedule.start).toISOString().split('T')[0] : '',
        campEnd:   c.runSchedule?.end
          ? new Date(c.runSchedule.end).toISOString().split('T')[0]   : '',
      };
    });

    if (!campaigns.length) return [];

    // Step C: Get spend per campaign using costInUsd (matches Dataslayer)
    const campIds  = campaigns.map(c => String(c.id));
    const spendMap = {};
    await pooled(chunk(campIds, 20), 3, async batch => {
      const campParams = batch
        .map((cid, i) => `&campaigns[${i}]=urn:li:sponsoredCampaign:${cid}`)
        .join('');
      const url =
        `https://api.linkedin.com/v2/adAnalyticsV2` +
        `?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL` +
        ds + campParams +
        `&fields=costInUsd,pivotValues`;
      const data = await liGet(url, accessToken);
      (data?.elements || []).forEach(el => {
        const cid   = (el.pivotValues?.[0] || '').split(':').pop();
        const spend = parseFloat(el.costInUsd || 0);
        if (cid && spend > 0) spendMap[cid] = (spendMap[cid] || 0) + spend;
      });
    });

    // Step D: Aggregate campaign spend UP to campaign-group level
    // This matches Dataslayer: one row per account + campaign group
    const groupSpend   = {};  // groupId → total USD spend
    const groupInfo    = {};  // groupId → metadata

    Object.entries(spendMap).forEach(([cid, spend]) => {
      const meta = campToGroup[cid];
      if (!meta) return;
      const gid = meta.groupId || '0';
      groupSpend[gid] = (groupSpend[gid] || 0) + spend;
      if (!groupInfo[gid]) {
        groupInfo[gid] = {
          groupName: meta.groupName,
          // Track earliest campStart and latest campEnd across all campaigns in group
          campStart: meta.campStart,
          campEnd:   meta.campEnd,
          // Collect unique ad unit types in this group
          adUnits: new Set(),
        };
      }
      // Keep earliest start, latest end
      if (meta.campStart && (!groupInfo[gid].campStart || meta.campStart < groupInfo[gid].campStart))
        groupInfo[gid].campStart = meta.campStart;
      if (meta.campEnd && (!groupInfo[gid].campEnd || meta.campEnd > groupInfo[gid].campEnd))
        groupInfo[gid].campEnd = meta.campEnd;
      if (meta.type) groupInfo[gid].adUnits.add(meta.type);
    });

    // Return one row per campaign group with spend
    return Object.entries(groupSpend)
      .filter(([, spend]) => spend > 0)
      .map(([gid, mediaSpendUSD]) => {
        const info = groupInfo[gid] || {};
        return {
          accountId:         String(accountId),
          campaignGroupId:   gid,
          campaignGroupName: info.groupName || '',
          campaignName:      '',   // group-level row, no single campaign name
          adUnit:            [...(info.adUnits || [])].join(', '),
          campStartDate:     info.campStart || '',
          campEndDate:       info.campEnd   || '',
          localSpend:        mediaSpendUSD,  // USD from costInUsd
          mediaSpendUSD,
        };
      });

  } catch (err) {
    console.error(`[BOD] getAccountCampaignGroups ${accountId} error:`, err.message);
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

        // ── PHASE 1: Scan ALL accounts for spend ─────────────────────────────
        // 20 accounts per API call, 15 concurrent = 300 accounts/round
        // 3000 accounts = 150 API calls ÷ 15 concurrent = 10 rounds (~15 secs)
        send({ phase: 1, pct: 2, message: `Scanning ${total.toLocaleString()} accounts for spend (USD)…` });

        const accountSpend = {};
        const batches      = chunk(accountIds, 20);
        let batchesDone    = 0;

        await pooled(batches, 15, async batch => {
          const result = await scanAccountsBatch(batch, ds, token.accessToken);
          Object.assign(accountSpend, result);
          batchesDone++;
          if (batchesDone % 10 === 0 || batchesDone === batches.length) {
            const scanned = Math.min(batchesDone * 20, total);
            const found   = Object.keys(accountSpend).length;
            send({
              phase: 1,
              pct: Math.round((scanned / total) * 40),
              message: `Phase 1: ${scanned.toLocaleString()} / ${total.toLocaleString()} accounts scanned · ${found} have spend`,
            });
          }
        });

        const spendingIds = Object.keys(accountSpend);
        console.log(`[BOD] Phase 1: ${spendingIds.length}/${total} accounts have spend`);

        send({
          phase: 1, pct: 42,
          spendingCount: spendingIds.length,
          totalCount: total,
          message: `✓ Phase 1: ${spendingIds.length} of ${total} accounts have spend — fetching campaign groups…`,
        });

        if (spendingIds.length === 0) {
          send({ done: true, rows: [], total: 0 });
          controller.close();
          return;
        }

        // ── PHASE 2: Campaign-group detail for accounts with spend ────────────
        // Typically 50–150 accounts. 8 concurrent.
        let processed = 0;
        const allRows = [];

        await pooled(spendingIds, 8, async accountId => {
          const rows = await getAccountCampaignGroups(accountId, ds, token.accessToken);
          allRows.push(...rows);
          processed++;
          if (processed % 3 === 0 || processed === spendingIds.length) {
            send({
              phase: 2,
              pct: 42 + Math.round((processed / spendingIds.length) * 56),
              message: `Phase 2: ${processed} / ${spendingIds.length} accounts · ${allRows.length} rows`,
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