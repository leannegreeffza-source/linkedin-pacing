import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { accountIds, startDate, endDate } = await request.json();
    if (!accountIds || accountIds.length === 0) {
      return NextResponse.json({ error: 'No accounts provided' }, { status: 400 });
    }

    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : now;
    const clampedEnd = end > now ? now : end;

    const allRows = [];

    await Promise.all(accountIds.map(async (accountId) => {
      try {
        // Get all campaign groups for account
        const groupsRes = await fetch(
          `https://api.linkedin.com/v2/adCampaignGroupsV2?q=search&search.account.values[0]=urn:li:sponsoredAccount:${accountId}&count=100`,
          { headers: { Authorization: `Bearer ${token.accessToken}`, 'LinkedIn-Version': '202401' } }
        );
        if (!groupsRes.ok) return;
        const groups = (await groupsRes.json()).elements || [];

        await Promise.all(groups.map(async (group) => {
          try {
            const groupId = group.id;
            const groupName = group.name || '';

            // Get campaigns in group
            const campRes = await fetch(
              `https://api.linkedin.com/v2/adCampaignsV2?q=search&search.campaignGroup.values[0]=urn:li:sponsoredCampaignGroup:${groupId}&count=100`,
              { headers: { Authorization: `Bearer ${token.accessToken}`, 'LinkedIn-Version': '202401' } }
            );
            if (!campRes.ok) return;
            const campaigns = (await campRes.json()).elements || [];

            await Promise.all(campaigns.map(async (campaign) => {
              try {
                const campId = campaign.id;
                const params = new URLSearchParams({
                  q: 'analytics',
                  pivot: 'CAMPAIGN',
                  timeGranularity: 'ALL',
                  'dateRange.start.year': start.getFullYear(),
                  'dateRange.start.month': start.getMonth() + 1,
                  'dateRange.start.day': start.getDate(),
                  'dateRange.end.year': clampedEnd.getFullYear(),
                  'dateRange.end.month': clampedEnd.getMonth() + 1,
                  'dateRange.end.day': clampedEnd.getDate(),
                  'campaigns[0]': `urn:li:sponsoredCampaign:${campId}`,
                  fields: 'costInLocalCurrency,impressions,clicks',
                });
                const aRes = await fetch(
                  `https://api.linkedin.com/v2/adAnalyticsV2?${params.toString()}`,
                  { headers: { Authorization: `Bearer ${token.accessToken}`, 'LinkedIn-Version': '202401' } }
                );
                if (!aRes.ok) return;
                const el = (await aRes.json()).elements?.[0];
                if (!el) return;
                const localSpend = parseFloat(el.costInLocalCurrency || 0);
                if (localSpend === 0) return;

                allRows.push({
                  accountId: String(accountId),
                  campaignGroupId: String(groupId),
                  campaignGroupName: groupName,
                  campaignName: campaign.name || '',
                  adUnit: campaign.type || '',
                  startDate: campaign.runSchedule?.start
                    ? new Date(campaign.runSchedule.start).toISOString().split('T')[0] : '',
                  endDate: campaign.runSchedule?.end
                    ? new Date(campaign.runSchedule.end).toISOString().split('T')[0] : '',
                  localSpend,
                  mediaSpendUSD: localSpend,
                });
              } catch (e) { console.error(`Camp error:`, e.message); }
            }));
          } catch (e) { console.error(`Group error:`, e.message); }
        }));
      } catch (e) { console.error(`Account error:`, e.message); }
    }));

    allRows.sort((a, b) => a.accountId.localeCompare(b.accountId) || a.campaignGroupId.localeCompare(b.campaignGroupId));
    return NextResponse.json({ rows: allRows });
  } catch (error) {
    console.error('BOD API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}