import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { accountIds } = await request.json();
    if (!accountIds || accountIds.length === 0) {
      return NextResponse.json([]);
    }

    const allGroups = [];

    await Promise.all(
      accountIds.map(async (accountId) => {
        let start = 0;
        const count = 100;
        let hasMore = true;

        while (hasMore) {
          try {
            const res = await fetch(
              `https://api.linkedin.com/v2/adCampaignGroupsV2?q=search&search.account.values[0]=urn:li:sponsoredAccount:${accountId}&count=${count}&start=${start}`,
              {
                headers: {
                  Authorization: `Bearer ${token.accessToken}`,
                  'LinkedIn-Version': '202401',
                },
              }
            );

            if (!res.ok) break;

            const data = await res.json();
            const elements = data.elements || [];

            elements.forEach(g => {
              const id = g.id || String(g.id);
              allGroups.push({
                id: parseInt(id),
                name: g.name || `Group ${id}`,
                accountId: parseInt(accountId),
                status: g.status || 'ACTIVE',
              });
            });

            const paging = data.paging;
            hasMore = paging && paging.total
              ? start + count < paging.total
              : elements.length === count;
            start += count;
            if (start >= 500) break;
          } catch (err) {
            console.error(`Campaign groups error for account ${accountId}:`, err);
            break;
          }
        }
      })
    );

    allGroups.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json(allGroups);
  } catch (error) {
    console.error('Campaign groups API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
