import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { accountIds, campaignGroupIds } = await request.json();
    if (!accountIds || accountIds.length === 0) {
      return NextResponse.json([]);
    }

    const allCampaigns = [];

    await Promise.all(
      accountIds.map(async (accountId) => {
        let start = 0;
        const count = 100;
        let hasMore = true;

        while (hasMore) {
          try {
            let url = `https://api.linkedin.com/v2/adCampaignsV2?q=search&search.account.values[0]=urn:li:sponsoredAccount:${accountId}&count=${count}&start=${start}`;

            // Filter by campaign group if specified
            if (campaignGroupIds && campaignGroupIds.length > 0) {
              campaignGroupIds.forEach((gId, idx) => {
                url += `&search.campaignGroup.values[${idx}]=urn:li:sponsoredCampaignGroup:${gId}`;
              });
            }

            const res = await fetch(url, {
              headers: {
                Authorization: `Bearer ${token.accessToken}`,
                'LinkedIn-Version': '202401',
              },
            });

            if (!res.ok) break;

            const data = await res.json();
            const elements = data.elements || [];

            elements.forEach(c => {
              const id = c.id || String(c.id);
              const groupRef = c.campaignGroup || '';
              const groupId = groupRef ? parseInt(groupRef.split(':').pop()) : null;
              allCampaigns.push({
                id: parseInt(id),
                name: c.name || `Campaign ${id}`,
                accountId: parseInt(accountId),
                campaignGroupId: groupId,
                status: c.status || 'ACTIVE',
                type: c.type || '',
              });
            });

            const paging = data.paging;
            hasMore = paging && paging.total
              ? start + count < paging.total
              : elements.length === count;
            start += count;
            if (start >= 2000) break;
          } catch (err) {
            console.error(`Campaigns error for account ${accountId}:`, err);
            break;
          }
        }
      })
    );

    allCampaigns.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json(allCampaigns);
  } catch (error) {
    console.error('Campaigns API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
