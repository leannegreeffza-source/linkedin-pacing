import { getToken } from 'next-auth/jwt';

export const dynamic    = 'force-dynamic';
export const maxDuration = 300;

const LI = token => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': '202501',
});

// ─── HTTP helper — retries on 429, logs errors ────────────────────────────────
async function liGet(url, token, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: LI(token), signal: AbortSignal.timeout(25000) });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, (i + 1) * 3000));
        continue;
      }
      if (!res.ok) {
        console.error(`[BOD] ${res.status} ${url.slice(0, 120)} — ${(await res.text().catch(() => '')).slice(0, 200)}`);
        return null;
      }
      return res.json();
    } catch (e) {
      if (i === retries) return null;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

// ─── Date string — raw (avoids %2C encoding on fields) ───────────────────────
function ds(s, e) {
  return `&dateRange.start.year=${s.getFullYear()}&dateRange.start.month=${s.getMonth()+1}&dateRange.start.day=${s.getDate()}` +
         `&dateRange.end.year=${e.getFullYear()}&dateRange.end.month=${e.getMonth()+1}&dateRange.end.day=${e.getDate()}`;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function pooled(items, n, fn) {
  const out = [];
  for (const b of chunk(items, n)) out.push(...await Promise.all(b.map(fn)));
  return out;
}

// ─── PHASE 1 ─────────────────────────────────────────────────────────────────
// Scan a batch of ≤20 account IDs in one API call.
// Uses pivot=ACCOUNT + costInUsd (matches Dataslayer exactly).
// LinkedIn only returns accounts that actually have spend — natural filter.
async function scanBatch(ids, dateStr, token) {
  const params = ids.map((id, i) => `&accounts[${i}]=urn:li:sponsoredAccount:${id}`).join('');
  const data   = await liGet(
    `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=ACCOUNT&timeGranularity=ALL` +
    dateStr + params + `&fields=costInUsd,pivotValues`, token
  );
  const out = {};
  (data?.elements || []).forEach(el => {
    const id    = (el.pivotValues?.[0] || '').split(':').pop();
    const spend = parseFloat(el.costInUsd || 0);
    if (id && spend > 0) out[id] = spend;
  });
  return out;
}

// ─── PHASE 2 ─────────────────────────────────────────────────────────────────
// For each account with spend: get campaign groups + campaigns + spend.
// Aggregates spend to campaign-group level (matches Dataslayer row structure).
async function processAccount(accountId, dateStr, token) {
  try {
    const urn = `urn:li:sponsoredAccount:${accountId}`;

    // Fetch campaign groups
    const groups = [];
    for (let s = 0; s < 2000; s += 100) {
      const d = await liGet(
        `https://api.linkedin.com/v2/adCampaignGroupsV2?q=search` +
        `&search.account.values[0]=${encodeURIComponent(urn)}&count=100&start=${s}`, token
      );
      const els = d?.elements || [];
      groups.push(...els);
      if (els.length < 100) break;
    }
    const groupNames = {};
    groups.forEach(g => { groupNames[String(g.id)] = g.name || ''; });

    // Fetch all campaigns
    const campaigns = [];
    for (let s = 0; s < 5000; s += 200) {
      const d = await liGet(
        `https://api.linkedin.com/v2/adCampaignsV2?q=search` +
        `&search.account.values[0]=${encodeURIComponent(urn)}&count=200&start=${s}`, token
      );
      const els = d?.elements || [];
      campaigns.push(...els);
      if (els.length < 200) break;
    }
    if (!campaigns.length) return [];

    // Build campaign metadata
    const campMeta = {};
    campaigns.forEach(c => {
      const cid = String(c.id);
      const gid = (c.campaignGroup || '').split(':').pop();
      campMeta[cid] = {
        gid,
        gname:     groupNames[gid] || '',
        cname:     c.name || '',
        type:      c.type || '',
        campStart: c.runSchedule?.start ? new Date(c.runSchedule.start).toISOString().split('T')[0] : '',
        campEnd:   c.runSchedule?.end   ? new Date(c.runSchedule.end).toISOString().split('T')[0]   : '',
      };
    });

    // Fetch spend per campaign in batches of 20 — use costInUsd
    const campIds  = campaigns.map(c => String(c.id));
    const spendMap = {};
    await pooled(chunk(campIds, 20), 3, async batch => {
      const params = batch.map((cid, i) => `&campaigns[${i}]=urn:li:sponsoredCampaign:${cid}`).join('');
      const data   = await liGet(
        `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL` +
        dateStr + params + `&fields=costInUsd,pivotValues`, token
      );
      (data?.elements || []).forEach(el => {
        const cid   = (el.pivotValues?.[0] || '').split(':').pop();
        const spend = parseFloat(el.costInUsd || 0);
        if (cid && spend > 0) spendMap[cid] = (spendMap[cid] || 0) + spend;
      });
    });

    // Aggregate to campaign-group level (one row per group)
    const groupAgg = {};
    Object.entries(spendMap).forEach(([cid, spend]) => {
      const m = campMeta[cid];
      if (!m) return;
      const gid = m.gid || '0';
      if (!groupAgg[gid]) {
        groupAgg[gid] = {
          gname: m.gname, spend: 0,
          campStart: m.campStart, campEnd: m.campEnd,
          adUnits: new Set(),
        };
      }
      groupAgg[gid].spend += spend;
      if (m.type) groupAgg[gid].adUnits.add(m.type);
      // Track date range across all campaigns in group
      if (m.campStart && (!groupAgg[gid].campStart || m.campStart < groupAgg[gid].campStart))
        groupAgg[gid].campStart = m.campStart;
      if (m.campEnd && (!groupAgg[gid].campEnd || m.campEnd > groupAgg[gid].campEnd))
        groupAgg[gid].campEnd = m.campEnd;
    });

    return Object.entries(groupAgg)
      .filter(([, v]) => v.spend > 0)
      .map(([gid, v]) => ({
        accountId:         String(accountId),
        campaignGroupId:   gid,
        campaignGroupName: v.gname,
        adUnit:            [...v.adUnits].join(', '),
        campStartDate:     v.campStart,
        campEndDate:       v.campEnd,
        mediaSpendUSD:     v.spend,
        localSpend:        v.spend,   // USD — will be converted to ZAR in front-end via FX
        // Grey fields — filled by ref sheet in front-end
        category: '', io: '', staffCode: '', billingAgency: '', bookingAgency: '',
        advertiser: '', industry: '', ciNumber: '', specialNotes: '', campaignName: '',
      }));

  } catch (err) {
    console.error(`[BOD] processAccount ${accountId}:`, err.message);
    return [];
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });

  const { accountIds, startDate, endDate } = await request.json();
  if (!accountIds?.length) return new Response(JSON.stringify({ error: 'No accounts' }), { status: 400 });

  const now   = new Date();
  const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = endDate   ? new Date(endDate)   : now;
  const dateStr = ds(start, end > now ? now : end);

  const enc    = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = o => { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch {} };
      try {
        const total = accountIds.length;
        send({ phase: 1, pct: 2, message: `Scanning ${total.toLocaleString()} accounts for spend…` });

        // Phase 1 — 20 accounts/call, 15 concurrent = 300/round. Fast for 3000 accounts.
        const spendMap = {};
        const batches  = chunk(accountIds, 20);
        let done1 = 0;
        await pooled(batches, 15, async b => {
          Object.assign(spendMap, await scanBatch(b, dateStr, token.accessToken));
          done1++;
          if (done1 % 10 === 0 || done1 === batches.length) {
            const scanned = Math.min(done1 * 20, total);
            send({ phase: 1, pct: Math.round((scanned / total) * 42),
              message: `Scanning… ${scanned.toLocaleString()}/${total.toLocaleString()} · ${Object.keys(spendMap).length} with spend` });
          }
        });

        const spendingIds = Object.keys(spendMap);
        console.log(`[BOD] Phase 1: ${spendingIds.length}/${total} have spend`);
        send({ phase: 1, pct: 44, spendingCount: spendingIds.length, totalCount: total,
          message: `✓ ${spendingIds.length} of ${total} accounts have spend — fetching detail…` });

        if (!spendingIds.length) { send({ done: true, rows: [], total: 0 }); ctrl.close(); return; }

        // Phase 2 — fetch campaign group detail for spending accounts only
        let done2 = 0;
        const rows = [];
        await pooled(spendingIds, 8, async id => {
          rows.push(...await processAccount(id, dateStr, token.accessToken));
          done2++;
          if (done2 % 3 === 0 || done2 === spendingIds.length) {
            send({ phase: 2, pct: 44 + Math.round((done2 / spendingIds.length) * 54),
              message: `Fetching detail… ${done2}/${spendingIds.length} accounts · ${rows.length} rows`,
              processed: done2, total: spendingIds.length, rowsSoFar: rows.length });
          }
        });

        rows.sort((a, b) =>
          a.accountId.localeCompare(b.accountId) ||
          (a.campaignGroupId || '').localeCompare(b.campaignGroupId || '')
        );

        console.log(`[BOD] Done: ${rows.length} rows`);
        send({ done: true, rows, total: rows.length });
      } catch (e) {
        console.error('[BOD]', e);
        send({ error: e.message });
      }
      ctrl.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked',
               'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache' },
  });
}