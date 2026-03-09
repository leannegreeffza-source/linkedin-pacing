import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const LI = (token) => ({ Authorization: `Bearer ${token}`, 'LinkedIn-Version': '202401' });

async function fetchPage(accessToken, start, count) {
  // No status/type filter — return all accounts the user has access to
  const res = await fetch(
    `https://api.linkedin.com/v2/adAccountsV2?q=search&count=${count}&start=${start}`,
    { headers: LI(accessToken) }
  );
  if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function GET(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const allAccounts = [];
    const PAGE  = 100;    // LinkedIn max per request
    const MAX   = 10000;  // hard ceiling
    let   start = 0;
    let   total = null;

    while (start < MAX) {
      let data;
      try {
        data = await fetchPage(token.accessToken, start, PAGE);
      } catch (err) {
        console.error('Account page error:', err.message);
        if (allAccounts.length === 0) throw err; // nothing fetched yet — surface the error
        break;
      }

      const elements = data.elements || [];
      if (elements.length === 0) break;

      for (const a of elements) {
        const id = a.id ? String(a.id) : (a.reference?.split(':').pop() ?? '');
        if (!id) continue;
        allAccounts.push({
          id:     parseInt(id),
          name:   a.name   || `Account ${id}`,
          status: a.status || 'UNKNOWN',
          type:   a.type   || 'UNKNOWN',
        });
      }

      // Read total from first page
      if (total === null && data.paging?.total != null) total = data.paging.total;

      // Stop conditions
      if (elements.length < PAGE) break;                     // last partial page
      if (total !== null && start + PAGE >= total) break;    // fetched everything
      start += PAGE;
    }

    // Deduplicate
    const seen   = new Set();
    const unique = allAccounts.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    unique.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(unique, {
      headers: { 'X-Total-Accounts': String(unique.length) },
    });
  } catch (error) {
    console.error('Accounts API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}