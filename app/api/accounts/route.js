import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let allAccounts = [];
    let start = 0;
    const count = 100;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `https://api.linkedin.com/v2/adAccountsV2?q=search&search.type.values[0]=BUSINESS&search.status.values[0]=ACTIVE&count=${count}&start=${start}`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'LinkedIn-Version': '202401',
          },
        }
      );

      if (!res.ok) {
        const err = await res.text();
        console.error('LinkedIn API error:', err);
        break;
      }

      const data = await res.json();
      const elements = data.elements || [];

      const accounts = elements.map(a => {
        const id = a.id || a.reference?.split(':').pop();
        const name = a.name || `Account ${id}`;
        return { id: parseInt(id), name };
      });

      allAccounts = allAccounts.concat(accounts);

      const paging = data.paging;
      if (paging && paging.total) {
        hasMore = start + count < paging.total;
      } else {
        hasMore = elements.length === count;
      }

      start += count;
      if (start >= 1000) break;
    }

    allAccounts.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(allAccounts);
  } catch (error) {
    console.error('Accounts API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
