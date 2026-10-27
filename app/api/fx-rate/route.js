import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Simple in-memory cache (resets on cold start, which is fine — Frankfurter
// updates once a day anyway, and Vercel functions are short-lived).
let cache = { date: null, usdToZar: null, zarToUsd: null };

export async function GET() {
  const today = new Date().toISOString().split('T')[0];

  if (cache.date === today && cache.usdToZar) {
    return NextResponse.json({ usdToZar: cache.usdToZar, zarToUsd: cache.zarToUsd, date: cache.date, cached: true });
  }

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=ZAR', {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);
    const data = await res.json();
    const usdToZar = data.rates?.ZAR;
    if (!usdToZar) throw new Error('No ZAR rate in response');

    cache = { date: data.date || today, usdToZar, zarToUsd: 1 / usdToZar };
    return NextResponse.json({ usdToZar: cache.usdToZar, zarToUsd: cache.zarToUsd, date: cache.date, cached: false });
  } catch (err) {
    console.error('FX rate fetch failed:', err);
    return NextResponse.json({ error: 'FX rate unavailable' }, { status: 502 });
  }
}
