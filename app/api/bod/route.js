import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const LI = (token) => ({ Authorization: `Bearer ${token}`, 'LinkedIn-Version': '202401' });

async function liGet(url, accessToken) {
  const res = await fetch(url, { headers: LI(accessToken) });
  if (!res.ok) return null;
  return res.json();
}

// Build URLSearchParams for a date range
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

// ── Step 1: Get account-level spend for up to 20 accounts in one call ──────────
// Returns { accountId: spend }
async function getAccountSpend(accountIds, dp, accessToken) {
  const p = new URLSearchParams({
    q: 'analytics',
    pivot: 'ACCOUNT',
    timeGranularity: 'ALL',
    ...dp,
    fields: 'costInLocalCurrency,pivotValues',
  });
  accountIds.forEach((id, i) =>
    p.append(`accounts[${i}]`, `urn:li:sponsoredAccount:${id}`)
  );
  const data = await liGet(
    `https://api.linkedin.com/v2/adAnalyticsV2?${p.toString()}`,
    accessToken
  );
  const result = {};
  (data?.elements || []).forEach(el => {
    const urn   = el.pivotValues?.[0] || '';
    const id    = urn.split(':').pop();
    const spend = parseFloat(el.costInLocalCurrency || 0);
    if (spend > 0) result[id] = (result[id] || 0) + spend;
  });
  return result;
}

// ── Step 2: Get campaign-level spend for up to 20 campaigns in one call ────────
async function getCampaignSpend(campaignIds, dp, accessToken) {
  const p = new URLSearchParams({
    q: 'analytics',
    pivot: 'CAMPAIGN',
    timeGranularity: 'ALL',
    ...dp,
    fields: 'costInLocalCurrency,pivotValues',
  });
  campaignIds.forEach((cid, i) =>
    p.append(`campaigns[${i}]`, `urn:li:sponsoredCampaign:${cid}`)
  );
  const data = await liGet(
    `https://api.linkedin.com/v2/adAnalyticsV2?${p.toString()}`,
    accessToken
  );
  const result = {};
  (data?.elements || []).forEach(el => {
    const urn   = el.pivotValues?.[0] || '';
    const cid   = urn.split(':').pop();
    const spend = parseFloat(el.costInLocalCurrency || 0);
    if (spend > 0) result[cid] = (result[cid] || 0) + spend;
  });
  return result;
}

// Chunk array into groups of n
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { accountIds, startDate, endDate } = await request.json();
    if (!accountIds?.length) {
      return NextResponse.json({ error: 'No accounts provided' }, { status: 400 });
    }

    const now   = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = endDate   ? new Date(endDate)   : now;
    const clEnd = end > now ? now : end;
    const dp    = dateParams(start, clEnd);

    // ── Phase 1: Identify which accounts have spend (batched, 20 at a time) ────
    const accountSpend = {};
    await Promise.all(
      chunk(accountIds, 20).map(async (batch) => {
        const result = await getAccountSpend(batch, dp, token.accessToken);
        Object.assign(accountSpend, result);
      })
    );

    const spendingAccountIds = Object.keys(accountSpend);
    if (spendingAccountIds.length === 0) {
      return NextResponse.json({ rows: [], total: 0 });
    }

    // ── Phase 2: For spending accounts, fetch campaigns + campaign spend ────────
    const allRows = [];

    await Promise.all(spendingAccountIds.map(async (accountId) => {
      try {
        const accUrn = `urn:li:sponsoredAccount:${accountId}`;

        // Fetch all campaigns for this account (paginate up to 1000)
        const campaigns = [];
        let campStart = 0;
        while (true) {
          const data = await liGet(
            `https://api.linkedin.com/v2/adCampaignsV2?q=search` +
            `&search.account.values[0]=${encodeURIComponent(accUrn)}` +
            `&count=200&start=${campStart}`,
            token.accessToken
          );
          const els = data?.elements || [];
          campaigns.push(...els);
          if (els.length < 200) break;
          campStart += 200;
          if (campStart >= 1000) break;
        }

        if (!campaigns.length) return;

        // Build campaign metadata lookup
        const campMeta = {};
        const groupIds = new Set();
        campaigns.forEach(c => {
          const cid  = String(c.id);
          const gurn = c.campaignGroup || '';
          const gid  = gurn ? gurn.split(':').pop() : '';
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

        // Fetch group names in parallel (deduplicated)
        await Promise.all([...groupIds].map(async (gid) => {
          try {
            const g = await liGet(
              `https://api.linkedin.com/v2/adCampaignGroupsV2/${gid}`,
              token.accessToken
            );
            const name = g?.name || '';
            Object.values(campMeta).forEach(m => {
              if (m.groupId === gid) m.groupName = name;
            });
          } catch {}
        }));

        // Get campaign-level spend (batches of 20)
        const campIds  = campaigns.map(c => String(c.id));
        const spendMap = {};
        await Promise.all(
          chunk(campIds, 20).map(async (batch) => {
            const result = await getCampaignSpend(batch, dp, token.accessToken);
            Object.assign(spendMap, result);
          })
        );

        // Emit one row per campaign with spend
        Object.entries(spendMap).forEach(([cid, localSpend]) => {
          const meta = campMeta[cid];
          if (!meta) return;
          allRows.push({
            accountId:         String(accountId),
            campaignGroupId:   meta.groupId   || '',
            campaignGroupName: meta.groupName || '',
            campaignName:      meta.name,
            adUnit:            meta.type,
            campStartDate:     meta.campStart,
            campEndDate:       meta.campEnd,
            localSpend,
            mediaSpendUSD:     localSpend,
          });
        });

      } catch (e) {
        console.error(`Account ${accountId} error:`, e.message);
      }
    }));

    allRows.sort((a, b) =>
      a.accountId.localeCompare(b.accountId) ||
      a.campaignGroupId.localeCompare(b.campaignGroupId)
    );

    return NextResponse.json({ rows: allRows, total: allRows.length });
  } catch (error) {
    console.error('BOD API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}