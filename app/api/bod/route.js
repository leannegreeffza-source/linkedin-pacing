import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Helper: LinkedIn API fetch with auth header
async function liGet(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': '202401' },
  });
  if (!res.ok) return null;
  return res.json();
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

    const dsParams = {
      'dateRange.start.year':  start.getFullYear(),
      'dateRange.start.month': start.getMonth() + 1,
      'dateRange.start.day':   start.getDate(),
      'dateRange.end.year':    clEnd.getFullYear(),
      'dateRange.end.month':   clEnd.getMonth() + 1,
      'dateRange.end.day':     clEnd.getDate(),
    };

    const allRows = [];

    await Promise.all(accountIds.map(async (accountId) => {
      try {
        const accUrn = `urn:li:sponsoredAccount:${accountId}`;

        // ── 1. Fetch all campaigns for this account ────────────────────────
        const campsData = await liGet(
          `https://api.linkedin.com/v2/adCampaignsV2?q=search` +
          `&search.account.values[0]=${encodeURIComponent(accUrn)}&count=200`,
          token.accessToken
        );
        const campaigns = campsData?.elements || [];
        if (!campaigns.length) return;

        // Build a lookup: campaignId → { name, type, groupId, groupName, startDate, endDate }
        const campMeta = {};
        const groupIds = new Set();
        campaigns.forEach(c => {
          const cid = String(c.id);
          const gurn = c.campaignGroup || '';
          const gid  = gurn ? gurn.split(':').pop() : '';
          campMeta[cid] = {
            name:      c.name || '',
            type:      c.type || '',
            groupId:   gid,
            groupName: '',                            // filled below
            campStart: c.runSchedule?.start
              ? new Date(c.runSchedule.start).toISOString().split('T')[0] : '',
            campEnd: c.runSchedule?.end
              ? new Date(c.runSchedule.end).toISOString().split('T')[0] : '',
          };
          if (gid) groupIds.add(gid);
        });

        // ── 2. Fetch group names in parallel ──────────────────────────────
        await Promise.all([...groupIds].map(async (gid) => {
          try {
            const gData = await liGet(
              `https://api.linkedin.com/v2/adCampaignGroupsV2/${gid}`,
              token.accessToken
            );
            const name = gData?.name || '';
            campaigns.forEach(c => {
              const cid = String(c.id);
              if (campMeta[cid]?.groupId === gid) campMeta[cid].groupName = name;
            });
          } catch {}
        }));

        // ── 3. Single analytics call for ALL campaigns in this account ─────
        //    LinkedIn allows up to 20 campaigns per analytics call;
        //    batch them in groups of 20.
        const campIds = campaigns.map(c => String(c.id));
        const BATCH = 20;
        const spendMap = {}; // campaignId → localSpend

        for (let i = 0; i < campIds.length; i += BATCH) {
          const batch = campIds.slice(i, i + BATCH);
          const p = new URLSearchParams({
            q: 'analytics',
            pivot: 'CAMPAIGN',
            timeGranularity: 'ALL',
            ...dsParams,
            fields: 'costInLocalCurrency,pivotValues',
          });
          batch.forEach((cid, idx) => {
            p.append(`campaigns[${idx}]`, `urn:li:sponsoredCampaign:${cid}`);
          });

          try {
            const aData = await liGet(
              `https://api.linkedin.com/v2/adAnalyticsV2?${p.toString()}`,
              token.accessToken
            );
            (aData?.elements || []).forEach(el => {
              // pivotValues contains the campaign URN
              const urn = el.pivotValues?.[0] || '';
              const cid = urn.split(':').pop();
              const spend = parseFloat(el.costInLocalCurrency || 0);
              if (spend > 0) spendMap[cid] = (spendMap[cid] || 0) + spend;
            });
          } catch (e) {
            console.error(`Analytics batch error for account ${accountId}:`, e.message);
          }
        }

        // ── 4. Build rows for each campaign that had spend ─────────────────
        Object.entries(spendMap).forEach(([cid, localSpend]) => {
          const meta = campMeta[cid];
          if (!meta) return;
          allRows.push({
            accountId:         String(accountId),
            campaignGroupId:   meta.groupId  || '',
            campaignGroupName: meta.groupName || '',
            campaignName:      meta.name,
            adUnit:            meta.type,
            campStartDate:     meta.campStart,
            campEndDate:       meta.campEnd,
            localSpend,
            mediaSpendUSD: localSpend,   // LinkedIn SA accounts report in USD
          });
        });

      } catch (e) {
        console.error(`Account ${accountId} error:`, e.message);
      }
    }));

    // Sort: accountId asc, then campaignGroupId asc
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