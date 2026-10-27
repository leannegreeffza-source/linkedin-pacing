// lib/pacingClient.js — client-side loader for the Pacing tab.
//
// LinkedIn: unchanged — one request to /api/pacing.
// Meta: Vercel Hobby cuts each request off at 60s and Meta rate-limits bursts, so one big request
// for 100+ accounts drops accounts or times out. Here the accounts are sent in small chunks
// (3 at a time), anything that fails is retried in smaller chunks, and the results are merged into
// the same shape the Pacing tab already expects. Accounts that still fail are listed in
// `failedAccounts` so the tab can say so instead of quietly under-reporting.

const ROUNDS = [
  { size: 25, conc: 3 },
  { size: 10, conc: 2 },
  { size:  5, conc: 2 },
  { size:  3, conc: 1 },
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) { const i = next++; if (i >= items.length) return; await fn(items[i]); }
  }));
}

async function postMeta(init, ids) {
  const base = JSON.parse(init.body || '{}');
  const r = await fetch('/api/meta/pacing', {
    method: 'POST',
    headers: init.headers || { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...base, accountIds: ids, resilient: true }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    const err = new Error(e.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function metaPacing(init) {
  const body = JSON.parse(init.body || '{}');
  const all = [...new Set((body.accountIds || []).map(String))];
  const accountTotals = new Map();
  const daily = new Map();
  const lastError = new Map();
  const permanent = new Map();
  let first = null, firstErr = null, anyOk = false;
  let pending = all;

  for (let round = 0; round < ROUNDS.length && pending.length; round++) {
    const { size, conc } = ROUNDS[round];
    const chunks = [];
    for (let i = 0; i < pending.length; i += size) chunks.push(pending.slice(i, i + size));
    const retry = [];
    await pool(chunks, conc, async (ids) => {
      try {
        const res = await postMeta(init, ids);
        anyOk = true;
        if (!first) first = res;
        const failedIds = new Set();
        for (const f of res.failedAccounts || []) {
          const id = String(f.accountId);
          failedIds.add(id);
          lastError.set(id, f.error || 'failed');
          if (f.retryable === false) permanent.set(id, f.error || 'failed'); else retry.push(id);
        }
        for (const t of res.accountTotals || []) if (!failedIds.has(String(t.accountId))) accountTotals.set(String(t.accountId), t);
        for (const d of res.dailyData || []) {
          const x = daily.get(d.date) || { date: d.date, spend: 0, impressions: 0, clicks: 0, leads: 0 };
          x.spend += d.spend || 0; x.impressions += d.impressions || 0; x.clicks += d.clicks || 0; x.leads += d.leads || 0;
          daily.set(d.date, x);
        }
        for (const id of ids) if (!accountTotals.has(id) && !failedIds.has(id)) { retry.push(id); lastError.set(id, 'no result returned'); }
      } catch (e) {
        if (!firstErr) firstErr = e;
        for (const id of ids) { retry.push(id); lastError.set(id, e.message || String(e)); }
      }
    });
    pending = retry;
    if (pending.length && round < ROUNDS.length - 1) await sleep(2000 * (round + 1));
  }

  if (!anyOk) {
    // Nothing worked at all (e.g. 401 not signed in) — behave like a failed request.
    const msg = firstErr ? firstErr.message : 'Request failed';
    return { ok: false, status: firstErr?.status || 502, json: async () => ({ error: msg }) };
  }

  const failedAccounts = [
    ...pending.map(id => ({ accountId: id, error: lastError.get(id) || 'gave up after retries' })),
    ...[...permanent].map(([accountId, error]) => ({ accountId, error })),
  ];
  const dailyData = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totals = [...accountTotals.values()];
  const sum = (k) => totals.reduce((s, t) => s + (t[k] || 0), 0);
  const merged = {
    summary: {
      totalSpend: sum('totalSpend'), todaySpend: sum('todaySpend'), yesterdaySpend: sum('yesterdaySpend'),
      totalImpressions: sum('totalImpressions'), totalClicks: sum('totalClicks'), totalLeads: sum('totalLeads'),
      totalDays: first?.summary?.totalDays ?? 1, daysElapsed: first?.summary?.daysElapsed ?? 1,
      startDate: body.startDate, endDate: body.endDate,
    },
    accountTotals: totals,
    dailyData,
    failedAccounts,
    partial: failedAccounts.length > 0,
    queried: all.length,
  };
  return { ok: true, status: 200, json: async () => merged };
}

// Drop-in replacement for fetch(`${apiPrefix}/pacing`, init).
export function pacingFetch(apiPrefix, init) {
  if (apiPrefix === '/api/meta') return metaPacing(init);
  return fetch(`${apiPrefix}/pacing`, init);
}
