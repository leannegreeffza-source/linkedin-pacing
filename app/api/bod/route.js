import { getToken } from 'next-auth/jwt';

export const dynamic    = 'force-dynamic';
export const maxDuration = 300;

const LI = token => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': '202501',
});

async function liGet(url, token, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: LI(token), signal: AbortSignal.timeout(25000) });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, (i + 1) * 4000));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[BOD] ${res.status} ${url.slice(0,100)} — ${body.slice(0,200)}`);
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

function ds(s, e) {
  return (
    `&dateRange.start.year=${s.getFullYear()}&dateRange.start.month=${s.getMonth()+1}&dateRange.start.day=${s.getDate()}` +
    `&dateRange.end.year=${e.getFullYear()}&dateRange.end.month=${e.getMonth()+1}&dateRange.end.day=${e.getDate()}`
  );
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

// ── PHASE 1: Get campaign-level spend for ALL campaigns under one account ──────
// This is the ONLY reliable way — LinkedIn analytics scoped to one account
// using pivot=CAMPAIGN returns all campaigns with spend for that account.
// We sum them to get the account total, then use the campaign spend map in Phase 2.
async function getAccountCampaignSpend(accountId, dateStr, token) {
  try {
    const urn = `urn:li:sponsoredAccount:${accountId}`;

    // Get all campaigns for this account
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
    if (!campaigns.length) return { totalSpend: 0, campaigns: [], spendMap: {} };

    // Get spend for all campaigns in batches of 20
    const campIds = campaigns.map(c => String(c.id));
    const spendMap = {};
    await pooled(chunk(campIds, 20), 3, async batch => {
      const params = batch.map((cid, i) => `&campaigns[${i}]=urn:li:sponsoredCampaign:${cid}`).join('');
      const data = await liGet(
        `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL` +
        dateStr + params + `&fields=costInUsd,pivotValues`, token
      );
      (data?.elements || []).forEach(el => {
        const cid   = (el.pivotValues?.[0] || '').split(':').pop();
        const spend = parseFloat(el.costInUsd || 0);
        if (cid && spend > 0) spendMap[cid] = (spendMap[cid] || 0) + spend;
      });
    });

    const totalSpend = Object.values(spendMap).reduce((a, b) => a + b, 0);
    return { totalSpend, campaigns, spendMap };
  } catch (err) {
    console.error(`[BOD] getAccountCampaignSpend ${accountId}:`, err.message);
    return { totalSpend: 0, campaigns: [], spendMap: {} };
  }
}

// ── PHASE 2: Aggregate campaign spend to campaign-group level ─────────────────
async function processAccount(accountId, dateStr, token) {
  try {
    const { totalSpend, campaigns, spendMap } = await getAccountCampaignSpend(accountId, dateStr, token);

    if (totalSpend === 0) return [];

    const urn = `urn:li:sponsoredAccount:${accountId}`;

    // Fetch campaign groups for names
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

    // Build campaign meta
    const campMeta = {};
    campaigns.forEach(c => {
      const cid = String(c.id);
      const gid = (c.campaignGroup || '').split(':').pop();
      campMeta[cid] = {
        gid, gname: groupNames[gid] || '', type: c.type || '',
        campStart: c.runSchedule?.start ? new Date(c.runSchedule.start).toISOString().split('T')[0] : '',
        campEnd:   c.runSchedule?.end   ? new Date(c.runSchedule.end).toISOString().split('T')[0]   : '',
      };
    });

    // Aggregate spend to campaign-group level
    const groupAgg = {};
    Object.entries(spendMap).forEach(([cid, spend]) => {
      const m = campMeta[cid];
      if (!m) return;
      const gid = m.gid || '0';
      if (!groupAgg[gid]) {
        groupAgg[gid] = { gname: m.gname, spend: 0, campStart: m.campStart, campEnd: m.campEnd, adUnits: new Set() };
      }
      groupAgg[gid].spend += spend;
      if (m.type) groupAgg[gid].adUnits.add(m.type);
      if (m.campStart && (!groupAgg[gid].campStart || m.campStart < groupAgg[gid].campStart))
        groupAgg[gid].campStart = m.campStart;
      if (m.campEnd && (!groupAgg[gid].campEnd || m.campEnd > groupAgg[gid].campEnd))
        groupAgg[gid].campEnd = m.campEnd;
    });

    return Object.entries(groupAgg)
      .filter(([, v]) => v.spend > 0)
      .map(([gid, v]) => ({
        accountId: String(accountId), campaignGroupId: gid,
        campaignGroupName: v.gname, adUnit: [...v.adUnits].join(', '),
        campStartDate: v.campStart, campEndDate: v.campEnd,
        mediaSpendUSD: v.spend, localSpend: v.spend,
        category: '', io: '', staffCode: '', billingAgency: '', bookingAgency: '',
        advertiser: '', industry: '', ciNumber: '', specialNotes: '', campaignName: '',
      }));
  } catch (err) {
    console.error(`[BOD] processAccount ${accountId}:`, err.message);
    return [];
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });

  const { accountIds, startDate, endDate } = await request.json();
  if (!accountIds?.length) return new Response(JSON.stringify({ error: 'No accounts' }), { status: 400 });

  const now     = new Date();
  const start   = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end     = endDate   ? new Date(endDate)   : now;
  const dateStr = ds(start, end > now ? now : end);

  console.log(`[BOD] Start: ${accountIds.length} accounts, ${startDate} → ${endDate}`);

  const enc    = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = o => { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch {} };
      try {
        const total = accountIds.length;
        send({ phase: 1, pct: 2, message: `Fetching spend for ${total} accounts…` });

        // Process all accounts directly — get campaigns + spend in one pass
        // No pre-scan needed: fetching campaigns IS the scan
        // 5 concurrent to respect rate limits
        let done = 0;
        const rows = [];

        await pooled(accountIds, 5, async id => {
          const accountRows = await processAccount(id, dateStr, token.accessToken);
          rows.push(...accountRows);
          done++;
          if (done % 5 === 0 || done === total) {
            const withSpend = [...new Set(rows.map(r => r.accountId))].length;
            send({
              phase: done < total ? 1 : 2,
              pct: Math.round((done / total) * 95),
              message: `${done}/${total} accounts processed · ${withSpend} with spend · ${rows.length} rows`,
              processed: done, total, rowsSoFar: rows.length,
            });
          }
        });

        rows.sort((a, b) =>
          a.accountId.localeCompare(b.accountId) ||
          (a.campaignGroupId || '').localeCompare(b.campaignGroupId || '')
        );

        const withSpend = [...new Set(rows.map(r => r.accountId))].length;
        console.log(`[BOD] Done: ${rows.length} rows, ${withSpend} accounts with spend`);
        send({ done: true, rows, total: rows.length });

      } catch (e) {
        console.error('[BOD] error:', e);
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