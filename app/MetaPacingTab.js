'use client';

// ════════════════════════════════════════════════════════════════════════════
// MetaPacingTab.js — Meta pacing dashboard
//
//   Row 1  five blocks: Spend USD · Spend ZAR · Combined ZAR (USD × FX + ZAR) · Last month to date · Last month total
//   Row 2  pacing for the chosen view (Combined R / USD / ZAR): target, status, forecast, yesterday vs day before
//   Row 3  daily spend chart (with last month overlaid) and spend by client
//   Below  Accounts — optional, collapsed by default: per-client budgets, grouping, bulk budgets
//
//   • Accounts: /api/meta/accounts (same list as the Meta report tab; currency is Meta's own)
//   • Spend: lib/pacingClient (chunked, retrying, merged) → /api/meta/pacing
//   • Budgets: per account and/or a total per view, stored per calendar month in this browser
//   • Yesterday / day-before count back from the report's end date (or today, whichever is earlier)
// ════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from 'react';
import { pacingFetch } from '../lib/pacingClient';
import {
  RefreshCw, FileSpreadsheet, Upload, Download, AlertTriangle, Search, ChevronDown, ChevronRight, Play, X,
} from 'lucide-react';

const FLAG_PCT = 0.10;

// ── Date helpers (plain YYYY-MM-DD strings; no timezone surprises) ───────────
const pad = (n) => String(n).padStart(2, '0');
const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => toYMD(new Date());
const parseYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (s, n) => { const t = new Date(parseYMD(s) + n * 86400000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const daysBetween = (a, b) => Math.round((parseYMD(b) - parseYMD(a)) / 86400000) + 1;   // inclusive
const minStr = (a, b) => (a < b ? a : b);
const firstOfMonth = () => { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 1)); };
const daysInMonthOf = (s) => { const [y, m] = s.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const prevMonthRange = (s) => { const [y, m] = s.split('-').map(Number); return { start: toYMD(new Date(y, m - 2, 1)), end: toYMD(new Date(y, m - 1, 0)) }; };

// ── Formatting ───────────────────────────────────────────────────────────────
function fmtNum(v, dec = 2) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? '0.00' : n.toLocaleString('en-ZA', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v, dec = 1) {
  if (v == null || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(dec) + '%';
}

// ── Client grouping from the account name ("Digital Platforms_MTN Gauteng_ZAR" → "Digital Platforms") ──
function clientGroup(name) {
  const n = (name || '').trim();
  if (/^caxton/i.test(n)) return 'Caxton';
  if (/^bdm/i.test(n)) return 'BDM';
  if (/^digital platforms/i.test(n)) return 'Digital Platforms';
  if (/^mediology/i.test(n)) return 'Mediology';
  if (/^mooivaal/i.test(n)) return 'MooivaalMedia';
  if (/^mediamix/i.test(n)) return 'MediaMix';
  if (n.includes('_')) return n.split('_')[0].trim() || 'Other';
  return 'Other';
}

// ── The pacing maths (same rules as the LinkedIn Pacing tab, applied to one series of daily spend) ──
//   status   : spend through the last full day vs budget/days-in-month × those days   (90–110% = On Track)
//   forecast : average daily spend through the last full day × days in the month
//   needed   : budget left ÷ days left after today
//   trend    : last full day vs the 5-day average (Steady within ±5%)
//   DoD      : last full day vs the day before it
function pace({ daily, budget, startDate, endDate, lmDaily }) {
  const today = todayStr();
  const dim = daysInMonthOf(startDate);
  const monthStart = startDate.slice(0, 8) + '01';
  const monthEnd = `${startDate.slice(0, 8)}${pad(dim)}`;
  const live = today >= monthStart && today <= monthEnd && endDate >= today;   // month still running
  const lastFull = minStr(endDate, addDays(today, -1));
  const prevDay = addDays(lastFull, -1);

  const m = new Map();
  for (const d of daily) m.set(d.date, (m.get(d.date) || 0) + d.spend);

  let spend = 0, spendFull = 0;
  for (const [d, v] of m) {
    if (d >= startDate && d <= endDate) spend += v;
    if (d >= startDate && d <= lastFull) spendFull += v;
  }
  const fullDays = lastFull >= startDate ? daysBetween(startDate, lastFull) : 0;
  const avgDaily = fullDays > 0 ? spendFull / fullDays : 0;

  const y = fullDays > 0 ? (m.get(lastFull) || 0) : 0;
  const d2 = prevDay >= startDate ? (m.get(prevDay) || 0) : 0;
  const dod = d2 === 0 ? (y === 0 ? null : Infinity) : (y - d2) / d2;

  let five = 0, fn = 0;
  for (let i = 0; i < 5; i++) { const d = addDays(lastFull, -i); if (d < startDate) break; five += m.get(d) || 0; fn++; }
  const fiveAvg = fn ? five / fn : 0;
  const dayPct = fiveAvg > 0 ? (y / fiveAvg) * 100 : null;
  const trend = dayPct == null ? '—' : dayPct >= 95 && dayPct <= 105 ? 'Steady' : dayPct > 105 ? 'Up' : 'Down';

  const projected = live && fullDays > 0 ? avgDaily * dim : spend;
  const daysLeft = live ? dim - Number(today.slice(8)) : 0;
  const remaining = budget > 0 ? Math.max(0, budget - spend) : 0;
  const needed = daysLeft > 0 ? remaining / daysLeft : 0;

  const idealFull = budget > 0 && fullDays > 0 ? (budget / dim) * fullDays : 0;
  const ratio = idealFull > 0 ? spendFull / idealFull : null;
  const status = ratio == null ? 'none' : ratio >= 0.9 && ratio <= 1.1 ? 'on' : ratio < 0.9 ? 'under' : 'over';

  let vsLM = null;
  if (lmDaily) {
    const n = Math.max(1, daysBetween(startDate, minStr(endDate, today)));
    const same = lmDaily.filter(d => Number(d.date.slice(8)) <= n).reduce((s, d) => s + d.spend, 0);
    vsLM = same > 0 ? spend / same - 1 : null;
  }

  return {
    dim, live, lastFull, fullDays, daysLeft, spend, spendFull, avgDaily, y, d2, dod, fiveAvg, dayPct, trend,
    projected, remaining, needed, ratio, status, usedPct: budget > 0 ? (spend / budget) * 100 : null, vsLM,
  };
}

const STATUS = {
  none:  { label: 'No target',    cls: 'text-slate-500' },
  under: { label: 'Under pacing', cls: 'text-yellow-400' },
  on:    { label: 'On track',     cls: 'text-emerald-400' },
  over:  { label: 'Over pacing',  cls: 'text-emerald-400' },   // over is good, as on the LinkedIn tab
};

function sumDaily(list) {
  const m = new Map();
  for (const r of list) for (const d of (r.daily || [])) m.set(d.date, (m.get(d.date) || 0) + d.spend);
  return Array.from(m, ([date, spend]) => ({ date, spend })).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Budget upload parsing ────────────────────────────────────────────────────
function parseAmount(c) {
  if (typeof c === 'number') return isFinite(c) ? c : null;
  let s = String(c ?? '').replace(/[R$\s]/g, '');
  if (!s || !/\d/.test(s)) return null;
  s = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function parseBudgetText(text, accounts) {
  const byId = new Map(accounts.map(a => [String(a.id), a]));
  const byName = new Map(accounts.map(a => [norm(a.name), a]));
  const matched = new Map(), unmatched = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = (line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.split(','))
      .map(c => c.trim()).filter(c => c !== '');
    if (cells.length < 2) { unmatched.push(line.trim()); continue; }
    const amt = parseAmount(cells[cells.length - 1]);
    if (amt == null) continue;                         // header row or note
    const keys = cells.slice(0, -1);
    let acc = null;
    for (const k of keys) { acc = byId.get(k) || byName.get(norm(k)); if (acc) break; }
    if (acc) matched.set(String(acc.id), amt); else unmatched.push(keys.join(' | '));
  }
  return { matched, unmatched };
}

function loadXLSX() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Could not load the Excel library'));
    document.head.appendChild(s);
  });
}


// ── small helpers for the dashboard ──────────────────────────────────────────
const DEFAULT_FX = 17.30;   // same default as the Meta report tab
const sumRange = (daily, from, to) => (daily || []).reduce((s, d) => (d.date >= from && d.date <= to ? s + d.spend : s), 0);
const sumDayOfMonth = (daily, n) => (daily || []).reduce((s, d) => (Number(d.date.slice(8)) <= n ? s + d.spend : s), 0);
const scaleDaily = (daily, f) => (f === 1 ? daily : (daily || []).map(d => ({ date: d.date, spend: d.spend * f })));

function Block({ accent, label, value, sub, sub2 }) {
  return (
    <div className={`bg-slate-800 border border-slate-700 border-t-4 ${accent} rounded-xl px-4 py-3 min-w-0`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</div>
      <div className="text-2xl font-bold text-white mt-1 truncate">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1 leading-snug">{sub}</div>}
      {sub2 && <div className="text-[11px] mt-0.5 leading-snug">{sub2}</div>}
    </div>
  );
}

// Daily spend: this period as bars, last month as a line (both in the dashboard's view currency)
function DailyChart({ cur, lm, dim, sym, label }) {
  const W = 640, H = 170, L = 8, R = 8, T = 10, B = 20;
  const max = Math.max(1, ...cur, ...lm);
  const x = (i) => L + ((W - L - R) / dim) * (i + 0.5);
  const bw = Math.max(2, (W - L - R) / dim - 3);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const line = lm.map((v, i) => (v > 0 || i < lm.length ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : '')).filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-label={`Daily spend, ${label}`}>
      {[0, 0.5, 1].map(g => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(max * g)} y2={y(max * g)} stroke="#334155" strokeWidth="1" strokeDasharray={g === 0 ? '' : '3 3'} />
          <text x={L + 2} y={y(max * g) - 2} fontSize="9" fill="#64748b">{sym}{fmtNum(max * g, 0)}</text>
        </g>
      ))}
      {cur.map((v, i) => v > 0 && (
        <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(1, H - B - y(v))} rx="1.5" fill="#6366f1">
          <title>{`Day ${i + 1}: ${sym}${fmtNum(v)}`}</title>
        </rect>
      ))}
      <polyline points={line} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
      {[1, Math.ceil(dim / 2), dim].map(d => <text key={d} x={x(d - 1)} y={H - 5} fontSize="9" fill="#64748b" textAnchor="middle">{d}</text>)}
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function MetaPacingTab({ __seed } = {}) {
  const [accounts, setAccounts]   = useState(__seed?.accounts || []);
  const [accError, setAccError]   = useState('');
  const [view, setView]           = useState('COMB');                  // COMB (USD×FX + ZAR, shown in R) | USD | ZAR
  const [fxRate, setFxRate]       = useState(DEFAULT_FX);
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate]     = useState(todayStr());
  const [data, setData]           = useState(__seed?.data || null);    // { totals: Map, failed: [], start, end }
  const [lmData, setLmData]       = useState(__seed?.lm || null);      // { key, byId: Map }
  const [loading, setLoading]     = useState(false);
  const [lmLoading, setLmLoading] = useState(false);
  const [error, setError]         = useState('');
  const [showAccounts, setShowAccounts] = useState(false);
  const [groupBy, setGroupBy]     = useState('auto');                  // auto | currency | client | bm | none
  const [search, setSearch]       = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [showFailed, setShowFailed] = useState(false);
  const [budgets, setBudgets]     = useState({ per: {}, total: { USD: '', ZAR: '', COMB: '' } });
  const [showBulk, setShowBulk]   = useState(false);
  const [bulkText, setBulkText]   = useState('');

  const fx = Number(fxRate) > 0 ? Number(fxRate) : DEFAULT_FX;
  const sym = view === 'USD' ? '$' : 'R';
  const money = (v) => `${sym}${fmtNum(v)}`;
  const R_ = (v) => `R${fmtNum(v)}`;
  const U_ = (v) => `$${fmtNum(v)}`;
  const monthKey = startDate.slice(0, 7);
  const bKey = `meta_pacing_budgets_${monthKey}`;
  const lmRange = prevMonthRange(startDate);
  const lmKey = `${lmRange.start}|${lmRange.end}`;

  // ── Accounts ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (__seed) return;
    let dead = false;
    fetch('/api/meta/accounts')
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!dead) setAccounts((Array.isArray(d) ? d : []).map(a => ({ ...a, id: String(a.id), currency: (a.currency || '').toUpperCase() })).filter(a => a.currency === 'USD' || a.currency === 'ZAR')); })
      .catch(e => { if (!dead) setAccError(e.message || String(e)); });
    return () => { dead = true; };
  }, []);

  // FX is remembered between visits
  useEffect(() => { try { const v = parseFloat(localStorage.getItem('meta_pacing_fx')); if (v > 0) setFxRate(v); } catch {} }, []);
  const onFx = (v) => { setFxRate(v); try { if (parseFloat(v) > 0) localStorage.setItem('meta_pacing_fx', String(v)); } catch {} };

  // ── Budgets (per calendar month, this browser) ─────────────────────────────
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(bKey) || 'null');
      setBudgets({ per: b?.per || {}, total: { USD: b?.total?.USD || '', ZAR: b?.total?.ZAR || '', COMB: b?.total?.COMB || '' } });
    } catch { setBudgets({ per: {}, total: { USD: '', ZAR: '', COMB: '' } }); }
  }, [bKey]);
  function saveBudgets(next) { setBudgets(next); try { localStorage.setItem(bKey, JSON.stringify(next)); } catch {} }
  function setAccountBudget(id, rawNative) {
    const v = Math.round(parseFloat(String(rawNative).replace(/[\s,]/g, '')) * 100) / 100;
    const per = { ...budgets.per };
    if (isNaN(v) || v <= 0) delete per[id]; else per[id] = v;
    saveBudgets({ ...budgets, per });
  }

  // ── Load: all accounts for the period, then last month ─────────────────────
  async function post(ids, start, end) {
    const res = await pacingFetch('/api/meta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountIds: ids, startDate: start, endDate: end }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Request failed');
    return j;
  }
  async function runReport(start = startDate, end = endDate) {
    const ids = accounts.map(a => a.id);
    if (!ids.length) return;
    setLoading(true); setError('');
    try {
      const j = await post(ids, start, end);
      setData({ totals: new Map((j.accountTotals || []).map(t => [String(t.accountId), t])), failed: j.failedAccounts || [], start, end });
    } catch (e) { setError(e.message || String(e)); }
    setLoading(false);
    // last month follows automatically (it feeds "to date", "total" and the comparison line)
    const r = prevMonthRange(start);
    const key = `${r.start}|${r.end}`;
    setLmLoading(true);
    try {
      const j = await post(ids, r.start, r.end);
      setLmData({ key, byId: new Map((j.accountTotals || []).map(t => [String(t.accountId), t.daily || []])), failed: j.failedAccounts || [] });
    } catch (e) { setError(e.message || String(e)); }
    setLmLoading(false);
  }
  useEffect(() => { if (accounts.length && !data && !loading && !__seed) runReport(); }, [accounts.length]);

  const ran = data ? { start: data.start, end: data.end } : null;
  const stale = ran && (ran.start !== startDate || ran.end !== endDate);
  const lm = lmData && lmData.key === lmKey ? lmData : null;
  const failed = data?.failed || [];
  const lmFailed = lm?.failed?.length || 0;
  const missingDaily = data && [...data.totals.values()].some(t => t.daily === undefined);
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  // ── Dashboard numbers (always native currency first, then combined) ────────
  const hero = useMemo(() => {
    if (!data) return null;
    const today = todayStr();
    const n = Math.max(1, daysBetween(ran.start, minStr(ran.end, today)));
    const acc = { USD: { spend: 0, lmTo: 0, lmTot: 0, n: 0 }, ZAR: { spend: 0, lmTo: 0, lmTot: 0, n: 0 } };
    for (const a of accounts) {
      const t = data.totals.get(a.id); const l = lm?.byId.get(a.id);
      const c = acc[a.currency]; if (!c) continue;
      const s = t ? sumRange(t.daily, ran.start, ran.end) : 0;
      c.spend += s; if (s > 0) c.n++;
      if (l) { c.lmTo += sumDayOfMonth(l, n); c.lmTot += l.reduce((x, d) => x + d.spend, 0); }
    }
    const comb = acc.USD.spend * fx + acc.ZAR.spend;
    const lmToComb = acc.USD.lmTo * fx + acc.ZAR.lmTo;
    const lmTotComb = acc.USD.lmTot * fx + acc.ZAR.lmTot;
    return { acc, n, comb, lmToComb, lmTotComb, vsLM: lmToComb > 0 ? comb / lmToComb - 1 : null };
  }, [data, lm, accounts, fx]);

  // ── Rows in the selected view (USD and ZAR kept apart unless COMB, which scales USD by FX) ──
  const rows = useMemo(() => {
    if (!data) return [];
    return accounts.filter(a => view === 'COMB' || a.currency === view).map(a => {
      const f = view === 'COMB' && a.currency === 'USD' ? fx : 1;
      const t = data.totals.get(a.id);
      const budgetNative = budgets.per[a.id] || 0;
      const daily = scaleDaily(t?.daily || [], f);
      const lmDaily = lm ? scaleDaily(lm.byId.get(a.id) || [], f) : null;
      const budget = budgetNative * f;
      return { id: a.id, name: a.name || `Account ${a.id}`, bm: a.bm || '(unknown)', group: clientGroup(a.name), currency: a.currency,
               f, budget, budgetNative, daily, hasData: !!t, p: pace({ daily, budget, startDate: ran.start, endDate: ran.end, lmDaily }) };
    }).filter(r => r.p.spend > 0 || r.budget > 0);
  }, [data, accounts, view, fx, budgets.per, lm]);

  const summary = useMemo(() => {
    if (!data) return null;
    const sumBud = rows.reduce((s, r) => s + r.budget, 0);
    const manual = parseFloat(budgets.total[view]) || 0;
    const target = manual > 0 ? manual : sumBud;
    const lmDaily = lm ? sumDaily(rows.map(r => ({ daily: scaleDaily(lm.byId.get(r.id) || [], r.f) }))) : null;
    return { sumBud, manual, target, p: pace({ daily: sumDaily(rows), budget: target, startDate: ran.start, endDate: ran.end, lmDaily }) };
  }, [rows, budgets.total, view, data, lm]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? rows.filter(r => r.name.toLowerCase().includes(s) || r.id.includes(s) || r.group.toLowerCase().includes(s)) : rows;
  }, [rows, search]);

  const groupsFor = (list, key) => {
    const m = new Map();
    for (const r of list) { const k = key === 'bm' ? r.bm : key === 'currency' ? r.currency : r.group; (m.get(k) || m.set(k, []).get(k)).push(r); }
    return [...m.entries()].map(([k, rs]) => {
      rs.sort((a, b) => b.p.spend - a.p.spend);
      const budget = rs.reduce((s, r) => s + r.budget, 0);
      const lmDaily = lm ? sumDaily(rs.map(r => ({ daily: scaleDaily(lm.byId.get(r.id) || [], r.f) }))) : null;
      return { key: k, subs: key === 'currency' ? groupsFor(rs, 'client') : null, label: key === 'currency' ? `${k} accounts${view === 'COMB' && k === 'USD' ? ` (shown in R at ${fmtNum(fx)})` : ''}` : k, rows: rs, budget, p: pace({ daily: sumDaily(rs), budget, startDate: ran.start, endDate: ran.end, lmDaily }) };
    }).sort((a, b) => key === 'currency' ? a.key.localeCompare(b.key) : b.p.spend - a.p.spend);
  };
  const effGroup = groupBy === 'auto' ? (view === 'COMB' ? 'currency' : 'client') : groupBy;
  const clientGroups = useMemo(() => (data ? groupsFor(rows, 'client') : []), [rows, data, lm]);
  const tableGroups = useMemo(() => {
    if (!data) return [];
    if (effGroup === 'none') return [{ key: '', rows: [...visible].sort((a, b) => b.p.spend - a.p.spend) }];
    return groupsFor(visible, effGroup);
  }, [visible, effGroup, data, lm]);

  // chart series in the view currency
  const chart = useMemo(() => {
    if (!data) return null;
    const dim = daysInMonthOf(ran.start);
    const cur = Array(dim).fill(0), prev = Array(dim).fill(0);
    for (const r of rows) for (const d of r.daily) { const i = Number(d.date.slice(8)) - 1; if (d.date >= ran.start && d.date <= ran.end && i >= 0 && i < dim) cur[i] += d.spend; }
    if (lm) for (const a of accounts) {
      if (view !== 'COMB' && a.currency !== view) continue;
      const f = view === 'COMB' && a.currency === 'USD' ? fx : 1;
      for (const d of (lm.byId.get(a.id) || [])) { const i = Number(d.date.slice(8)) - 1; if (i >= 0 && i < dim) prev[i] += d.spend * f; }
    }
    return { dim, cur, prev: lm ? prev : [] };
  }, [rows, lm, data, view, fx, accounts]);

  // ── Export ─────────────────────────────────────────────────────────────────
  async function exportExcel() {
    if (!data) return;
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    const vl = view === 'COMB' ? 'ZAR combined' : view;
    const dash = [
      ['Meta pacing dashboard', `${ran.start} → ${ran.end}`], ['FX (USD→ZAR)', fx], [],
      ['Spend USD', hero.acc.USD.spend], ['Spend ZAR', hero.acc.ZAR.spend], ['Combined ZAR (USD × FX + ZAR)', hero.comb],
      [`Last month to date (day 1–${hero.n}), combined ZAR`, hero.lmToComb], ['Last month total, combined ZAR', hero.lmTotComb],
      ['Last month to date USD', hero.acc.USD.lmTo], ['Last month to date ZAR', hero.acc.ZAR.lmTo],
      ['Last month total USD', hero.acc.USD.lmTot], ['Last month total ZAR', hero.acc.ZAR.lmTot],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dash), 'Dashboard');
    const head = ['Client group', 'Account ID', 'Account Name', 'Business Manager', 'Account currency', `Budget (${vl})`, `Spend (${vl})`, '% of budget',
                  'Status', 'Last full day', 'Day before', 'DoD %', '5-day avg', `Forecast (${vl})`, 'Needed per day', 'vs last month %'];
    const accData = [head];
    rows.slice().sort((a, b) => b.p.spend - a.p.spend).forEach(r => accData.push([r.group, r.id, r.name, r.bm, r.currency, r.budget || '', r.p.spend,
      r.p.usedPct == null ? '' : r.p.usedPct / 100, STATUS[r.p.status].label, r.p.y, r.p.d2, r.p.dod == null ? '' : (isFinite(r.p.dod) ? r.p.dod : 'new'),
      r.p.fiveAvg, r.p.projected, r.budget > 0 && r.p.daysLeft > 0 ? r.p.needed : '', r.p.vsLM == null ? '' : r.p.vsLM]));
    const ws = XLSX.utils.aoa_to_sheet(accData);
    ws['!cols'] = [{wch:20},{wch:20},{wch:46},{wch:20},{wch:10},{wch:14},{wch:14},{wch:11},{wch:14},{wch:14},{wch:14},{wch:10},{wch:12},{wch:14},{wch:14},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'Accounts');
    const grp = (list, label) => {
      const out = [[label, 'Accounts', `Budget (${vl})`, `Spend (${vl})`, '% of budget', 'Status', `Forecast (${vl})`]];
      list.forEach(g => out.push([g.key, g.rows.length, g.budget || '', g.p.spend, g.p.usedPct == null ? '' : g.p.usedPct / 100, STATUS[g.p.status].label, g.p.projected]));
      return out;
    };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grp(groupsFor(rows, 'client'), 'Client group')), 'By client');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grp(groupsFor(rows, 'bm'), 'Business Manager')), 'By Business Manager');
    if (failed.length) {
      const f = [['Account ID', 'Account Name', 'Error']];
      failed.forEach(x => f.push([String(x.accountId), accById.get(String(x.accountId))?.name || '', x.error]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f), 'Not loaded');
    }
    XLSX.writeFile(wb, `Meta_Pacing_${view}_${ran.start}_to_${ran.end}.xlsx`);
  }

  async function downloadTemplate() {
    const XLSX = await loadXLSX();
    const aoa = [['Account ID', 'Account Name', 'Currency', 'Client group', `Budget ${monthKey}`]];
    accounts.slice().sort((a, b) => (a.currency + clientGroup(a.name) + a.name).localeCompare(b.currency + clientGroup(b.name) + b.name))
      .forEach(a => aoa.push([String(a.id), a.name, a.currency, clientGroup(a.name), budgets.per[a.id] || '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:20},{wch:50},{wch:10},{wch:20},{wch:16}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Budgets');
    XLSX.writeFile(wb, `Meta_budget_template_${monthKey}.xlsx`);
  }

  async function onBudgetFile(file) {
    if (!file) return;
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await loadXLSX();
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
        setBulkText(aoa.map(r => r.join('\t')).join('\n'));
      } else setBulkText(await file.text());
    } catch (e) { setError(e.message || String(e)); }
  }
  const bulk = useMemo(() => parseBudgetText(bulkText, accounts), [bulkText, accounts]);
  function applyBulk() {
    const per = { ...budgets.per };
    for (const [id, v] of bulk.matched) { if (v > 0) per[id] = v; else delete per[id]; }
    saveBudgets({ ...budgets, per });
    setBulkText(''); setShowBulk(false);
  }

  const toggle = (k) => setCollapsed(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const card = 'bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-w-0';
  const lbl = 'text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1';
  const pctTxt = (v) => (v == null ? '' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v * 100).toFixed(1)}% vs last month to date`);
  const pctCls = (v) => (v == null ? 'text-slate-500' : v >= 0 ? 'text-emerald-400' : 'text-amber-400');
  const viewName = view === 'COMB' ? 'Combined (R)' : view === 'USD' ? 'USD ($)' : 'ZAR (R)';

  // table cells (a plain function, so the budget inputs keep focus between renders)
  const cells = ({ p, budget, isGroup, id, name, f = 1 }) => (<>
    <td className="px-3 py-1.5 text-right font-mono">
      {isGroup
        ? (budget > 0 ? money(budget) : <span className="text-slate-600">—</span>)
        : <input key={`${id}-${budget}-${view}`} type="text" inputMode="decimal" defaultValue={budget > 0 ? String(Math.round(budget * 100) / 100) : ''} placeholder="—"
            onBlur={e => { const cur = budget > 0 ? String(Math.round(budget * 100) / 100) : ''; if (e.target.value !== cur) setAccountBudget(id, parseFloat(String(e.target.value).replace(/[\s,]/g, '')) / f); }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            aria-label={`Budget for ${name}`}
            className="w-24 px-1.5 py-0.5 text-right bg-slate-900/60 border border-slate-700 rounded text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500" />}
    </td>
    <td className="px-3 py-1.5 text-right font-mono text-white">{money(p.spend)}</td>
    <td className="px-3 py-1.5 text-right font-mono text-slate-300">{p.usedPct == null ? '—' : `${p.usedPct.toFixed(1)}%`}</td>
    <td className={`px-3 py-1.5 font-semibold text-xs ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</td>
    <td className="px-3 py-1.5 text-right font-mono text-slate-300">{money(p.y)}</td>
    <td className="px-3 py-1.5 text-right font-mono text-slate-400">{money(p.d2)}</td>
    <td className={`px-3 py-1.5 text-right font-mono font-bold ${p.dod == null ? 'text-slate-500' : (!isFinite(p.dod) || Math.abs(p.dod) > FLAG_PCT) ? 'text-red-300' : p.dod >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
      {p.dod == null ? '—' : isFinite(p.dod) ? fmtPct(p.dod) : 'new'}
    </td>
    <td className="px-3 py-1.5 text-right font-mono text-slate-300">{money(p.projected)}</td>
    <td className="px-3 py-1.5 text-right font-mono text-slate-300">{budget > 0 && p.daysLeft > 0 ? money(p.needed) : '—'}</td>
    {lm && <td className={`px-3 py-1.5 text-right font-mono ${p.vsLM == null ? 'text-slate-500' : p.vsLM >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{fmtPct(p.vsLM)}</td>}
  </>);

  return (
    <div className="flex flex-col min-h-[calc(100vh-80px)] bg-slate-900 text-slate-200">
      {/* ══ TOP BAR ══ */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <label className="text-xs text-slate-400 flex items-center gap-1.5">From
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white" /></label>
        <label className="text-xs text-slate-400 flex items-center gap-1.5">To
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white" /></label>
        <button onClick={() => { setStartDate(firstOfMonth()); setEndDate(todayStr()); }} className="px-2 py-1 rounded text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-200">This month</button>
        <button onClick={() => { const r = prevMonthRange(firstOfMonth()); setStartDate(r.start); setEndDate(r.end); }} className="px-2 py-1 rounded text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-200">Last month</button>
        <button onClick={() => runReport()} disabled={loading || lmLoading || !accounts.length}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white disabled:opacity-60 ${stale ? 'bg-amber-600 hover:bg-amber-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-500'}`}>
          {loading || lmLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {loading ? 'Loading…' : lmLoading ? 'Last month…' : stale ? 'Re-run' : 'Refresh'}
        </button>
        <div className="w-px h-5 bg-slate-600" />
        <label className="text-xs text-slate-400 flex items-center gap-1.5">FX $1 = R
          <input type="number" step="0.01" value={fxRate} onChange={e => onFx(e.target.value)} aria-label="USD to ZAR rate"
            className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white font-mono" /></label>
        <div className="flex gap-1">
          {[['COMB', 'Combined R'], ['USD', '$ USD'], ['ZAR', 'R ZAR']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${view === k ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowBulk(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white"><Upload className="w-3.5 h-3.5" /> Bulk budgets</button>
          <button onClick={exportExcel} disabled={!data || !hero} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"><FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel</button>
        </div>
      </div>

      {accError && <div className="bg-red-900/40 border-b border-red-700 px-4 py-2 text-xs text-red-200 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> {accError}</div>}
      {error && <div className="bg-red-900/40 border-b border-red-700 px-4 py-2 text-xs text-red-200 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> {error}</div>}
      {missingDaily && <div className="bg-amber-900/30 border-b border-amber-700 px-4 py-2 text-xs text-amber-100">The server did not return daily spend, so pacing cannot be worked out. The updated <code>app/api/meta/pacing/route.js</code> needs to be deployed.</div>}
      {(failed.length > 0 || lmFailed > 0) && (
        <div className="bg-amber-900/30 border-b border-amber-700 px-4 py-2 text-xs text-amber-100">
          <div className="flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>
              {failed.length > 0 && <><b>{failed.length}</b> of {accounts.length} accounts could not be loaded for this period</>}
              {failed.length > 0 && lmFailed > 0 && ' · '}
              {lmFailed > 0 && <><b>{lmFailed}</b> for last month</>} — totals are understated.
            </span>
            <button onClick={() => runReport()} disabled={loading || lmLoading} className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 rounded font-bold text-white disabled:opacity-50">Retry</button>
            {failed.length > 0 && <button onClick={() => setShowFailed(s => !s)} className="underline text-amber-300">{showFailed ? 'Hide' : 'Show'} accounts</button>}
          </div>
          {showFailed && <ul className="mt-2 max-h-36 overflow-auto font-mono text-[11px]">{failed.map(f => <li key={f.accountId}>{accById.get(String(f.accountId))?.name || f.accountId} — {f.error}</li>)}</ul>}
        </div>
      )}

      {!data ? (
        <div className="flex flex-col items-center justify-center flex-1 text-slate-500 text-sm gap-2 py-24">
          {loading ? <><RefreshCw className="w-8 h-8 animate-spin text-slate-600" /><p>Loading {accounts.length} accounts… this takes a minute</p></>
            : accounts.length === 0 ? <p>Loading Meta accounts…</p> : <p>Press Refresh to load spend.</p>}
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="text-[11px] text-slate-500">
            {ran.start} → {ran.end} · {accounts.filter(a => a.currency === 'USD').length} USD + {accounts.filter(a => a.currency === 'ZAR').length} ZAR accounts · FX $1 = R{fmtNum(fx)}
            {lmLoading && <span className="text-purple-300"> · loading last month…</span>}
          </div>

          {/* ══ ROW 1 — the five blocks ══ */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <Block accent="border-t-sky-500" label="Spend · USD" value={U_(hero.acc.USD.spend)}
              sub={`${hero.acc.USD.n} accounts with spend`}
              sub2={lm && hero.acc.USD.lmTo > 0 ? <span className={pctCls(hero.acc.USD.spend / hero.acc.USD.lmTo - 1)}>{pctTxt(hero.acc.USD.spend / hero.acc.USD.lmTo - 1)}</span> : null} />
            <Block accent="border-t-emerald-500" label="Spend · ZAR" value={R_(hero.acc.ZAR.spend)}
              sub={`${hero.acc.ZAR.n} accounts with spend`}
              sub2={lm && hero.acc.ZAR.lmTo > 0 ? <span className={pctCls(hero.acc.ZAR.spend / hero.acc.ZAR.lmTo - 1)}>{pctTxt(hero.acc.ZAR.spend / hero.acc.ZAR.lmTo - 1)}</span> : null} />
            <Block accent="border-t-purple-500" label="Combined · ZAR" value={R_(hero.comb)}
              sub={`${U_(hero.acc.USD.spend)} × ${fmtNum(fx)} + ${R_(hero.acc.ZAR.spend)}`}
              sub2={lm ? <span className={pctCls(hero.vsLM)}>{pctTxt(hero.vsLM)}</span> : null} />
            <Block accent="border-t-slate-500" label={`Last month to date · day 1–${hero.n}`} value={lm ? R_(hero.lmToComb) : '…'}
              sub={lm ? `${U_(hero.acc.USD.lmTo)} × ${fmtNum(fx)} + ${R_(hero.acc.ZAR.lmTo)}` : 'loading…'} />
            <Block accent="border-t-slate-400" label="Last month total" value={lm ? R_(hero.lmTotComb) : '…'}
              sub={lm ? `${U_(hero.acc.USD.lmTot)} × ${fmtNum(fx)} + ${R_(hero.acc.ZAR.lmTot)}` : 'loading…'} />
          </div>

          {/* ══ ROW 2 — pacing for the selected view ══ */}
          <div>
            <div className="text-xs font-bold text-white uppercase tracking-wide mb-2">Pacing · {viewName} · day {Math.min(summary.p.dim, hero.n)} of {summary.p.dim}</div>
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
              <div className={card}>
                <div className={lbl}>Target ({sym})</div>
                <input type="text" inputMode="decimal" placeholder={summary.sumBud > 0 ? fmtNum(summary.sumBud) : 'Set total target'}
                  defaultValue={summary.manual > 0 ? String(summary.manual) : ''} key={`${view}-${monthKey}-${summary.manual}`}
                  onBlur={e => { const v = parseFloat(e.target.value.replace(/[\s,]/g, '')); saveBudgets({ ...budgets, total: { ...budgets.total, [view]: isNaN(v) || v <= 0 ? '' : String(v) } }); }}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                  className="w-full px-2 py-1 bg-slate-900/60 border border-slate-700 rounded text-lg font-bold text-white font-mono focus:outline-none focus:border-blue-500" />
                <div className="text-[11px] text-slate-500 mt-1">{summary.manual > 0 ? 'Manual total' : summary.sumBud > 0 ? 'Sum of client budgets' : 'Or set client budgets in Accounts'}</div>
              </div>
              <div className={card}>
                <div className={lbl}>Spend to date</div>
                <div className="text-2xl font-bold text-white">{money(summary.p.spend)}</div>
                {summary.target > 0
                  ? <><div className="h-1.5 bg-slate-700 rounded mt-1.5"><div className="h-1.5 bg-indigo-500 rounded" style={{ width: `${Math.min(100, summary.p.usedPct)}%` }} /></div>
                      <div className="text-[11px] text-slate-400 mt-1">{summary.p.usedPct.toFixed(1)}% of target</div></>
                  : <div className="text-[11px] text-slate-500 mt-1">No target set</div>}
              </div>
              <div className={card}>
                <div className={lbl}>Pacing status</div>
                <div className={`text-2xl font-bold ${STATUS[summary.p.status].cls}`}>{STATUS[summary.p.status].label}</div>
                <div className="text-[11px] text-slate-400 mt-1">{summary.p.ratio == null ? 'Needs a target' : `${(summary.p.ratio * 100).toFixed(1)}% of ideal to ${summary.p.lastFull}`}</div>
              </div>
              <div className={card}>
                <div className={lbl}>Month-end forecast</div>
                <div className={`text-2xl font-bold ${summary.target > 0 && summary.p.projected > summary.target * 1.05 ? 'text-red-400' : summary.target > 0 && summary.p.projected < summary.target * 0.9 ? 'text-yellow-400' : 'text-emerald-400'}`}>{money(summary.p.projected)}</div>
                <div className="text-[11px] text-slate-400 mt-1">Avg {money(summary.p.avgDaily)}/day × {summary.p.dim}{summary.target > 0 && summary.p.daysLeft > 0 ? ` · need ${money(summary.p.needed)}/day` : ''}</div>
              </div>
              <div className={card}>
                <div className={lbl}>Yesterday vs day before</div>
                <div className={`text-2xl font-bold ${summary.p.dod == null ? 'text-slate-400' : (!isFinite(summary.p.dod) || Math.abs(summary.p.dod) > FLAG_PCT) ? 'text-red-300' : 'text-emerald-300'}`}>{summary.p.dod == null ? '—' : isFinite(summary.p.dod) ? fmtPct(summary.p.dod) : 'new'}</div>
                <div className="text-[11px] text-slate-400 mt-1">{money(summary.p.y)} vs {money(summary.p.d2)} · trend {summary.p.trend}</div>
              </div>
            </div>
          </div>

          {/* ══ ROW 3 — charts ══ */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
            <div className={`${card} xl:col-span-3`}>
              <div className="flex items-center justify-between mb-1">
                <div className={lbl}>Daily spend · {viewName}</div>
                <div className="text-[10px] text-slate-500 flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-indigo-500" /> this period</span>
                  {lm && <span className="flex items-center gap-1"><span className="inline-block w-3 border-t-2 border-dashed border-slate-400" /> last month</span>}
                </div>
              </div>
              <DailyChart cur={chart.cur} lm={chart.prev} dim={chart.dim} sym={sym} label={viewName} />
            </div>
            <div className={`${card} xl:col-span-2`}>
              <div className={lbl}>By client · {viewName}</div>
              <div className="space-y-2 mt-2">
                {clientGroups.slice(0, 8).map(g => {
                  const top = Math.max(...clientGroups.map(x => Math.max(x.p.spend, x.budget)), 1);
                  return (
                    <button key={g.key} onClick={() => { setSearch(g.key); setGroupBy('client'); setShowAccounts(true); }} className="block w-full text-left group" title="Show these accounts">
                      <div className="flex justify-between text-[11px]"><span className="text-slate-200 truncate">{g.key} <span className="text-slate-500">· {g.rows.length}</span></span>
                        <span className="font-mono text-slate-300">{money(g.p.spend)} <span className={STATUS[g.p.status].cls}>{g.budget > 0 ? `· ${g.p.usedPct.toFixed(0)}%` : ''}</span></span></div>
                      <div className="relative h-2 bg-slate-700 rounded mt-0.5">
                        <div className="h-2 bg-indigo-500 group-hover:bg-indigo-400 rounded" style={{ width: `${(g.p.spend / top) * 100}%` }} />
                        {g.budget > 0 && <div className="absolute top-[-2px] h-3 w-0.5 bg-amber-400" style={{ left: `${Math.min(100, (g.budget / top) * 100)}%` }} title={`Budget ${money(g.budget)}`} />}
                      </div>
                    </button>
                  );
                })}
                {clientGroups.length > 8 && <div className="text-[11px] text-slate-500">+ {clientGroups.length - 8} more in Accounts</div>}
                {clientGroups.length === 0 && <div className="text-[11px] text-slate-500">No spend in this view</div>}
              </div>
            </div>
          </div>

          {/* ══ ACCOUNTS (optional) ══ */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <button onClick={() => setShowAccounts(s => !s)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/40 text-left" aria-expanded={showAccounts}>
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                {showAccounts ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Accounts <span className="text-slate-500 font-normal">· {rows.length} in {viewName} · budgets, status and forecast per account</span>
              </span>
              <span className="text-xs text-slate-400">{showAccounts ? 'Hide' : 'Show'}</span>
            </button>
            {showAccounts && (
              <div className="border-t border-slate-700">
                <div className="px-4 py-2 flex items-center gap-3 flex-wrap bg-slate-900/40">
                  <select value={groupBy} onChange={e => setGroupBy(e.target.value)} aria-label="Group by" className="px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-white">
                    <option value="auto">Group: auto (brands; USD / ZAR first on Combined)</option><option value="currency">Group: USD / ZAR, then brand</option><option value="client">Group: brand</option><option value="bm">Group: Business Manager</option><option value="none">No grouping</option>
                  </select>
                  <div className="relative">
                    <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts…" className="pl-7 pr-6 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-slate-400 w-52" />
                    {search && <button onClick={() => setSearch('')} className="absolute right-1.5 top-1.5 text-slate-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  {view === 'COMB' && <span className="text-[11px] text-slate-500">USD accounts are shown × FX {fmtNum(fx)}; typing a budget here is converted back to $.</span>}
                </div>
                {visible.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-slate-500 text-sm">{search ? `No accounts match “${search}”` : 'No accounts with spend or a budget in this view'}</div>
                ) : (
                  <div className="overflow-auto max-h-[60vh]">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-slate-800 sticky top-0 z-10">
                        <tr className="text-slate-400 text-left">
                          <th className="px-3 py-2 font-semibold">{effGroup === 'bm' ? 'Business Manager / Account' : effGroup === 'client' ? 'Brand / Account' : effGroup === 'currency' ? 'Currency / Brand / Account' : 'Account'}</th>
                          <th className="px-3 py-2 font-semibold text-right">Budget</th>
                          <th className="px-3 py-2 font-semibold text-right">Spend</th>
                          <th className="px-3 py-2 font-semibold text-right">% budget</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold text-right" title="Last full day in the range">Yesterday</th>
                          <th className="px-3 py-2 font-semibold text-right">Day before</th>
                          <th className="px-3 py-2 font-semibold text-right">DoD %</th>
                          <th className="px-3 py-2 font-semibold text-right">Forecast</th>
                          <th className="px-3 py-2 font-semibold text-right">Needed / day</th>
                          {lm && <th className="px-3 py-2 font-semibold text-right">vs last month</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {tableGroups.map(g => (
                          <GroupBlock key={g.key || 'all'} g={g} grouped={effGroup !== 'none'} collapsedSet={collapsed} toggle={toggle} cells={cells} />
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-slate-800 border-t-2 border-slate-600 text-white font-bold">
                        <tr>
                          <td className="px-3 py-2">TOTAL — {visible.length} accounts</td>
                          <td className="px-3 py-2 text-right font-mono">{summary.sumBud > 0 ? money(summary.sumBud) : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono">{money(visible.reduce((s, r) => s + r.p.spend, 0))}</td>
                          <td colSpan={lm ? 8 : 7} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ BULK BUDGETS ══ */}
      {showBulk && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="Bulk budgets">
          <div className="bg-slate-800 border border-slate-600 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Bulk budgets — {monthKey}</h3>
              <button onClick={() => setShowBulk(false)} className="text-slate-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              One account per line: <b>account name or ID</b>, then the <b>budget in that account’s own currency</b> (USD accounts in $, ZAR in R).
              Paste from Excel, or upload a .xlsx / .csv. Names are matched if Excel has rounded the IDs. Budgets are saved for {monthKey} in this browser.
            </p>
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white"><Download className="w-3.5 h-3.5" /> Download template (all {accounts.length} accounts)</button>
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"><Upload className="w-3.5 h-3.5" /> Upload file
                <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={e => { onBudgetFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <button onClick={() => { if (confirm(`Clear all client budgets for ${monthKey}?`)) saveBudgets({ ...budgets, per: {} }); }} className="px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-red-800 text-slate-300">Clear all budgets</button>
            </div>
            <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={8} spellCheck={false}
              placeholder={'Mediology_Telament USD\t5000\nDigital Platforms_MTN Gauteng_ZAR\t20000'}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-xs font-mono text-slate-100" />
            <div className="text-xs mt-2">
              <span className="text-emerald-400 font-semibold">{bulk.matched.size} matched</span>
              {bulk.unmatched.length > 0 && <span className="text-amber-400 font-semibold"> · {bulk.unmatched.length} not found</span>}
              {bulk.unmatched.length > 0 && <ul className="mt-1 max-h-24 overflow-auto font-mono text-[11px] text-amber-200/80">{bulk.unmatched.slice(0, 50).map((u, i) => <li key={i}>{u}</li>)}</ul>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowBulk(false)} className="px-3 py-1.5 rounded text-xs bg-slate-700 text-slate-200 hover:bg-slate-600">Cancel</button>
              <button onClick={applyBulk} disabled={bulk.matched.size === 0} className="px-3 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold disabled:opacity-40">Apply {bulk.matched.size} budgets</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountRow({ r, indent, cells }) {
  return (
    <tr className="border-t border-slate-800 hover:bg-slate-800/50">
      <td className={`py-1.5 pr-3 ${indent}`}>
        <div className="text-slate-100 truncate max-w-md" title={r.name}>{r.name}</div>
        <div className="text-[10px] text-slate-500 font-mono">{r.id} · {r.currency}{!r.hasData && <span className="text-amber-500"> · no data</span>}</div>
      </td>
      {cells({ p: r.p, budget: r.budget, id: r.id, name: r.name, f: r.f })}
    </tr>
  );
}

function HeaderRow({ g, label, isCollapsed, onToggle, indent, cells, sub }) {
  return (
    <tr className={`${sub ? 'bg-slate-800/40' : 'bg-slate-800/80 border-t border-slate-700'} cursor-pointer hover:bg-slate-700/60`} onClick={onToggle}>
      <td className={`py-2 pr-3 ${indent} ${sub ? 'font-semibold text-slate-100' : 'font-bold text-white'}`}>
        <span className="inline-flex items-center gap-1.5">
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {label} <span className="text-slate-500 font-normal">· {g.rows.length}</span>
        </span>
      </td>
      {cells({ p: g.p, budget: g.budget, isGroup: true })}
    </tr>
  );
}

// One group: a header, then either its brand sub-groups (USD / ZAR first) or its accounts
function GroupBlock({ g, grouped, collapsedSet, toggle, cells }) {
  if (!grouped) return <>{g.rows.map(r => <AccountRow key={r.id} r={r} indent="pl-3" cells={cells} />)}</>;
  const open = !collapsedSet.has(g.key);
  return (
    <>
      <HeaderRow g={g} label={g.label || g.key || '(none)'} isCollapsed={!open} onToggle={() => toggle(g.key)} indent="pl-3" cells={cells} />
      {open && (g.subs
        ? g.subs.map(s => {
            const k = `${g.key}/${s.key}`;
            const sOpen = !collapsedSet.has(k);
            return (
              <React.Fragment key={k}>
                <HeaderRow g={s} label={s.key} isCollapsed={!sOpen} onToggle={() => toggle(k)} indent="pl-8" cells={cells} sub />
                {sOpen && s.rows.map(r => <AccountRow key={r.id} r={r} indent="pl-14" cells={cells} />)}
              </React.Fragment>
            );
          })
        : g.rows.map(r => <AccountRow key={r.id} r={r} indent="pl-9" cells={cells} />))}
    </>
  );
}
