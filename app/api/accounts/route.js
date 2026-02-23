import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const res = await fetch(
      'https://api.linkedin.com/v2/adAccountsV2?q=search&search.type.values[0]=BUSINESS&search.status.values[0]=ACTIVE&count=100',
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'LinkedIn-Version': '202401',
        },
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const data = await res.json();
    const accounts = (data.elements || []).map(a => {
      const id = a.id || a.reference?.split(':').pop();
      const name = a.name || `Account ${id}`;
      return { id: parseInt(id), name };
    });

    return NextResponse.json(accounts);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
