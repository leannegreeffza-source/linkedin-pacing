'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, FileSpreadsheet, Eye, EyeOff, Search, X, Upload, ChevronDown } from 'lucide-react';

// ─── Column definitions (exact order from 202602 BOD with PMF) ───────────────
// source: 'blue' = LinkedIn API (FF00B0F0 fill), 'black' = Reference Sheet
const COLS = [
  { key: 'accountId',         label: 'Account ID',          source: 'blue',  w: 115 },
  { key: 'campaignGroupId',   label: 'Campaign Group ID',   source: 'blue',  w: 140 },
  { key: 'category',          label: 'Category',            source: 'black', w: 140 },
  { key: 'io',                label: 'IO',                  source: 'black', w: 90  },
  { key: 'partner',           label: 'Partner',             source: 'black', w: 80  },
  { key: 'staffCode',         label: 'Staff Code',          source: 'black', w: 80  },
  { key: 'billingAgency',     label: 'Agency (BILL)',       source: 'black', w: 200 },
  { key: 'bookingAgency',     label: 'Booking Agency',      source: 'black', w: 200 },
  { key: 'advertiser',        label: 'Advertiser',          source: 'black', w: 170 },
  { key: 'campaignName',      label: 'Campaign name',       source: 'blue',  w: 260 },
  { key: 'campaignGroupName', label: 'Campaign group name', source: 'blue',  w: 220 },
  { key: 'industry',          label: 'Industry',            source: 'black', w: 130 },
  { key: 'io2',               label: 'IO',                  source: 'black', w: 90  },
  { key: 'ciNumber',          label: 'CI #',                source: 'black', w: 120 },
  { key: 'campStartDate',     label: 'Start Date',          source: 'black', w: 100 },
  { key: 'campEndDate',       label: 'End Date',            source: 'black', w: 100 },
  { key: 'adUnit',            label: 'Ad Unit',             source: 'blue',  w: 120 },
  { key: 'itemCode',          label: 'Item code',           source: 'black', w: 200 },
  { key: 'localSpend',        label: 'Local Spend',         source: 'blue',  w: 110, fmt: 'num2' },
  { key: 'mediaSpendUSD',     label: 'Media Spend USD',     source: 'blue',  w: 120, fmt: 'num2' },
  { key: 'pmfPercentage',     label: 'PMF Percentage',      source: 'black', w: 115, fmt: 'pct'  },
  { key: 'pmfUSD',            label: 'PMF USD',             source: 'black', w: 100, fmt: 'num2' },
  { key: 'exchangeRate',      label: 'Exchange Rate',       source: 'black', w: 110, fmt: 'num2' },
  { key: 'mediaSpendZAR',     label: 'Media Spend ZAR',     source: 'black', w: 130, fmt: 'num2' },
  { key: 'pmfZAR',            label: 'PMF ZAR',             source: 'black', w: 100, fmt: 'num2' },
  { key: 'currencySpend',     label: 'Currency spend',      source: 'black', w: 110 },
  { key: 'grossZAR',          label: 'Gross ZAR',           source: 'black', w: 120, fmt: 'num2' },
  { key: 'pmfPct',            label: 'PMF %',               source: 'black', w: 80,  fmt: 'pct'  },
  { key: 'specialNotes',      label: 'Special Notes',       source: 'black', w: 200 },
];

const BLUE_HDR = '#00B0F0';
const BLACK_HDR = '#595959';
const BLUE_CELL = '#e6f7ff';
const WHITE_CELL = '#ffffff';

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCell(val, fmt) {
  if (val == null || val === '') return '';
  if (fmt === 'num2') return Number(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (fmt === 'pct') return `${(Number(val) * 100).toFixed(2)}%`;
  return String(val);
}

// ─── Computed columns (derived from base fields) ──────────────────────────────
function computeRow(r, exchangeRate) {
  const pmfUSD       = (r.mediaSpendUSD || 0) * (r.pmfPercentage || 0);
  const mediaSpendZAR = (r.mediaSpendUSD || 0) * exchangeRate;
  const pmfZAR       = pmfUSD * exchangeRate;
  const grossZAR     = mediaSpendZAR + pmfZAR;
  return {
    ...r,
    partner:       'LinkedIn',
    io2:           r.io || '',
    itemCode:      `${r.accountId}_${r.campaignGroupId}_ME`,
    exchangeRate,
    pmfUSD,
    mediaSpendZAR,
    pmfZAR,
    currencySpend: 'USD',
    grossZAR,
    pmfPct:        r.pmfPercentage || 0,
  };
}

// ─── LocalStorage helpers ─────────────────────────────────────────────────────
const LS_REF   = 'bod_ref_data_v1';
const LS_EXCL  = 'bod_excluded_ids';
const LS_RATE  = 'bod_exchange_rate';

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── Excel export (SheetJS) ───────────────────────────────────────────────────
async function exportToExcel(computedRows, startDate, endDate) {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const XLSX = window.XLSX;

  // Header row
  const wsData = [COLS.map(c => c.label)];

  // Data rows — exact column order, exact types
  computedRows.forEach(row => {
    wsData.push(COLS.map(col => {
      const v = row[col.key];
      if (v == null) return '';
      if (col.fmt === 'num2') return typeof v === 'number' ? v : parseFloat(v) || 0;
      if (col.fmt === 'pct')  return typeof v === 'number' ? v : parseFloat(v) || 0;
      return v;
    }));
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws['!cols'] = COLS.map(c => ({ wch: Math.round(c.w / 6.5) }));

  // Number/pct formats on data cells
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = 1; R <= range.e.r; R++) {
    COLS.forEach((col, C) => {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) return;
      if (col.fmt === 'num2') ws[addr].z = '#,##0.00';
      if (col.fmt === 'pct')  ws[addr].z = '0.00%';
    });
  }

  // Header styles (requires xlsx-style or write-excel-file; we use basic approach)
  // SheetJS community doesn't support full cell styling so we set fill via s property
  // which is partially supported in write with bookType xlsx
  COLS.forEach((col, C) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[addr]) return;
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: col.source === 'blue' ? '00B0F0' : '595959' } },
      alignment: { horizontal: 'center', wrapText: false },
      border: {
        bottom: { style: 'thin', color: { rgb: '000000' } },
        right:  { style: 'thin', color: { rgb: '000000' } },
      },
    };
  });

  const monthStr = startDate ? startDate.slice(0, 7).replace('-', '') : 'BOD';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${monthStr} BOD with PMF`);
  XLSX.writeFile(wb, `${monthStr}_BOD_with_PMF.xlsx`);
}

// ─── Parse uploaded reference Excel ──────────────────────────────────────────
async function parseRefExcel(file) {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: true });
        // Find the reference sheet
        const sheetName =
          wb.SheetNames.find(n => n.includes('Reference') || n.includes('Ref')) ||
          wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

        const map = {};   // keyed by "accountId_groupId"
        const byAcc = {}; // fallback keyed by accountId only
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const acc = r[0] ? String(r[0]).trim() : '';
          if (!acc || !/^\d+$/.test(acc)) continue;
          let grp = '0';
          try { if (r[1] && !isNaN(Number(r[1]))) grp = String(Math.round(Number(r[1]))); } catch {}
          const entry = {
            io:            r[2]  ? String(r[2]).trim()  : '',
            staffCode:     r[4]  ? String(r[4]).trim()  : '',
            billingAgency: r[6]  ? String(r[6]).trim()  : '',
            bookingAgency: r[7]  ? String(r[7]).trim()  : '',
            advertiser:    r[8]  ? String(r[8]).trim()  : '',
            industry:      r[9]  ? String(r[9]).trim()  : '',
            poNumber:      r[12] ? String(r[12]).trim() : '',
            category:      r[13] ? String(r[13]).trim() : '',
            pmfPercentage: r[15] ? parseFloat(r[15]) || 0 : 0,
            specialNotes:  r[17] ? String(r[17]).trim() : '',
          };
          const key = `${acc}_${grp}`;
          if (!map[key]) map[key] = entry;
          if (!byAcc[acc]) byAcc[acc] = entry;
        }
        resolve({ byAccGrp: map, byAcc });
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── Apply ref data to raw LinkedIn rows ──────────────────────────────────────
function applyRef(rawRows, ref) {
  return rawRows.map(r => {
    const key = `${r.accountId}_${r.campaignGroupId}`;
    const d = ref.byAccGrp?.[key] || ref.byAcc?.[r.accountId] || {};
    return {
      ...r,
      category:      d.category      || '',
      io:            d.io            || '',
      staffCode:     d.staffCode     || '',
      billingAgency: d.billingAgency || '',
      bookingAgency: d.bookingAgency || '',
      advertiser:    d.advertiser    || '',
      industry:      d.industry      || '',
      io2:           d.io            || '',
      ciNumber:      d.poNumber      || '',
      pmfPercentage: d.pmfPercentage || 0,
      specialNotes:  d.specialNotes  || '',
    };
  });
}

// ─── Main BOD Tab ─────────────────────────────────────────────────────────────
export default function BODTab({ accounts = [], startDate, endDate }) {
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [ref, setRef]               = useState({ byAccGrp: {}, byAcc: {} });
  const [refCount, setRefCount]     = useState(0);
  const [excludedIds, setExcludedIds] = useState([]);
  const [showAccMenu, setShowAccMenu] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(18);
  const [editRate, setEditRate]     = useState(false);
  const [rateInput, setRateInput]   = useState('18');
  const [search, setSearch]         = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const fileRef = useRef();
  const menuRef = useRef();

  // Load persisted state
  useEffect(() => {
    const savedRef = lsGet(LS_REF, null);
    if (savedRef) { setRef(savedRef); setRefCount(Object.keys(savedRef.byAccGrp || {}).length); }
    setExcludedIds(lsGet(LS_EXCL, []));
    const savedRate = lsGet(LS_RATE, 18);
    setExchangeRate(savedRate);
    setRateInput(String(savedRate));
  }, []);

  // Close account menu on outside click
  useEffect(() => {
    function handler(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setShowAccMenu(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function loadBOD() {
    const activeIds = accounts.filter(a => !excludedIds.includes(a.id)).map(a => a.id);
    if (activeIds.length === 0) { setRows([]); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: activeIds, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      const withRef = applyRef(data.rows || [], ref);
      setRows(withRef);
      setLastRefresh(new Date());
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // Auto-load when accounts/dates change
  useEffect(() => {
    if (accounts.length > 0) loadBOD();
  }, [accounts, startDate, endDate]);

  function toggleExclude(id) {
    setExcludedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      lsSet(LS_EXCL, next);
      return next;
    });
  }

  async function handleRefUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseRefExcel(file);
      setRef(parsed);
      setRefCount(Object.keys(parsed.byAccGrp || {}).length);
      lsSet(LS_REF, parsed);
      // Re-apply to current rows
      setRows(prev => applyRef(prev, parsed));
      alert(`✅ Reference data loaded: ${Object.keys(parsed.byAccGrp).length} entries`);
    } catch (err) {
      alert('❌ Failed to parse reference sheet: ' + err.message);
    }
    e.target.value = '';
  }

  function commitRate() {
    const r = parseFloat(rateInput);
    if (!isNaN(r) && r > 0) { setExchangeRate(r); lsSet(LS_RATE, r); }
    setEditRate(false);
  }

  // Filtered + computed rows
  const activeRows = rows.filter(r => !excludedIds.includes(String(r.accountId)));
  const filteredRows = activeRows.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [r.accountId, r.campaignGroupId, r.advertiser, r.campaignName, r.campaignGroupName, r.billingAgency]
      .some(v => v && String(v).toLowerCase().includes(s));
  });
  const computedRows = filteredRows.map(r => computeRow(r, exchangeRate));

  // Totals
  const totals = computedRows.reduce((t, r) => ({
    localSpend:     t.localSpend     + (r.localSpend     || 0),
    mediaSpendUSD:  t.mediaSpendUSD  + (r.mediaSpendUSD  || 0),
    pmfUSD:         t.pmfUSD         + (r.pmfUSD         || 0),
    mediaSpendZAR:  t.mediaSpendZAR  + (r.mediaSpendZAR  || 0),
    pmfZAR:         t.pmfZAR         + (r.pmfZAR         || 0),
    grossZAR:       t.grossZAR       + (r.grossZAR       || 0),
  }), { localSpend: 0, mediaSpendUSD: 0, pmfUSD: 0, mediaSpendZAR: 0, pmfZAR: 0, grossZAR: 0 });

  const TOTAL_KEYS = new Set(['localSpend', 'mediaSpendUSD', 'pmfUSD', 'mediaSpendZAR', 'pmfZAR', 'grossZAR']);

  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* ── Toolbar ── */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center gap-2 flex-wrap shrink-0">

        {/* Title */}
        <div className="flex items-center gap-2 mr-2">
          <FileSpreadsheet className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold text-white">BOD Report</span>
          <span className="text-xs text-slate-400 font-mono">{startDate} → {endDate}</span>
          {lastRefresh && <span className="text-xs text-slate-500">· {lastRefresh.toLocaleTimeString()}</span>}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mr-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: BLUE_HDR }} />
            <span className="text-xs text-slate-400">LinkedIn API</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-slate-500" />
            <span className="text-xs text-slate-400">Reference Sheet</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-8 pr-7 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1.5 text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Exchange Rate */}
        <div className="flex items-center gap-1.5 bg-slate-700 rounded-lg px-2.5 py-1.5 border border-slate-600">
          <span className="text-xs text-slate-400">USD/ZAR</span>
          {editRate ? (
            <input
              autoFocus value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              onBlur={commitRate}
              onKeyDown={e => { if (e.key === 'Enter') commitRate(); if (e.key === 'Escape') setEditRate(false); }}
              className="w-14 bg-slate-600 text-yellow-300 text-xs font-bold rounded px-1 py-0.5 focus:outline-none"
            />
          ) : (
            <button onClick={() => { setRateInput(String(exchangeRate)); setEditRate(true); }}
              className="text-xs font-bold text-yellow-300 hover:text-yellow-200 min-w-[2rem]">
              {exchangeRate}
            </button>
          )}
        </div>

        {/* Upload Ref Sheet */}
        <input type="file" ref={fileRef} accept=".xlsx,.xls" className="hidden" onChange={handleRefUpload} />
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 transition-colors">
          <Upload className="w-3.5 h-3.5" />
          {refCount > 0 ? `Ref (${refCount.toLocaleString()})` : 'Upload Ref Sheet'}
        </button>

        {/* Account Include/Exclude */}
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowAccMenu(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 transition-colors">
            <Eye className="w-3.5 h-3.5" />
            Accounts
            {excludedIds.length > 0 && (
              <span className="bg-red-600 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {excludedIds.length}
              </span>
            )}
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showAccMenu && (
            <div className="absolute right-0 top-9 z-30 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-72 p-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
                Include / Exclude Accounts
              </p>
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {accounts.map(a => {
                  const excl = excludedIds.includes(a.id);
                  return (
                    <div key={a.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        excl ? 'bg-red-900/30 border border-red-800/50' : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                      onClick={() => toggleExclude(a.id)}>
                      {excl
                        ? <EyeOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        : <Eye    className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      }
                      <span className={`text-xs flex-1 truncate ${excl ? 'text-red-300 line-through' : 'text-white'}`}>
                        {a.name}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">{a.id}</span>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => { setShowAccMenu(false); loadBOD(); }}
                className="w-full mt-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors">
                Apply & Reload
              </button>
            </div>
          )}
        </div>

        {/* Refresh */}
        <button onClick={loadBOD} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 disabled:opacity-40 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {/* Export Excel */}
        <button
          disabled={computedRows.length === 0}
          onClick={() => exportToExcel(computedRows, startDate, endDate)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Export Excel
        </button>
      </div>

      {/* ── Summary bar ── */}
      {computedRows.length > 0 && (
        <div className="bg-slate-900 border-b border-slate-700 px-4 py-2 flex items-center gap-5 text-xs flex-wrap shrink-0">
          <span className="text-slate-500 font-mono">{computedRows.length} rows</span>
          <span className="text-slate-500">Local Spend: <span className="text-white font-bold">{fmtCell(totals.localSpend, 'num2')}</span></span>
          <span className="text-slate-500">Media USD: <span className="text-sky-300 font-bold">${fmtCell(totals.mediaSpendUSD, 'num2')}</span></span>
          <span className="text-slate-500">PMF USD: <span className="text-white font-mono">${fmtCell(totals.pmfUSD, 'num2')}</span></span>
          <span className="text-slate-500">Media ZAR: <span className="text-yellow-300 font-bold">R{fmtCell(totals.mediaSpendZAR, 'num2')}</span></span>
          <span className="text-slate-500">PMF ZAR: <span className="text-white font-mono">R{fmtCell(totals.pmfZAR, 'num2')}</span></span>
          <span className="text-slate-500">Gross ZAR: <span className="text-emerald-400 font-bold">R{fmtCell(totals.grossZAR, 'num2')}</span></span>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-slate-400 text-sm">Loading BOD data from LinkedIn…</p>
            <p className="text-slate-500 text-xs">Fetching campaign groups for {accounts.filter(a => !excludedIds.includes(a.id)).length} account(s)</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-red-400 text-sm">Error: {error}</p>
          </div>
        ) : computedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
            <FileSpreadsheet className="w-12 h-12 opacity-20" />
            <p className="text-sm">No data for this period</p>
            <p className="text-xs">
              {refCount === 0
                ? 'Upload the Reference Sheet to populate black-field columns, then click Refresh'
                : 'Select accounts and date range, then click Refresh'}
            </p>
          </div>
        ) : (
          <table className="border-collapse text-xs" style={{ minWidth: 'max-content', width: '100%' }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    style={{
                      minWidth: col.w,
                      background: col.source === 'blue' ? BLUE_HDR : BLACK_HDR,
                      color: '#ffffff',
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      whiteSpace: 'nowrap',
                      padding: '6px 8px',
                      textAlign: 'left',
                      fontWeight: 700,
                      borderRight: '1px solid rgba(255,255,255,0.15)',
                      borderBottom: '2px solid rgba(0,0,0,0.3)',
                      fontSize: 11,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {computedRows.map((row, i) => (
                <tr
                  key={`${row.accountId}-${row.campaignGroupId}-${row.campaignName}-${i}`}
                  style={{ background: i % 2 === 0 ? '#1e293b' : '#172033' }}
                  className="hover:brightness-110 transition-all"
                >
                  {COLS.map(col => {
                    const val = row[col.key];
                    const isBlue = col.source === 'blue';
                    return (
                      <td
                        key={col.key}
                        style={{
                          minWidth: col.w,
                          maxWidth: col.w + 60,
                          padding: '4px 8px',
                          borderRight: '1px solid rgba(100,116,139,0.2)',
                          borderBottom: '1px solid rgba(100,116,139,0.15)',
                          color: isBlue ? '#7dd3fc' : '#e2e8f0',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontFamily: col.fmt ? 'monospace' : 'inherit',
                        }}
                        title={val != null ? String(val) : ''}
                      >
                        {fmtCell(val, col.fmt)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {/* Totals footer */}
            <tfoot>
              <tr style={{ background: '#0f172a', borderTop: '2px solid #475569' }}>
                {COLS.map((col, i) => (
                  <td
                    key={col.key}
                    style={{
                      minWidth: col.w,
                      padding: '5px 8px',
                      borderRight: '1px solid rgba(100,116,139,0.3)',
                      color: TOTAL_KEYS.has(col.key) ? '#34d399' : '#94a3b8',
                      fontWeight: TOTAL_KEYS.has(col.key) ? 700 : 400,
                      fontFamily: 'monospace',
                      whiteSpace: 'nowrap',
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 5,
                      background: '#0f172a',
                    }}
                  >
                    {i === 0
                      ? `TOTAL (${computedRows.length})`
                      : TOTAL_KEYS.has(col.key)
                        ? fmtCell(totals[col.key], 'num2')
                        : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}