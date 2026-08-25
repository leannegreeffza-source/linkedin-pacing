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
function toYMD(d)         { return d.toISOString().split('T')[0]; }
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
  // Two batched calls — one per currency group — because /api/meta/pacing
  // sums spend in the account's native currency. Calling it with mixed
  // currencies in one shot would conflate USD+ZAR in the daily totals,
  // which we don't want even though the per-account values come back correctly.
  async function runReport() {
    if (!allAccounts.length) {
      setError('Account list not loaded yet — wait a moment, then try again.');
      return;
    }

    const usdAccs = allAccounts.filter(a => (a.currency || '').toUpperCase() === 'USD');
    const zarAccs = allAccounts.filter(a => (a.currency || '').toUpperCase() === 'ZAR');

    if (usdAccs.length === 0 && zarAccs.length === 0) {
      setError('No accounts with USD or ZAR currency. Found currencies: ' +
        [...new Set(allAccounts.map(a => a.currency))].join(', '));
      return;
    }

    setLoading(true); setError(''); setHasRun(true);
    setProgress({ pct: 5, message: `Fetching ${usdAccs.length} USD + ${zarAccs.length} ZAR accounts…` });

    try {
      const call = (accs) => accs.length === 0
        ? Promise.resolve({ accountTotals: [] })
        : fetch('/api/meta/pacing', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ accountIds: accs.map(a => a.id), startDate, endDate }),
          }).then(async r => {
            if (!r.ok) {
              const e = await r.json().catch(() => ({}));
              throw new Error(e.error || `HTTP ${r.status}`);
            }
            return r.json();
          });

      setProgress({ pct: 25, message: 'Querying Meta Marketing API…' });
      const [usdRes, zarRes] = await Promise.all([call(usdAccs), call(zarAccs)]);
      setProgress({ pct: 80, message: 'Merging results…' });

      const accMap = new Map(allAccounts.map(a => [String(a.id), a]));
      const tag = (totals, currency) => totals.map(t => {
        const a = accMap.get(String(t.accountId)) || {};
        return {
          accountId:      String(t.accountId),
          name:           a.name || `Account ${t.accountId}`,
          currency,
          totalSpend:     t.totalSpend     || 0,
          todaySpend:     t.todaySpend     || 0,
          yesterdaySpend: t.yesterdaySpend || 0,
        };
      });

      const merged = [
        ...tag(usdRes.accountTotals || [], 'USD'),
        ...tag(zarRes.accountTotals || [], 'ZAR'),
      ].filter(r => r.totalSpend > 0 || r.todaySpend > 0 || r.yesterdaySpend > 0)
       .sort((a, b) => b.totalSpend - a.totalSpend);

      setRows(merged);
      setRanDates({ start: startDate, end: endDate });
      setLastRefresh(new Date());
      setProgress({
        pct: 100,
        message: `✓ ${merged.length} accounts with spend · ${merged.filter(r=>r.currency==='USD').length} USD · ${merged.filter(r=>r.currency==='ZAR').length} ZAR`,
      });
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
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

  // ── Excel export ──────────────────────────────────────────────────────────
  async function exportToExcel() {
    const XLSX = await loadXLSX();
    const header = ['Account ID', 'Account Name', 'Currency', `Total (${activeTab === 'USD Accounts' ? 'USD' : 'ZAR'})`,
                    'Yesterday', 'Today', 'DoD %', 'Flagged'];
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
      ]);
    });
    data.push([]);
    data.push(['TOTAL', '', '',
      totals.total, totals.yesterday, totals.today,
      portfolioDod == null ? '' : (isFinite(portfolioDod) ? portfolioDod : 'new spend'),
      portfolioFlagged ? 'YES' : '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{wch:14},{wch:40},{wch:14},{wch:16},{wch:14},{wch:14},{wch:12},{wch:10}];
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
