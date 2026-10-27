'use client';

// ════════════════════════════════════════════════════════════════════════════
// MetaTab.js — Meta (Facebook/Instagram) spend report
//
// Mirrors the BOD2Tab layout/style (dark top bar, Run button, sticky totals,
// sub-tabs, Excel export, amber pulse when dates change), adapted for Meta:
//
//   • Pulls accounts from /api/meta/accounts (carries `currency` field, ZAR or USD)
//   • Pulls spend from /api/meta/pacing (returns native-currency totals per account)
//   • Splits accounts into three sub-tabs:
//        – USD Accounts  (currency === 'USD')           — spend in $
//        – ZAR Accounts  (currency === 'ZAR')           — spend in R
//        – Combined ZAR  (both, USD multiplied by FX)   — spend in R, with FX input
//   • Per-row: Total spend (date range), Yesterday, Today, DoD %, Flag (red if |DoD|>10%)
//   • Portfolio strip: same five metrics summed across the visible sub-tab
//     (with the same red flag if portfolio DoD > 10%)
//
// Currency is taken from Meta's account.currency field — automatic and live.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  RefreshCw, FileSpreadsheet, Play, Search, AlertTriangle, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';

const DEFAULT_FX = 17.30;       // matches your March 2026 recon FX
const FLAG_PCT   = 0.10;        // 10% DoD threshold

// ── Date helpers ─────────────────────────────────────────────────────────────
// Read the browser's LOCAL date parts. d.toISOString() converts to UTC first, which in SAST
// (UTC+2) rolls local midnight back to 22:00 the previous day, so "This Month" started a day
// early and "today" was wrong after midnight.
function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr()       { return toYMD(new Date()); }
function firstOfMonth()   { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 1)); }
function lastMonthStart() { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth()-1, 1)); }
function lastMonthEnd()   { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 0)); }

// ── Number formatters ────────────────────────────────────────────────────────
function fmtNum(v, dec=2) {
  if (v == null || v === '') return '0.00';
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? '0.00' : n.toLocaleString('en-ZA', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v, dec=1) {
  if (v == null || v === '' || !isFinite(v)) return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(dec) + '%';
}
// Day-on-day fluctuation. `null` if yesterday was 0 and today is also 0; Infinity if today > 0 and yesterday = 0.
function dod(today, yesterday) {
  const t = today || 0, y = yesterday || 0;
  if (y === 0 && t === 0) return null;
  if (y === 0)             return Infinity;
  return (t - y) / y;
}
function isFlagged(d) {
  if (d == null) return false;
  if (!isFinite(d)) return true;
  return Math.abs(d) > FLAG_PCT;
}

// ── Resilient loader ─────────────────────────────────────────────────────────
// Vercel Hobby cuts every function off at 60s, and Meta rate-limits bursts of calls. So accounts
// are requested in small, throttled chunks; any account that fails is retried in progressively
// smaller chunks, and whatever still fails is REPORTED — it is never silently shown as zero.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runPool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function postPacing(ids, startDate, endDate) {
  const r = await fetch('/api/meta/pacing', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ accountIds: ids, startDate, endDate, resilient: true }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// Round 1 is the main pass; later rounds only re-ask for accounts that failed, in smaller chunks.
const RETRY_ROUNDS = [
  { size: 25, conc: 3 },
  { size: 10, conc: 2 },
  { size:  5, conc: 2 },
  { size:  3, conc: 1 },
];

// Returns { totals: Map(accountId → {totalSpend,todaySpend,yesterdaySpend}), failed: [{accountId, error}] }
async function fetchTotalsResilient(accountIds, { startDate, endDate, onProgress } = {}) {
  const totals    = new Map();
  const lastError = new Map();
  const permanent = new Map();   // errors that retrying cannot fix (permissions, bad token…)
  let pending = [...new Set(accountIds.map(String))];
  const total = pending.length;

  for (let round = 0; round < RETRY_ROUNDS.length && pending.length; round++) {
    const { size, conc } = RETRY_ROUNDS[round];
    const retry = [];
    await runPool(chunkArray(pending, size), conc, async (ids) => {
      try {
        const res = await postPacing(ids, startDate, endDate);
        const failedIds = new Set();
        for (const f of res.failedAccounts || []) {
          const id = String(f.accountId);
          failedIds.add(id);
          lastError.set(id, f.error || 'failed');
          if (f.retryable === false) permanent.set(id, f.error || 'failed'); else retry.push(id);
        }
        for (const tot of res.accountTotals || []) {
          const id = String(tot.accountId);
          if (!failedIds.has(id)) totals.set(id, tot);
        }
        // Defensive: an account we asked for that came back as neither a result nor a failure
        // must not vanish — treat it as failed and try again.
        for (const id of ids) {
          if (!totals.has(id) && !failedIds.has(id)) { retry.push(id); lastError.set(id, 'no result returned'); }
        }
      } catch (e) {
        // Whole request failed (timeout, network, 5xx) — retry its accounts in smaller chunks.
        for (const id of ids) { retry.push(id); lastError.set(id, e.message || String(e)); }
      }
      if (onProgress) onProgress({ done: totals.size + permanent.size, total, round });
    });
    pending = retry;
    if (pending.length && round < RETRY_ROUNDS.length - 1) await sleep(2000 * (round + 1));
  }

  const failed = [
    ...pending.map(id => ({ accountId: id, error: lastError.get(id) || 'gave up after retries' })),
    ...[...permanent].map(([id, error]) => ({ accountId: id, error })),
  ];
  return { totals, failed };
}

// ── SheetJS loader (Excel export) ────────────────────────────────────────────
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ── Pacing (same logic as the LinkedIn Pacing tab, per currency) ─────────────
// Budgets are kept per calendar month and per currency in localStorage — USD and ZAR are paced
// separately, never converted.
function metaBudgetKey(y, m) { return `meta_pacing_budget_${y}_${String(m).padStart(2, '0')}`; }
function loadMetaBudget(y, m) {
  try { const raw = localStorage.getItem(metaBudgetKey(y, m)); if (raw) return JSON.parse(raw); } catch {}
  return { USD: '', ZAR: '' };
}
function saveMetaBudget(y, m, data) { try { localStorage.setItem(metaBudgetKey(y, m), JSON.stringify(data)); } catch {} }

function getPacingStatus(actual, ideal) {
  if (!ideal) return { label: 'No Target Set', cls: 'text-slate-400' };
  const ratio = actual / ideal;
  if (ratio >= 0.9 && ratio <= 1.1) return { label: 'On Track',     cls: 'text-emerald-400' };
  if (ratio < 0.9)                  return { label: 'Under Pacing', cls: 'text-yellow-400' };
  return                                   { label: 'Over Pacing',  cls: 'text-emerald-400' }; // over is good, as on LinkedIn
}

function daysInclusive(a, b) {
  return Math.max(1, Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000) + 1);
}

// Sum every account's daily series into one [{date, spend}] list.
function sumDaily(rowsOrTotals) {
  const m = new Map();
  for (const r of rowsOrTotals) for (const d of (r.daily || [])) m.set(d.date, (m.get(d.date) || 0) + d.spend);
  return Array.from(m, ([date, spend]) => ({ date, spend })).sort((a, b) => a.date.localeCompare(b.date));
}

function computePacing({ daily, startDate, endDate, budget, lastMonthDaily }) {
  const today = todayStr();
  const [by, bm] = startDate.split('-').map(Number);
  const daysInMonth = new Date(by, bm, 0).getDate();
  const now = new Date();
  const isCurrentMonth = by === now.getFullYear() && bm === now.getMonth() + 1;
  const todayDate = now.getDate();
  const daysRemaining = isCurrentMonth ? Math.max(0, daysInMonth - todayDate) : 0;

  const clampedEnd  = endDate > today ? today : endDate;
  const daysElapsed = daysInclusive(startDate, clampedEnd < startDate ? startDate : clampedEnd);
  const yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return toYMD(d); })();

  const totalSpend     = daily.reduce((s, d) => s + d.spend, 0);
  const todaySpend     = daily.find(d => d.date === today)?.spend || 0;
  const yesterdaySpend = daily.find(d => d.date === yest)?.spend  || 0;

  const completed   = daily.filter(d => d.date < today);
  const last5       = completed.slice(-5);
  const fiveDayAvg  = last5.length ? last5.reduce((s, d) => s + d.spend, 0) / last5.length : 0;

  // Ideal daily = 5-day average if there is one, else budget ÷ days in month
  const idealDaily  = fiveDayAvg > 0 ? fiveDayAvg : budget > 0 ? budget / daysInMonth : 0;
  const idealToDate = idealDaily * daysElapsed;
  const status      = getPacingStatus(totalSpend, idealToDate);
  const pacingPct   = idealToDate > 0 ? (totalSpend / idealToDate) * 100 : 0;

  const remaining   = budget > 0 ? Math.max(0, budget - totalSpend) : 0;
  const spendToYest = Math.max(0, totalSpend - todaySpend);
  const avgDaily    = spendToYest > 0 ? spendToYest / Math.max(1, daysElapsed - 1) : todaySpend;
  const projected   = isCurrentMonth ? avgDaily * daysInMonth : totalSpend;
  const neededDaily = daysRemaining > 0 ? remaining / daysRemaining : 0;
  const usedPct     = budget > 0 ? Math.min((totalSpend / budget) * 100, 100) : 0;

  // Day-by-day: latest completed day vs the 5-day average
  const latestDay   = last5.length ? last5[last5.length - 1].spend : yesterdaySpend;
  const dayAvg      = last5.length ? fiveDayAvg : avgDaily;
  const dayPct      = dayAvg > 0 ? (latestDay / dayAvg) * 100 : 100;
  const dayTrend    = dayPct >= 95 && dayPct <= 105 ? 'Steady' : dayPct > 105 ? 'Trending Up' : 'Trending Down';

  // Trend mode: same number of days of last month
  const lm          = [...(lastMonthDaily || [])].sort((a, b) => a.date.localeCompare(b.date));
  const lastTotal   = lm.reduce((s, d) => s + d.spend, 0);
  const samePeriod  = lm.slice(0, daysElapsed).reduce((s, d) => s + d.spend, 0);
  const trendPct    = samePeriod > 0 ? (totalSpend / samePeriod) * 100 : 0;
  const trend = samePeriod === 0 ? { label: 'No Prior Data', cls: 'text-slate-400' }
    : trendPct >= 95 && trendPct <= 105 ? { label: 'On Par', cls: 'text-emerald-400' }
    : trendPct > 105 ? { label: 'Ahead of Last Month', cls: 'text-blue-400' }
    : { label: 'Behind Last Month', cls: 'text-yellow-400' };
  const projVsLast = lastTotal > 0 ? ((projected - lastTotal) / lastTotal) * 100 : 0;

  return { by, bm, daysInMonth, daysElapsed, isCurrentMonth, daysRemaining, totalSpend, todaySpend, yesterdaySpend,
           idealDaily, idealToDate, status, pacingPct, remaining, avgDaily, projected, neededDaily, usedPct,
           latestDay, dayAvg, dayPct, dayTrend, lastTotal, samePeriod, trendPct, trend, projVsLast };
}

function PacingPanel({ currency, rows, startDate, endDate, lastMonthDaily, lastMonthLoading, onLoadLastMonth }) {
  const sym = currency === 'USD' ? '$' : 'R';
  const [by, bm] = startDate.split('-').map(Number);
  const [budgets, setBudgets] = useState({ USD: '', ZAR: '' });
  const [mode, setMode]       = useState('target');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  useEffect(() => { setBudgets(loadMetaBudget(by, bm)); }, [by, bm]);

  const budget = parseFloat(budgets[currency]) || 0;
  const daily  = sumDaily(rows);
  const p      = computePacing({ daily, startDate, endDate, budget, lastMonthDaily });
  const money  = (v) => `${sym}${fmtNum(v, 2)}`;
  const monthLabel = new Date(by, bm - 1, 1).toLocaleString('en-ZA', { month: 'long', year: 'numeric' });

  function saveDraft() {
    const next = { ...budgets, [currency]: draft };
    setBudgets(next); saveMetaBudget(by, bm, next); setEditing(false);
  }

  const card = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 min-w-0';
  const lbl  = 'text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1';

  return (
    <div className="px-4 py-3 border-b border-slate-700 bg-slate-900/40 shrink-0">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <span className="text-xs font-bold text-white uppercase tracking-wide">Pacing · {currency} · {monthLabel}</span>
        <div className="flex gap-1">
          <button onClick={() => setMode('target')}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold ${mode === 'target' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            vs Target
          </button>
          <button onClick={() => { setMode('trend'); if (!lastMonthDaily && !lastMonthLoading) onLoadLastMonth(); }}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold ${mode === 'trend' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            vs Last Month
          </button>
        </div>
        {mode === 'trend' && lastMonthLoading && <span className="text-[11px] text-purple-300">Loading last month…</span>}
        <span className="text-[11px] text-slate-500">
          Day {p.daysElapsed} of {p.daysInMonth} · spend in the selected range · native {currency}, not converted
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {mode === 'target' ? (<>
          <div className={card}>
            <div className={lbl}>Target ({currency})</div>
            {editing ? (
              <div className="flex gap-1">
                <input autoFocus type="number" value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveDraft(); if (e.key === 'Escape') setEditing(false); }}
                  className="w-full px-2 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs text-white" />
                <button onClick={saveDraft} className="px-2 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-bold">Save</button>
              </div>
            ) : (<>
              <div className="text-lg font-bold text-white">{budget > 0 ? money(budget) : '—'}</div>
              <button onClick={() => { setDraft(budget > 0 ? String(budget) : ''); setEditing(true); }}
                className="text-[11px] text-blue-400 hover:text-blue-300">{budget > 0 ? 'Edit target' : 'Set target'}</button>
            </>)}
          </div>

          <div className={card}>
            <div className={lbl}>Spend to date</div>
            <div className="text-lg font-bold text-white">{money(p.totalSpend)}</div>
            {budget > 0 ? (<>
              <div className="h-1.5 bg-slate-700 rounded mt-1"><div className="h-1.5 bg-blue-500 rounded" style={{ width: `${p.usedPct}%` }} /></div>
              <div className="text-[11px] text-slate-400 mt-0.5">{p.usedPct.toFixed(1)}% of target</div>
            </>) : <div className="text-[11px] text-slate-500">No target set</div>}
          </div>

          <div className={card}>
            <div className={lbl}>Pacing status</div>
            <div className={`text-lg font-bold ${p.status.cls}`}>{p.status.label}</div>
            <div className="text-[11px] text-slate-400">
              {p.idealToDate > 0 ? `${p.pacingPct.toFixed(1)}% of ideal ${money(p.idealToDate)}` : 'Needs spend history or a target'}
            </div>
          </div>

          <div className={card}>
            <div className={lbl}>Month-end forecast</div>
            <div className={`text-lg font-bold ${
              budget > 0 && p.projected > budget * 1.05 ? 'text-red-400'
              : budget > 0 && p.projected < budget * 0.9 ? 'text-yellow-400' : 'text-emerald-400'}`}>{money(p.projected)}</div>
            <div className="text-[11px] text-slate-400">Avg {money(p.avgDaily)}/day × {p.daysInMonth} days</div>
          </div>

          <div className={card}>
            <div className={lbl}>Needed per day</div>
            <div className="text-lg font-bold text-white">{budget > 0 && p.daysRemaining > 0 ? money(p.neededDaily) : '—'}</div>
            <div className="text-[11px] text-slate-400">
              {budget > 0 ? `${money(p.remaining)} left · ${p.daysRemaining} days to go` : 'Set a target to see this'}
            </div>
          </div>
        </>) : (<>
          <div className={card}>
            <div className={lbl}>This period</div>
            <div className="text-lg font-bold text-white">{money(p.totalSpend)}</div>
            <div className="text-[11px] text-slate-400">{p.daysElapsed} days</div>
          </div>
          <div className={card}>
            <div className={lbl}>Same days last month</div>
            <div className="text-lg font-bold text-white">{lastMonthDaily ? money(p.samePeriod) : '…'}</div>
            <div className="text-[11px] text-slate-400">Full month {lastMonthDaily ? money(p.lastTotal) : '…'}</div>
          </div>
          <div className={card}>
            <div className={lbl}>Trend</div>
            <div className={`text-lg font-bold ${p.trend.cls}`}>{p.trend.label}</div>
            <div className="text-[11px] text-slate-400">
              {p.samePeriod > 0 ? `${p.trendPct.toFixed(1)}% of last month (${p.totalSpend - p.samePeriod >= 0 ? '+' : '−'}${money(Math.abs(p.totalSpend - p.samePeriod))})` : '—'}
            </div>
          </div>
          <div className={card}>
            <div className={lbl}>Projected month</div>
            <div className="text-lg font-bold text-white">{money(p.projected)}</div>
            <div className="text-[11px] text-slate-400">{p.lastTotal > 0 ? `${p.projVsLast >= 0 ? '+' : ''}${p.projVsLast.toFixed(1)}% vs last month` : '—'}</div>
          </div>
          <div className={card}>
            <div className={lbl}>Avg per day</div>
            <div className="text-lg font-bold text-white">{money(p.avgDaily)}</div>
            <div className="text-[11px] text-slate-400">Up to yesterday</div>
          </div>
        </>)}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className={card}>
          <div className={lbl}>Day-by-day pacing</div>
          <div className={`text-sm font-bold ${p.dayTrend === 'Steady' ? 'text-emerald-400' : p.dayTrend === 'Trending Up' ? 'text-blue-400' : 'text-yellow-400'}`}>{p.dayTrend}</div>
          <div className="text-[11px] text-slate-400">Latest full day {money(p.latestDay)} vs 5-day avg {money(p.dayAvg)} ({p.dayPct.toFixed(0)}%)</div>
        </div>
        <div className={card}>
          <div className={lbl}>Today vs yesterday</div>
          <div className="text-sm font-bold text-white">{money(p.todaySpend)} <span className="text-slate-500 font-normal">vs</span> {money(p.yesterdaySpend)}</div>
          <div className="text-[11px] text-slate-400">Today is part-day, so it will usually read lower</div>
        </div>
      </div>
    </div>
  );
}

export default function MetaTab() {
  const { data: session } = useSession();

  // ── Accounts (with currency) ──────────────────────────────────────────────
  const [allAccounts, setAllAccounts] = useState([]); // [{id, metaId, name, currency, timezone}]
  const [loadingAccs, setLoadingAccs] = useState(false);
  const [accountsError, setAccountsError] = useState('');

  // ── Dates ─────────────────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate,   setEndDate]   = useState(todayStr());

  // ── Data ──────────────────────────────────────────────────────────────────
  // rows are unified: { accountId, name, currency, totalSpend, todaySpend, yesterdaySpend }
  // — spend values are in the account's NATIVE currency. The combined view
  // applies FX to USD rows to express everything in ZAR.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ pct: 0, message: '' });
  const [hasRun, setHasRun] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [ranDates, setRanDates] = useState({ start: '', end: '' });

  // ── Sub-tabs & FX ─────────────────────────────────────────────────────────
  const TABS = ['USD Accounts', 'ZAR Accounts', 'Combined (ZAR)'];
  const [activeTab, setActiveTab] = useState('Combined (ZAR)');
  const [fxRate, setFxRate] = useState(DEFAULT_FX);

  // ── Search ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  // ── Coverage / diagnostics ────────────────────────────────────────────────
  const [tokenType, setTokenType]   = useState('');   // 'system_user' | 'facebook_session'
  const [coverage, setCoverage]     = useState(null); // { queried, loaded, failed[], skippedCurrency }
  const [showFailed, setShowFailed] = useState(false);
  const [retrying, setRetrying]     = useState(false);

  // Last month's daily spend per currency, loaded on demand for the "vs Last Month" pacing mode
  const [lastMonthDaily, setLastMonthDaily]     = useState(null);   // { USD: [...], ZAR: [...], key }
  const [lastMonthLoading, setLastMonthLoading] = useState(false);

  const datesChanged = hasRun && (ranDates.start !== startDate || ranDates.end !== endDate);

  // ── Fetch all Meta accounts on mount ─────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    setLoadingAccs(true);
    setAccountsError('');
    fetch('/api/meta/accounts')
      .then(async r => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        setTokenType(r.headers.get('x-meta-token-type') || '');
        return r.json();
      })
      .then(d => {
        setAllAccounts(Array.isArray(d) ? d : []);
        setLoadingAccs(false);
      })
      .catch(err => {
        setAccountsError(err.message || 'Failed to load accounts');
        setLoadingAccs(false);
      });
  }, [session]);

  // ── Run Report ────────────────────────────────────────────────────────────
  // Queries every USD/ZAR account through fetchTotalsResilient (throttled chunks, automatic
  // retries). Accounts that still fail are listed in the amber banner instead of silently
  // showing as zero spend. Spend values stay in each account's native currency.
  function buildRow(a, tot) {
    return {
      accountId:      String(a.id),
      name:           a.name || `Account ${a.id}`,
      currency:       (a.currency || '').toUpperCase(),
      bm:             a.bm || '',
      daily:          tot.daily || [],
      totalSpend:     tot.totalSpend     || 0,
      todaySpend:     tot.todaySpend     || 0,
      yesterdaySpend: tot.yesterdaySpend || 0,
    };
  }
  const hasSpend = (r) => r.totalSpend > 0 || r.todaySpend > 0 || r.yesterdaySpend > 0;
  const bySpend  = (a, b) => b.totalSpend - a.totalSpend;

  function describeFailed(failed, accById) {
    return failed.map(f => {
      const a = accById.get(String(f.accountId)) || {};
      return { accountId: String(f.accountId), name: a.name || '', currency: a.currency || '', bm: a.bm || '', error: f.error };
    });
  }

  async function runReport() {
    if (!allAccounts.length) {
      setError('Account list not loaded yet — wait a moment, then try again.');
      return;
    }

    const queried = allAccounts.filter(a => ['USD', 'ZAR'].includes((a.currency || '').toUpperCase()));
    const skippedCurrency = allAccounts.length - queried.length;

    if (queried.length === 0) {
      setError('No accounts with USD or ZAR currency. Found currencies: ' +
        [...new Set(allAccounts.map(a => a.currency))].join(', '));
      return;
    }

    setLoading(true); setError(''); setHasRun(true); setCoverage(null); setShowFailed(false);
    setProgress({ pct: 3, message: `Querying ${queried.length} accounts…` });

    try {
      const { totals, failed } = await fetchTotalsResilient(queried.map(a => a.id), {
        startDate, endDate,
        onProgress: ({ done, total, round }) => setProgress({
          pct: 5 + Math.round(85 * done / Math.max(1, total)),
          message: round === 0
            ? `Loaded ${done} of ${total} accounts…`
            : `Retrying accounts that failed (pass ${round + 1}) — ${done} of ${total} loaded…`,
        }),
      });
      setProgress({ pct: 92, message: 'Merging results…' });

      const accById = new Map(queried.map(a => [String(a.id), a]));
      const merged = [];
      for (const [id, tot] of totals) {
        const a = accById.get(id);
        if (!a) continue;
        const row = buildRow(a, tot);
        if (hasSpend(row)) merged.push(row);
      }
      merged.sort(bySpend);

      setRows(merged);
      setRanDates({ start: startDate, end: endDate });
      setCoverage({ queried: queried.length, loaded: totals.size, failed: describeFailed(failed, accById), skippedCurrency });
      setLastRefresh(new Date());
      setProgress({
        pct: 100,
        message: `${failed.length ? '⚠' : '✓'} ${merged.length} accounts with spend · ${totals.size} of ${queried.length} accounts loaded` +
                 (failed.length ? ` · ${failed.length} failed` : ''),
      });
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  }

  // Re-ask only for the accounts that failed, for the same dates as the table, and merge in.
  async function retryFailed() {
    if (!coverage || !coverage.failed.length) return;
    setRetrying(true); setError('');
    try {
      const ids = coverage.failed.map(f => f.accountId);
      const { totals, failed } = await fetchTotalsResilient(ids, {
        startDate: ranDates.start, endDate: ranDates.end,
        onProgress: ({ done, total }) => setProgress({ pct: 50, message: `Retrying failed accounts — ${done} of ${total} loaded…` }),
      });
      const accById = new Map(allAccounts.map(a => [String(a.id), a]));
      const added = [];
      for (const [id, tot] of totals) {
        const a = accById.get(id);
        if (!a) continue;
        const row = buildRow(a, tot);
        if (hasSpend(row)) added.push(row);
      }
      setRows(prev => [...prev.filter(r => !totals.has(r.accountId)), ...added].sort(bySpend));
      setCoverage(c => ({ ...c, loaded: c.loaded + totals.size, failed: describeFailed(failed, accById) }));
      setProgress({
        pct: 100,
        message: failed.length ? `⚠ ${failed.length} accounts still failing` : '✓ All accounts loaded',
      });
    } catch (e) {
      setError(e.message || String(e));
    }
    setRetrying(false);
  }

  // Previous calendar month (relative to the start date), for "vs Last Month" pacing.
  async function loadLastMonth() {
    const [y, m] = startDate.split('-').map(Number);
    const ps = toYMD(new Date(y, m - 2, 1));
    const pe = toYMD(new Date(y, m - 1, 0));
    const key = `${ps}_${pe}`;
    if (lastMonthDaily?.key === key || lastMonthLoading) return;
    const queried = allAccounts.filter(a => ['USD', 'ZAR'].includes((a.currency || '').toUpperCase()));
    if (!queried.length) return;
    setLastMonthLoading(true);
    try {
      const { totals } = await fetchTotalsResilient(queried.map(a => a.id), { startDate: ps, endDate: pe });
      const cur = new Map(queried.map(a => [String(a.id), (a.currency || '').toUpperCase()]));
      const by = { USD: [], ZAR: [] };
      for (const [id, tot] of totals) { const c = cur.get(id); if (by[c]) by[c].push(tot); }
      setLastMonthDaily({ key, USD: sumDaily(by.USD), ZAR: sumDaily(by.ZAR) });
    } catch (e) { setError(e.message || String(e)); }
    setLastMonthLoading(false);
  }

  // ── View rows: filter by sub-tab, then by search, then convert if Combined ──
  // For Combined (ZAR): USD rows are converted to ZAR with `fxRate`,
  // ZAR rows pass through. Currency column shows the source.
  const fx = Number(fxRate) || DEFAULT_FX;
  function projectRow(r) {
    if (activeTab !== 'Combined (ZAR)') return { ...r, dispCurrency: r.currency };
    if (r.currency === 'USD') {
      return {
        ...r,
        dispCurrency:   'ZAR',
        totalSpend:     r.totalSpend     * fx,
        todaySpend:     r.todaySpend     * fx,
        yesterdaySpend: r.yesterdaySpend * fx,
        _sourceUSD:     true,
        _origTotal:     r.totalSpend,
      };
    }
    return { ...r, dispCurrency: 'ZAR' };
  }

  const tabRows = (() => {
    if (activeTab === 'USD Accounts') return rows.filter(r => r.currency === 'USD');
    if (activeTab === 'ZAR Accounts') return rows.filter(r => r.currency === 'ZAR');
    return rows; // Combined
  })().map(projectRow);

  const searchedRows = search
    ? tabRows.filter(r => {
        const s = search.toLowerCase();
        return (r.accountId && r.accountId.toLowerCase().includes(s)) ||
               (r.name      && r.name.toLowerCase().includes(s));
      })
    : tabRows;

  // Per-row DoD + flag
  const computed = searchedRows.map(r => {
    const d = dod(r.todaySpend, r.yesterdaySpend);
    return { ...r, dod: d, flagged: isFlagged(d) };
  });

  // Portfolio totals across the visible sub-tab
  const totals = computed.reduce((t, r) => ({
    total:     t.total     + (r.totalSpend     || 0),
    today:     t.today     + (r.todaySpend     || 0),
    yesterday: t.yesterday + (r.yesterdaySpend || 0),
  }), { total: 0, today: 0, yesterday: 0 });
  const portfolioDod     = dod(totals.today, totals.yesterday);
  const portfolioFlagged = isFlagged(portfolioDod);
  const flaggedCount     = computed.filter(r => r.flagged).length;

  const tabSymbol = activeTab === 'USD Accounts' ? '$' : 'R';

  // Tab counts
  const tabCounts = {
    'USD Accounts':    rows.filter(r => r.currency === 'USD').length,
    'ZAR Accounts':    rows.filter(r => r.currency === 'ZAR').length,
    'Combined (ZAR)':  rows.length,
  };

  // Accounts listed per Business Manager (header tooltip) — shows at a glance whether a whole BM is missing
  const bmSummary = (() => {
    const m = new Map();
    allAccounts.forEach(a => { const k = a.bm || '(unknown)'; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}: ${v}`).join('\n');
  })();

  // ── Excel export ──────────────────────────────────────────────────────────
  async function exportToExcel() {
    const XLSX = await loadXLSX();
    const header = ['Account ID', 'Account Name', 'Currency', `Total (${activeTab === 'USD Accounts' ? 'USD' : 'ZAR'})`,
                    'Yesterday', 'Today', 'DoD %', 'Flagged', 'Business Manager'];
    const data = [header];
    computed.forEach(r => {
      data.push([
        r.accountId,
        r.name,
        r._sourceUSD ? `USD→ZAR @${fx}` : r.dispCurrency,
        r.totalSpend,
        r.yesterdaySpend,
        r.todaySpend,
        r.dod == null ? '' : (isFinite(r.dod) ? r.dod : 'new spend'),
        r.flagged ? 'YES' : '',
        r.bm || '',
      ]);
    });
    data.push([]);
    data.push(['TOTAL', '', '',
      totals.total, totals.yesterday, totals.today,
      portfolioDod == null ? '' : (isFinite(portfolioDod) ? portfolioDod : 'new spend'),
      portfolioFlagged ? 'YES' : '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{wch:20},{wch:40},{wch:14},{wch:16},{wch:14},{wch:14},{wch:12},{wch:10},{wch:34}];
    // Number formats
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 1; R <= range.e.r; R++) {
      ['D','E','F'].forEach(col => {
        const a = `${col}${R+1}`;
        if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '#,##0.00';
      });
      const g = `G${R+1}`;
      if (ws[g] && typeof ws[g].v === 'number') ws[g].z = '0.0%';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Meta ${activeTab.slice(0,20)}`);

    // Coverage sheets — so a reconciliation can tell "no spend" apart from "not loaded".
    if (coverage) {
      const bmStats = new Map();
      const bump = (bm, k) => {
        const key = bm || '(unknown)';
        const s = bmStats.get(key) || { listed: 0, withSpend: 0, failed: 0 };
        s[k]++; bmStats.set(key, s);
      };
      allAccounts.forEach(a => bump(a.bm, 'listed'));
      rows.forEach(r => bump(r.bm, 'withSpend'));
      coverage.failed.forEach(f => bump(f.bm, 'failed'));
      const covData = [['Business Manager', 'Accounts listed', 'With spend in range', 'Failed to load']];
      [...bmStats.entries()].sort((x, y) => y[1].listed - x[1].listed)
        .forEach(([bm, s]) => covData.push([bm, s.listed, s.withSpend, s.failed]));
      const wsCov = XLSX.utils.aoa_to_sheet(covData);
      wsCov['!cols'] = [{wch:44},{wch:16},{wch:20},{wch:16}];
      XLSX.utils.book_append_sheet(wb, wsCov, 'Coverage by BM');

      if (coverage.failed.length) {
        const failData = [['Account ID', 'Account Name', 'Currency', 'Business Manager', 'Error']];
        coverage.failed.forEach(f => failData.push([f.accountId, f.name, f.currency, f.bm, f.error]));
        const wsFail = XLSX.utils.aoa_to_sheet(failData);
        wsFail['!cols'] = [{wch:20},{wch:40},{wch:10},{wch:30},{wch:80}];
        XLSX.utils.book_append_sheet(wb, wsFail, 'Not loaded');
      }
    }
    const tag = activeTab.replace(/[^a-z0-9]/gi, '-');
    XLSX.writeFile(wb, `Meta_${tag}_${startDate}_to_${endDate}.xlsx`);
  }

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* ══ TOP BAR ══ */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center gap-3 flex-wrap shrink-0">

        {/* Account count */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium shrink-0">Meta Accounts</span>
          <span className="text-xs text-slate-500">
            {loadingAccs ? (
              <span className="text-amber-400">loading…</span>
            ) : accountsError ? (
              <span className="text-red-400">{accountsError}</span>
            ) : (
              <>
                <span className="text-white font-bold">{allAccounts.length.toLocaleString()}</span> total
                <> · <span className="text-blue-300 font-bold">{allAccounts.filter(a => a.currency === 'USD').length}</span> USD</>
                <> · <span className="text-emerald-300 font-bold">{allAccounts.filter(a => a.currency === 'ZAR').length}</span> ZAR</>
              </>
            )}
          </span>
          {!loadingAccs && !accountsError && tokenType && (
            <span title={`Accounts by Business Manager:\n${bmSummary}`}
              className={`text-[10px] px-1.5 py-0.5 rounded border cursor-help ${
                tokenType === 'system_user' ? 'border-slate-600 text-slate-400' : 'border-purple-500 text-purple-300'
              }`}>
              {tokenType === 'system_user' ? 'via System User' : 'via Facebook sign-in'}
            </span>
          )}
        </div>

        <div className="w-px h-5 bg-slate-600" />

        {/* Date pickers */}
        <span className="text-xs text-slate-400 font-medium">From</span>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
        <span className="text-xs text-slate-400 font-medium">To</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />

        {/* Quick date ranges */}
        {[
          { label: 'This Month', fn: () => { setStartDate(firstOfMonth()); setEndDate(todayStr()); } },
          { label: 'Last Month', fn: () => { setStartDate(lastMonthStart()); setEndDate(lastMonthEnd()); } },
        ].map(q => (
          <button key={q.label} onClick={q.fn}
            className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg border border-slate-600 transition-colors">
            {q.label}
          </button>
        ))}

        {/* Run button */}
        <button onClick={runReport} disabled={loading || loadingAccs || !allAccounts.length}
          className={`flex items-center gap-2 px-4 py-1.5 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors ${
            datesChanged ? 'bg-amber-600 hover:bg-amber-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-500'
          }`}>
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {loading ? 'Running…' : datesChanged ? 'Re-run Report' : 'Run Report'}
        </button>

        <div className="flex-1" />

        {/* FX rate input — only shown / relevant on Combined tab */}
        {activeTab === 'Combined (ZAR)' && (
          <div className="flex items-center gap-1.5 bg-slate-700/60 border border-slate-600 rounded-lg px-2.5 py-1">
            <span className="text-xs text-slate-400">FX</span>
            <span className="text-xs text-slate-500">$1 =</span>
            <input type="number" step="0.01" value={fxRate}
              onChange={e => setFxRate(e.target.value)}
              className="w-16 bg-transparent text-emerald-300 text-xs font-bold focus:outline-none" />
            <span className="text-xs text-slate-400">R</span>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ID or name…"
            className="pl-7 pr-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white w-48 focus:outline-none focus:border-blue-500" />
        </div>

        {/* Export */}
        <button disabled={computed.length === 0} onClick={exportToExcel}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
        </button>
      </div>

      {/* ══ PROGRESS / ERROR ══ */}
      {(loading || (hasRun && progress.message)) && (
        <div className="bg-slate-800/80 border-b border-slate-700 px-4 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(2, progress.pct)}%` }} />
            </div>
            <span className="text-xs text-slate-400 shrink-0 max-w-md truncate">{progress.message}</span>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-900/40 border-b border-red-700 px-4 py-2 text-xs text-red-200 shrink-0 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {coverage && (coverage.failed.length > 0 || coverage.skippedCurrency > 0) && (
        <div className="bg-amber-900/30 border-b border-amber-700 px-4 py-2 text-xs text-amber-100 shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            {coverage.failed.length > 0 && (
              <span>
                <b>{coverage.failed.length}</b> of {coverage.queried} accounts could not be loaded — totals below are understated.
              </span>
            )}
            {coverage.skippedCurrency > 0 && (
              <span>{coverage.skippedCurrency} account(s) in a currency other than USD/ZAR were not queried.</span>
            )}
            {coverage.failed.length > 0 && (
              <>
                <button onClick={retryFailed} disabled={retrying || loading}
                  className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 rounded font-bold text-white">
                  {retrying ? 'Retrying…' : 'Retry failed'}
                </button>
                <button onClick={() => setShowFailed(s => !s)} className="underline text-amber-300 hover:text-amber-200">
                  {showFailed ? 'Hide details' : 'Show details'}
                </button>
              </>
            )}
          </div>
          {showFailed && coverage.failed.length > 0 && (
            <div className="mt-2 max-h-44 overflow-auto border border-amber-800/60 rounded">
              <table className="w-full text-[11px]">
                <thead className="bg-amber-950/60 text-amber-300 text-left sticky top-0">
                  <tr>
                    <th className="px-2 py-1 font-semibold">Account</th>
                    <th className="px-2 py-1 font-semibold">ID</th>
                    <th className="px-2 py-1 font-semibold">Business Manager</th>
                    <th className="px-2 py-1 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.failed.map(f => (
                    <tr key={f.accountId} className="border-t border-amber-900/40">
                      <td className="px-2 py-1 text-amber-50">{f.name || '—'}</td>
                      <td className="px-2 py-1 font-mono text-amber-200/80">{f.accountId}</td>
                      <td className="px-2 py-1 text-amber-200/80">{f.bm || '—'}</td>
                      <td className="px-2 py-1 text-amber-100">{f.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══ PORTFOLIO TOTALS STRIP ══ */}
      {computed.length > 0 && (
        <div className={`border-b border-slate-700 px-4 py-2 flex items-center gap-5 flex-wrap shrink-0 transition-colors ${
          portfolioFlagged ? 'bg-red-950/60' : 'bg-slate-800/50'
        }`}>
          <span className="text-xs text-slate-500">{computed.length} accounts</span>

          <span className="text-xs">
            <span className="text-slate-500">Total </span>
            <span className="text-white font-bold">{tabSymbol}{fmtNum(totals.total)}</span>
          </span>

          <span className="text-xs">
            <span className="text-slate-500">Yesterday </span>
            <span className="text-slate-200 font-bold">{tabSymbol}{fmtNum(totals.yesterday)}</span>
          </span>

          <span className="text-xs">
            <span className="text-slate-500">Today </span>
            <span className="text-slate-200 font-bold">{tabSymbol}{fmtNum(totals.today)}</span>
          </span>

          <span className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded ${
            portfolioFlagged ? 'bg-red-700 text-white' : 'text-slate-300'
          }`}>
            <span className="text-slate-500">DoD </span>
            {portfolioDod == null ? <Minus className="w-3 h-3" />
              : portfolioDod >= 0 ? <TrendingUp className="w-3 h-3" />
              : <TrendingDown className="w-3 h-3" />}
            <span className="font-bold">{isFinite(portfolioDod) ? fmtPct(portfolioDod) : 'new'}</span>
            {portfolioFlagged && <AlertTriangle className="w-3 h-3 ml-0.5" />}
          </span>

          {flaggedCount > 0 && (
            <span className="text-xs flex items-center gap-1 text-red-300">
              <AlertTriangle className="w-3 h-3" />
              <span className="font-bold">{flaggedCount}</span> account{flaggedCount === 1 ? '' : 's'} flagged
            </span>
          )}

          {lastRefresh && <span className="text-xs text-slate-600 ml-auto">Updated {lastRefresh.toLocaleTimeString()}</span>}
        </div>
      )}

      {/* ══ SUB-TABS ══ */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-4 py-1.5 flex items-center gap-1.5 shrink-0">
        {TABS.map(tab => {
          const isActive = activeTab === tab;
          const accent =
            tab === 'USD Accounts'   ? 'bg-blue-600 text-white' :
            tab === 'ZAR Accounts'   ? 'bg-emerald-600 text-white' :
                                       'bg-purple-600 text-white';
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                isActive ? accent : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}>
              {tab}
              {tabCounts[tab] > 0 && (
                <span className={`text-xs rounded-full px-1.5 ${isActive ? 'bg-white/20' : 'bg-slate-700'}`}>
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══ PACING (per currency) ══ */}
      {hasRun && rows.length > 0 && (activeTab === 'Combined (ZAR)' ? ['USD', 'ZAR'] : [activeTab === 'USD Accounts' ? 'USD' : 'ZAR'])
        .map(cur => {
          const curRows = rows.filter(r => r.currency === cur);
          if (!curRows.length) return null;
          const [sy, sm] = startDate.split('-').map(Number);
          const lm = lastMonthDaily && lastMonthDaily.key === `${toYMD(new Date(sy, sm - 2, 1))}_${toYMD(new Date(sy, sm - 1, 0))}`
            ? lastMonthDaily[cur] : null;
          return (
            <PacingPanel key={cur} currency={cur} rows={curRows}
              startDate={ranDates.start || startDate} endDate={ranDates.end || endDate}
              lastMonthDaily={lm} lastMonthLoading={lastMonthLoading} onLoadLastMonth={loadLastMonth} />
          );
        })}

      {/* ══ TABLE ══ */}
      <div className="flex-1 overflow-auto">
        {computed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
            {!hasRun ? (
              <>
                <Play className="w-10 h-10 text-slate-700" />
                <p>Set your date range and click <span className="text-blue-400 font-semibold">Run Report</span> to load Meta spend.</p>
              </>
            ) : loading ? (
              <RefreshCw className="w-8 h-8 animate-spin" />
            ) : (
              <p>No accounts with spend in this range.</p>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-800 sticky top-0 z-10">
              <tr className="text-slate-400 text-left">
                <th className="px-3 py-2 font-semibold">Account ID</th>
                <th className="px-3 py-2 font-semibold">Account Name</th>
                <th className="px-3 py-2 font-semibold">Currency</th>
                <th className="px-3 py-2 font-semibold text-right">Total Spend</th>
                <th className="px-3 py-2 font-semibold text-right">Yesterday</th>
                <th className="px-3 py-2 font-semibold text-right">Today</th>
                <th className="px-3 py-2 font-semibold text-right">DoD %</th>
                <th className="px-3 py-2 font-semibold text-center">Flag</th>
              </tr>
            </thead>
            <tbody>
              {computed.map(r => (
                <tr key={r.accountId} className={`border-b border-slate-800 ${
                  r.flagged ? 'bg-red-950/40 hover:bg-red-950/60' : 'hover:bg-slate-800/50'
                }`}>
                  <td className="px-3 py-1.5 font-mono text-slate-400">{r.accountId}</td>
                  <td className="px-3 py-1.5 text-slate-200">{r.name}</td>
                  <td className="px-3 py-1.5">
                    {r._sourceUSD ? (
                      <span className="text-blue-300 text-xs" title={`Original: $${fmtNum(r._origTotal)} × FX ${fx}`}>
                        USD → ZAR
                      </span>
                    ) : (
                      <span className={r.currency === 'USD' ? 'text-blue-300' : 'text-emerald-300'}>
                        {r.currency}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-white font-mono">
                    {tabSymbol}{fmtNum(r.totalSpend)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-300 font-mono">
                    {tabSymbol}{fmtNum(r.yesterdaySpend)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-300 font-mono">
                    {tabSymbol}{fmtNum(r.todaySpend)}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono font-bold ${
                    r.flagged ? 'text-red-300' :
                    r.dod == null ? 'text-slate-500' :
                    r.dod >= 0 ? 'text-emerald-300' : 'text-amber-300'
                  }`}>
                    {r.dod == null ? '—' : isFinite(r.dod) ? fmtPct(r.dod) : 'new'}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {r.flagged && <AlertTriangle className="w-3.5 h-3.5 text-red-400 inline" />}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-800 border-t-2 border-slate-600">
              <tr className={`text-white font-bold ${portfolioFlagged ? 'bg-red-900/50' : ''}`}>
                <td className="px-3 py-2" colSpan={3}>TOTAL — {computed.length} accounts</td>
                <td className="px-3 py-2 text-right font-mono">{tabSymbol}{fmtNum(totals.total)}</td>
                <td className="px-3 py-2 text-right font-mono">{tabSymbol}{fmtNum(totals.yesterday)}</td>
                <td className="px-3 py-2 text-right font-mono">{tabSymbol}{fmtNum(totals.today)}</td>
                <td className={`px-3 py-2 text-right font-mono ${
                  portfolioFlagged ? 'text-red-300' :
                  portfolioDod == null ? 'text-slate-500' :
                  portfolioDod >= 0 ? 'text-emerald-300' : 'text-amber-300'
                }`}>
                  {portfolioDod == null ? '—' : isFinite(portfolioDod) ? fmtPct(portfolioDod) : 'new'}
                </td>
                <td className="px-3 py-2 text-center">
                  {portfolioFlagged && <AlertTriangle className="w-4 h-4 text-red-400 inline" />}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
