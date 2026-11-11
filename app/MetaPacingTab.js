'use client';

// ════════════════════════════════════════════════════════════════════════════
// MetaPacingTab.js — Meta pacing, per currency (USD and ZAR are never mixed or converted)
//
//   • Accounts come from /api/meta/accounts (same list as the Meta report tab; currency is Meta's own)
//   • Spend comes from lib/pacingClient (chunked, retrying, merged) → /api/meta/pacing
//   • Budgets: one total target per currency AND/OR a budget per client, stored per calendar month
//     in this browser (localStorage). Bulk upload / paste fills the per-client budgets in one go.
//   • Grouping: by client (name prefix), by Business Manager, or none — each group gets its own
//     budget total (sum of its accounts), spend, status and forecast.
//   • Yesterday / Day-before are counted back from the report's end date (or from today if the
//     range runs past today), so a past month's DoD still makes sense.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
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

// ════════════════════════════════════════════════════════════════════════════
export default function MetaPacingTab({ __seed } = {}) {
  const [accounts, setAccounts]   = useState(__seed?.accounts || []);
  const [accError, setAccError]   = useState('');
  const [currency, setCurrency]   = useState('USD');
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate]     = useState(todayStr());
  const [data, setData]           = useState(__seed?.data || {});      // { USD: { totals: Map, failed: [], start, end } }
  const [lm, setLm]               = useState({});                      // { USD: { key, byId: Map } }
  const [loading, setLoading]     = useState(false);
  const [lmLoading, setLmLoading] = useState(false);
  const [error, setError]         = useState('');
  const [groupBy, setGroupBy]     = useState('client');                // client | bm | none
  const [search, setSearch]       = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [showFailed, setShowFailed] = useState(false);
  const [budgets, setBudgets]     = useState({ per: {}, total: { USD: '', ZAR: '' } });
  const [showBulk, setShowBulk]   = useState(false);
  const [bulkText, setBulkText]   = useState('');

  const sym = currency === 'USD' ? '$' : 'R';
  const money = (v) => `${sym}${fmtNum(v)}`;
  const monthKey = startDate.slice(0, 7);
  const bKey = `meta_pacing_budgets_${monthKey}`;

  // ── Accounts ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (__seed) return;
    let dead = false;
    fetch('/api/meta/accounts')
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!dead) setAccounts((Array.isArray(d) ? d : []).map(a => ({ ...a, id: String(a.id), currency: (a.currency || '').toUpperCase() }))); })
      .catch(e => { if (!dead) setAccError(e.message || String(e)); });
    return () => { dead = true; };
  }, []);

  // ── Budgets (per calendar month, this browser) ─────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(bKey);
      const b = raw ? JSON.parse(raw) : null;
      setBudgets({ per: b?.per || {}, total: { USD: b?.total?.USD || '', ZAR: b?.total?.ZAR || '' } });
    } catch { setBudgets({ per: {}, total: { USD: '', ZAR: '' } }); }
  }, [bKey]);
  function saveBudgets(next) {
    setBudgets(next);
    try { localStorage.setItem(bKey, JSON.stringify(next)); } catch {}
  }
  function setAccountBudget(id, raw) {
    const v = parseFloat(String(raw).replace(/[\s,]/g, ''));
    const per = { ...budgets.per };
    if (isNaN(v) || v <= 0) delete per[id]; else per[id] = v;
    saveBudgets({ ...budgets, per });
  }

  // ── Load spend for the viewed currency ─────────────────────────────────────
  const inCur = useMemo(() => accounts.filter(a => a.currency === currency), [accounts, currency]);

  async function runReport(cur = currency, start = startDate, end = endDate) {
    const ids = accounts.filter(a => a.currency === cur).map(a => a.id);
    if (!ids.length) return;
    setLoading(true); setError('');
    try {
      const res = await pacingFetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: ids, startDate: start, endDate: end }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Request failed');
      const totals = new Map((j.accountTotals || []).map(t => [String(t.accountId), t]));
      setData(d => ({ ...d, [cur]: { totals, failed: j.failedAccounts || [], start, end } }));
    } catch (e) { setError(e.message || String(e)); }
    setLoading(false);
  }

  // first load of each currency happens automatically
  useEffect(() => {
    if (accounts.length && !data[currency] && !loading) runReport(currency);
  }, [accounts.length, currency]);

  // optional: last month for "vs last month"
  async function loadLastMonth() {
    const { start, end } = prevMonthRange(startDate);
    const ids = inCur.map(a => a.id);
    if (!ids.length) return;
    setLmLoading(true);
    try {
      const res = await pacingFetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: ids, startDate: start, endDate: end }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Request failed');
      setLm(x => ({ ...x, [currency]: { key: `${start}|${end}`, byId: new Map((j.accountTotals || []).map(t => [String(t.accountId), t.daily || []])) } }));
    } catch (e) { setError(e.message || String(e)); }
    setLmLoading(false);
  }

  const cur = data[currency];
  const ran = cur ? { start: cur.start, end: cur.end } : null;
  const stale = ran && (ran.start !== startDate || ran.end !== endDate);
  const lmCur = lm[currency] && lm[currency].key === `${prevMonthRange(startDate).start}|${prevMonthRange(startDate).end}` ? lm[currency] : null;
  const missingDaily = cur && [...cur.totals.values()].some(t => t.daily === undefined);

  // ── Rows → groups → summary ────────────────────────────────────────────────
  const rows = useMemo(() => {
    if (!cur) return [];
    const ps = ran.start, pe = ran.end;
    return inCur.map(a => {
      const t = cur.totals.get(a.id);
      const budget = budgets.per[a.id] || 0;
      const daily = t?.daily || [];
      const lmDaily = lmCur ? (lmCur.byId.get(a.id) || []) : null;
      return { id: a.id, name: a.name || `Account ${a.id}`, bm: a.bm || '(unknown)', group: clientGroup(a.name),
               budget, daily, hasData: !!t, p: pace({ daily, budget, startDate: ps, endDate: pe, lmDaily }) };
    }).filter(r => r.p.spend > 0 || r.budget > 0);
  }, [cur, inCur, budgets.per, lmCur]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? rows.filter(r => r.name.toLowerCase().includes(s) || r.id.includes(s) || r.group.toLowerCase().includes(s)) : rows;
  }, [rows, search]);

  const groups = useMemo(() => {
    if (!cur) return [];
    if (groupBy === 'none') return [{ key: '', rows: [...visible].sort((a, b) => b.p.spend - a.p.spend) }];
    const m = new Map();
    for (const r of visible) { const k = groupBy === 'bm' ? r.bm : r.group; (m.get(k) || m.set(k, []).get(k)).push(r); }
    return [...m.entries()].map(([key, rs]) => {
      rs.sort((a, b) => b.p.spend - a.p.spend);
      const budget = rs.reduce((s, r) => s + r.budget, 0);
      const daily = sumDaily(rs);
      const lmDaily = lmCur ? sumDaily(rs.map(r => ({ daily: lmCur.byId.get(r.id) || [] }))) : null;
      return { key, rows: rs, budget, p: pace({ daily, budget, startDate: ran.start, endDate: ran.end, lmDaily }), daily };
    }).sort((a, b) => b.p.spend - a.p.spend);
  }, [visible, groupBy, cur, lmCur]);

  const summary = useMemo(() => {
    if (!cur) return null;
    const sumBud = rows.reduce((s, r) => s + r.budget, 0);
    const manual = parseFloat(budgets.total[currency]) || 0;
    const target = manual > 0 ? manual : sumBud;
    const daily = sumDaily(rows);
    const lmDaily = lmCur ? sumDaily(rows.map(r => ({ daily: lmCur.byId.get(r.id) || [] }))) : null;
    return { sumBud, manual, target, p: pace({ daily, budget: target, startDate: ran.start, endDate: ran.end, lmDaily }) };
  }, [rows, budgets.total, currency, cur, lmCur]);

  const failed = cur?.failed || [];
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  // ── Export ─────────────────────────────────────────────────────────────────
  async function exportExcel() {
    if (!cur) return;
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    const head = ['Client group', 'Account ID', 'Account Name', 'Business Manager', `Budget (${currency})`, `Spend (${currency})`, '% of budget',
                  'Status', `Last full day (${ran.end < todayStr() ? ran.end : 'yesterday'})`, 'Day before', 'DoD %', '5-day avg', `Forecast (${currency})`, 'Needed per day', 'vs last month %'];
    const line = (grp, r) => [grp, r.id, r.name, r.bm, r.budget || '', r.p.spend, r.p.usedPct == null ? '' : r.p.usedPct / 100,
      STATUS[r.p.status].label, r.p.y, r.p.d2, r.p.dod == null ? '' : (isFinite(r.p.dod) ? r.p.dod : 'new'), r.p.fiveAvg, r.p.projected,
      r.budget > 0 && r.p.daysLeft > 0 ? r.p.needed : '', r.p.vsLM == null ? '' : r.p.vsLM];
    const accData = [head];
    rows.slice().sort((a, b) => b.p.spend - a.p.spend).forEach(r => accData.push(line(r.group, r)));
    const ws = XLSX.utils.aoa_to_sheet(accData);
    ws['!cols'] = [{wch:20},{wch:20},{wch:46},{wch:20},{wch:14},{wch:14},{wch:11},{wch:14},{wch:16},{wch:14},{wch:10},{wch:12},{wch:14},{wch:14},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, `Accounts (${currency})`);

    // groups by client and by Business Manager
    const build = (keyFn, label) => {
      const m = new Map();
      rows.forEach(r => { const k = keyFn(r); (m.get(k) || m.set(k, []).get(k)).push(r); });
      const out = [[label, 'Accounts', `Budget (${currency})`, `Spend (${currency})`, '% of budget', 'Status', `Forecast (${currency})`]];
      [...m.entries()].map(([k, rs]) => {
        const budget = rs.reduce((s, r) => s + r.budget, 0);
        return { k, n: rs.length, budget, p: pace({ daily: sumDaily(rs), budget, startDate: ran.start, endDate: ran.end }) };
      }).sort((a, b) => b.p.spend - a.p.spend).forEach(g => out.push([g.k, g.n, g.budget || '', g.p.spend,
        g.p.usedPct == null ? '' : g.p.usedPct / 100, STATUS[g.p.status].label, g.p.projected]));
      return out;
    };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(build(r => r.group, 'Client group')), 'By client');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(build(r => r.bm, 'Business Manager')), 'By Business Manager');
    if (failed.length) {
      const f = [['Account ID', 'Account Name', 'Error']];
      failed.forEach(x => f.push([String(x.accountId), accById.get(String(x.accountId))?.name || '', x.error]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f), 'Not loaded');
    }
    XLSX.writeFile(wb, `Meta_Pacing_${currency}_${ran.start}_to_${ran.end}.xlsx`);
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
      } else {
        setBulkText(await file.text());
      }
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
  const card = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 min-w-0';
  const lbl = 'text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1';
  const counts = { USD: accounts.filter(a => a.currency === 'USD').length, ZAR: accounts.filter(a => a.currency === 'ZAR').length };

  // ── Row renderers ──────────────────────────────────────────────────────────
  const cells = ({ p, budget, isGroup, id, name }) => (<>
    <td className="px-3 py-1.5 text-right font-mono">
      {isGroup
        ? (budget > 0 ? money(budget) : <span className="text-slate-600">—</span>)
        : <input key={`${id}-${budget}`} type="text" inputMode="decimal" defaultValue={budget > 0 ? String(budget) : ''} placeholder="—"
            onBlur={e => { if (e.target.value !== (budget > 0 ? String(budget) : '')) setAccountBudget(id, e.target.value); }}
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
    {lmCur && <td className={`px-3 py-1.5 text-right font-mono ${p.vsLM == null ? 'text-slate-500' : p.vsLM >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{fmtPct(p.vsLM)}</td>}
  </>);

  return (
    <div className="flex flex-col min-h-[calc(100vh-80px)] bg-slate-900 text-slate-200">
      {/* ══ TOP BAR ══ */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {['USD', 'ZAR'].map(c => (
            <button key={c} onClick={() => setCurrency(c)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${currency === c ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {c === 'USD' ? '$ USD' : 'R ZAR'} ({counts[c]})
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-slate-600" />
        <label className="text-xs text-slate-400 flex items-center gap-1.5">From
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white" /></label>
        <label className="text-xs text-slate-400 flex items-center gap-1.5">To
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white" /></label>
        <button onClick={() => { setStartDate(firstOfMonth()); setEndDate(todayStr()); }}
          className="px-2 py-1 rounded text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-200">This month</button>
        <button onClick={() => { const r = prevMonthRange(firstOfMonth()); setStartDate(r.start); setEndDate(r.end); }}
          className="px-2 py-1 rounded text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-200">Last month</button>
        <button onClick={() => runReport()} disabled={loading || !accounts.length}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white disabled:opacity-50 ${stale ? 'bg-amber-600 hover:bg-amber-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-500'}`}>
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {loading ? 'Loading…' : stale ? 'Re-run' : 'Refresh'}
        </button>
        <div className="w-px h-5 bg-slate-600" />
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)} aria-label="Group by"
          className="px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-white">
          <option value="client">Group: client</option>
          <option value="bm">Group: Business Manager</option>
          <option value="none">No grouping</option>
        </select>
        <div className="relative">
          <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts…"
            className="pl-7 pr-6 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-slate-400 w-48" />
          {search && <button onClick={() => setSearch('')} className="absolute right-1.5 top-1.5 text-slate-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => (lmCur ? null : loadLastMonth())} disabled={lmLoading || !cur}
            className="px-2.5 py-1.5 rounded text-xs bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-50">
            {lmLoading ? 'Loading last month…' : lmCur ? 'Last month loaded ✓' : 'Compare with last month'}
          </button>
          <button onClick={() => setShowBulk(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white">
            <Upload className="w-3.5 h-3.5" /> Bulk budgets
          </button>
          <button onClick={exportExcel} disabled={!cur}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
          </button>
        </div>
      </div>

      {accError && <div className="bg-red-900/40 border-b border-red-700 px-4 py-2 text-xs text-red-200 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> {accError}</div>}
      {error && <div className="bg-red-900/40 border-b border-red-700 px-4 py-2 text-xs text-red-200 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> {error}</div>}
      {missingDaily && (
        <div className="bg-amber-900/30 border-b border-amber-700 px-4 py-2 text-xs text-amber-100">
          The server did not return daily spend, so pacing figures cannot be worked out. The updated <code>app/api/meta/pacing/route.js</code> needs to be deployed.
        </div>
      )}
      {failed.length > 0 && (
        <div className="bg-amber-900/30 border-b border-amber-700 px-4 py-2 text-xs text-amber-100">
          <div className="flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span><b>{failed.length}</b> of {inCur.length} {currency} accounts could not be loaded — totals are understated.</span>
            <button onClick={() => runReport()} disabled={loading} className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 rounded font-bold text-white disabled:opacity-50">Retry</button>
            <button onClick={() => setShowFailed(s => !s)} className="underline text-amber-300">{showFailed ? 'Hide' : 'Show'} accounts</button>
          </div>
          {showFailed && (
            <ul className="mt-2 max-h-36 overflow-auto font-mono text-[11px]">
              {failed.map(f => <li key={f.accountId}>{accById.get(String(f.accountId))?.name || f.accountId} — {f.error}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ══ SUMMARY ══ */}
      {summary && (
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-900/40">
          <div className="text-[11px] text-slate-500 mb-2">
            {currency} · {ran.start} → {ran.end} · day {Math.min(summary.p.dim, Math.max(1, daysBetween(ran.start, minStr(ran.end, todayStr()))))} of {summary.p.dim} ·
            yesterday/day-before counted back from {summary.p.lastFull} · native {currency}, never converted
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
            <div className={card}>
              <div className={lbl}>Target ({currency})</div>
              <input type="text" inputMode="decimal" placeholder={summary.sumBud > 0 ? fmtNum(summary.sumBud) : 'Set total target'}
                defaultValue={summary.manual > 0 ? String(summary.manual) : ''} key={`${currency}-${monthKey}-${summary.manual}`}
                onBlur={e => { const v = parseFloat(e.target.value.replace(/[\s,]/g, '')); saveBudgets({ ...budgets, total: { ...budgets.total, [currency]: isNaN(v) || v <= 0 ? '' : String(v) } }); }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                className="w-full px-2 py-1 bg-slate-900/60 border border-slate-700 rounded text-sm font-bold text-white font-mono focus:outline-none focus:border-blue-500" />
              <div className="text-[11px] text-slate-500 mt-1">{summary.manual > 0 ? 'Manual total' : summary.sumBud > 0 ? 'Sum of client budgets' : 'Or set client budgets below'}</div>
            </div>
            <div className={card}>
              <div className={lbl}>Spend to date</div>
              <div className="text-lg font-bold text-white">{money(summary.p.spend)}</div>
              {summary.target > 0
                ? <><div className="h-1.5 bg-slate-700 rounded mt-1"><div className="h-1.5 bg-blue-500 rounded" style={{ width: `${Math.min(100, summary.p.usedPct)}%` }} /></div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{summary.p.usedPct.toFixed(1)}% of target</div></>
                : <div className="text-[11px] text-slate-500">No target set</div>}
            </div>
            <div className={card}>
              <div className={lbl}>Pacing status</div>
              <div className={`text-lg font-bold ${STATUS[summary.p.status].cls}`}>{STATUS[summary.p.status].label}</div>
              <div className="text-[11px] text-slate-400">{summary.p.ratio == null ? 'Needs a target' : `${(summary.p.ratio * 100).toFixed(1)}% of ideal to ${summary.p.lastFull}`}</div>
            </div>
            <div className={card}>
              <div className={lbl}>Month-end forecast</div>
              <div className={`text-lg font-bold ${summary.target > 0 && summary.p.projected > summary.target * 1.05 ? 'text-red-400' : summary.target > 0 && summary.p.projected < summary.target * 0.9 ? 'text-yellow-400' : 'text-emerald-400'}`}>{money(summary.p.projected)}</div>
              <div className="text-[11px] text-slate-400">Avg {money(summary.p.avgDaily)}/day × {summary.p.dim}</div>
            </div>
            <div className={card}>
              <div className={lbl}>Needed per day</div>
              <div className="text-lg font-bold text-white">{summary.target > 0 && summary.p.daysLeft > 0 ? money(summary.p.needed) : '—'}</div>
              <div className="text-[11px] text-slate-400">{summary.target > 0 ? `${money(summary.p.remaining)} left · ${summary.p.daysLeft} days` : 'Set a target'}</div>
            </div>
            <div className={card}>
              <div className={lbl}>Yesterday vs day before</div>
              <div className={`text-lg font-bold ${summary.p.dod == null ? 'text-slate-400' : (!isFinite(summary.p.dod) || Math.abs(summary.p.dod) > FLAG_PCT) ? 'text-red-300' : 'text-emerald-300'}`}>{summary.p.dod == null ? '—' : isFinite(summary.p.dod) ? fmtPct(summary.p.dod) : 'new'}</div>
              <div className="text-[11px] text-slate-400">{money(summary.p.y)} vs {money(summary.p.d2)} · trend {summary.p.trend}</div>
            </div>
          </div>
        </div>
      )}

      {/* ══ TABLE ══ */}
      <div className="flex-1 overflow-auto">
        {!cur ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-sm gap-2">
            {loading ? <><RefreshCw className="w-8 h-8 animate-spin text-slate-600" /><p>Loading {currency} accounts…</p></>
              : accounts.length === 0 ? <p>Loading Meta accounts…</p> : <p>Press Refresh to load {currency} spend.</p>}
          </div>
        ) : groups.length === 0 || visible.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">{search ? `No accounts match “${search}”` : `No ${currency} accounts with spend or a budget in this range`}</div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-800 sticky top-0 z-10">
              <tr className="text-slate-400 text-left">
                <th className="px-3 py-2 font-semibold">{groupBy === 'bm' ? 'Business Manager / Account' : groupBy === 'client' ? 'Client / Account' : 'Account'}</th>
                <th className="px-3 py-2 font-semibold text-right">Budget</th>
                <th className="px-3 py-2 font-semibold text-right">Spend</th>
                <th className="px-3 py-2 font-semibold text-right">% budget</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold text-right" title="Last full day in the range">Yesterday</th>
                <th className="px-3 py-2 font-semibold text-right">Day before</th>
                <th className="px-3 py-2 font-semibold text-right">DoD %</th>
                <th className="px-3 py-2 font-semibold text-right">Forecast</th>
                <th className="px-3 py-2 font-semibold text-right">Needed / day</th>
                {lmCur && <th className="px-3 py-2 font-semibold text-right">vs last month</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <GroupBlock key={g.key || 'all'} g={g} grouped={groupBy !== 'none'} collapsed={collapsed.has(g.key)} onToggle={() => toggle(g.key)}
                  cells={cells} />
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-800 border-t-2 border-slate-600 text-white font-bold">
              <tr>
                <td className="px-3 py-2">TOTAL — {visible.length} accounts</td>
                <td className="px-3 py-2 text-right font-mono">{summary.sumBud > 0 ? money(summary.sumBud) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{money(visible.reduce((s, r) => s + r.p.spend, 0))}</td>
                <td colSpan={lmCur ? 8 : 7} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ══ BULK BUDGETS ══ */}
      {showBulk && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="Bulk budgets">
          <div className="bg-slate-800 border border-slate-600 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Bulk budgets — {monthKey}</h3>
              <button onClick={() => setShowBulk(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              One account per line: <b>account name or ID</b>, then the <b>budget in that account’s own currency</b> (USD accounts in $, ZAR in R).
              Paste from Excel, or upload a .xlsx / .csv. Names are matched if Excel has rounded the IDs. Budgets are saved for {monthKey} in this browser.
            </p>
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white">
                <Download className="w-3.5 h-3.5" /> Download template (all {accounts.length} accounts)
              </button>
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Upload file
                <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={e => { onBudgetFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <button onClick={() => { if (confirm(`Clear all client budgets for ${monthKey}?`)) saveBudgets({ ...budgets, per: {} }); }}
                className="px-2.5 py-1.5 rounded text-xs bg-slate-700 hover:bg-red-800 text-slate-300">Clear all budgets</button>
            </div>
            <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={8} spellCheck={false}
              placeholder={'Mediology_Telament USD\t5000\nDigital Platforms_MTN Gauteng_ZAR\t20000'}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-xs font-mono text-slate-100" />
            <div className="text-xs mt-2">
              <span className="text-emerald-400 font-semibold">{bulk.matched.size} matched</span>
              {bulk.unmatched.length > 0 && <span className="text-amber-400 font-semibold"> · {bulk.unmatched.length} not found</span>}
              {bulk.unmatched.length > 0 && (
                <ul className="mt-1 max-h-24 overflow-auto font-mono text-[11px] text-amber-200/80">
                  {bulk.unmatched.slice(0, 50).map((u, i) => <li key={i}>{u}</li>)}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowBulk(false)} className="px-3 py-1.5 rounded text-xs bg-slate-700 text-slate-200 hover:bg-slate-600">Cancel</button>
              <button onClick={applyBulk} disabled={bulk.matched.size === 0}
                className="px-3 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold disabled:opacity-40">Apply {bulk.matched.size} budgets</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupBlock({ g, grouped, collapsed, onToggle, cells }) {
  return (
    <>
      {grouped && (
        <tr className="bg-slate-800/80 border-t border-slate-700 cursor-pointer hover:bg-slate-700/60" onClick={onToggle}>
          <td className="px-3 py-2 font-bold text-white">
            <span className="inline-flex items-center gap-1.5">
              {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {g.key || '(none)'} <span className="text-slate-500 font-normal">· {g.rows.length}</span>
            </span>
          </td>
          {cells({ p: g.p, budget: g.budget, isGroup: true })}
        </tr>
      )}
      {!collapsed && g.rows.map(r => (
        <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/50">
          <td className={`py-1.5 pr-3 ${grouped ? 'pl-9' : 'pl-3'}`}>
            <div className="text-slate-100 truncate max-w-md" title={r.name}>{r.name}</div>
            <div className="text-[10px] text-slate-500 font-mono">{r.id}{!r.hasData && <span className="text-amber-500"> · no data</span>}</div>
          </td>
          {cells({ p: r.p, budget: r.budget, id: r.id, name: r.name })}
        </tr>
      ))}
    </>
  );
}
