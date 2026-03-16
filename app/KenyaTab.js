'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  RefreshCw, FileSpreadsheet, Download, Calendar, AlertCircle,
  CheckCircle2, FileDown, Table2
} from 'lucide-react';

// ─── Template column definitions (exact Diageo Publisher Data template order) ─
const COLS = [
  { key: 'date',          label: 'Date',                        w: 100 },
  { key: 'currency',      label: 'Currency Spend is Entered In', w: 90  },
  { key: 'siteName',      label: 'Site Name',                   w: 100 },
  { key: 'campaignName',  label: 'Campaign Name',               w: 400 },
  { key: 'placementName', label: 'Placement Name',              w: 500 },
  { key: 'packageName',   label: 'Package Name',                w: 130 },
  { key: 'creativeName',  label: 'Creative Name',               w: 130 },
  { key: 'netSpend',      label: 'Net Spend',                   w: 100, fmt: 'num4' },
  { key: 'impressions',   label: 'Impressions',                 w: 110, fmt: 'int'  },
  { key: 'clicks',        label: 'Clicks',                      w: 80,  fmt: 'int'  },
  { key: 'engagements',   label: 'Engagements',                 w: 110, fmt: 'int'  },
  { key: 'videoViews',    label: 'Video Views',                 w: 100, fmt: 'int'  },
  { key: 'videoStarts',   label: 'Video Starts',                w: 100, fmt: 'int'  },
  { key: 'video3sec',     label: 'Video 3 Sec View',            w: 120, fmt: 'int'  },
  { key: 'video25',       label: 'Video Complete (25%)',        w: 140, fmt: 'int'  },
  { key: 'video50',       label: 'Video Complete (50%)',        w: 140, fmt: 'int'  },
  { key: 'video75',       label: 'Video Complete (75%)',        w: 140, fmt: 'int'  },
  { key: 'video100',      label: 'Video Complete (100%)',       w: 150, fmt: 'int'  },
  { key: 'vcr',           label: 'Video Completion Rate (VCR)', w: 160, fmt: 'pct'  },
  { key: 'appDownloads',  label: 'App Downloads',               w: 120, fmt: 'int'  },
  { key: 'custom1',       label: 'Custom Performance Metric 1', w: 180, fmt: 'int'  },
  { key: 'custom2',       label: 'Custom Performance Metric 2', w: 180, fmt: 'int'  },
  { key: 'cpm',           label: 'CPM',                         w: 90,  fmt: 'num4' },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toYMD(d)        { return d.toISOString().split('T')[0]; }
function todayStr()      { return toYMD(new Date()); }
function firstOfMonth()  { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 1)); }
function lastNDays(n)    { const d = new Date(); d.setDate(d.getDate() - n + 1); return toYMD(d); }
function lastMonthStart(){ const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth()-1, 1)); }
function lastMonthEnd()  { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 0)); }

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCell(val, fmt) {
  if (val == null || val === '') return '';
  if (fmt === 'num4') return Number(val).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (fmt === 'int')  return Number(val).toLocaleString('en-US');
  if (fmt === 'pct')  return `${(Number(val) * 100).toFixed(2)}%`;
  return String(val);
}

// ─── Load SheetJS ─────────────────────────────────────────────────────────────
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ─── Excel export — matches Diageo Publisher Data template exactly ─────────────
async function exportExcel(rows, startDate, endDate) {
  const XLSX   = await loadXLSX();
  const today  = new Date();
  const dateTag = `${String(today.getFullYear()).slice(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  const fileName = `LinkedIn_${dateTag}`;

  // Row 1: instructions (match template)
  const instr = [
    'Data must be broken out by day (daily break down). No ranges in the Date field.\nMM/DD/YYYYY',
    'Required (Should align with the taxonomy currency code)',
    'Please include your publisher or site name',
    'There should be no extra white spaces in campaign and placement name. Please use our taxonomy for campaign and placement name.',
    'There should be no extra white spaces in campaign and placement name. Please use our taxonomy for campaign and placement name.',
    'If available', 'If available', 'Required', 'Required', 'If applicable',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If applicable', 'If applicable', 'If applicable',
    'Columns in Red are indicator/flag fields. Please do not edit these columns as they are formulas and help spot check for variances in taxonomy.',
    null, null, null,
  ];

  // Row 2: column headers
  const headers = COLS.map(c => c.label);

  // Data rows
  const dataRows = rows.map(r => COLS.map(col => {
    const v = r[col.key];
    if (v == null) return null;
    if (col.fmt === 'num4' || col.fmt === 'int') return typeof v === 'number' ? v : parseFloat(v) || 0;
    if (col.fmt === 'pct') return v;
    return v;
  }));

  const wsData = [instr, headers, ...dataRows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols']  = COLS.map(c => ({ wch: Math.round(c.w / 6) }));

  // Format header row (row index 1 = second row)
  const range = XLSX.utils.decode_range(ws['!ref']);
  COLS.forEach((col, C) => {
    const addr = XLSX.utils.encode_cell({ r: 1, c: C });
    if (!ws[addr]) return;
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '2E4057' } },
      alignment: { horizontal: 'center', wrapText: true },
    };
  });

  // Format data cells
  for (let R = 2; R <= range.e.r; R++) {
    COLS.forEach((col, C) => {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) return;
      if (col.fmt === 'num4') ws[addr].z = '0.0000';
      if (col.fmt === 'int')  ws[addr].z = '#,##0';
      if (col.fmt === 'pct')  ws[addr].z = '0.00%';
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Capture');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

// ─── CSV export ───────────────────────────────────────────────────────────────
function exportCSV(rows, startDate, endDate) {
  const today  = new Date();
  const dateTag = `${String(today.getFullYear()).slice(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  const fileName = `LinkedIn_${dateTag}.csv`;

  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [
    COLS.map(c => escape(c.label)).join(','),
    ...rows.map(r => COLS.map(col => {
      const v = r[col.key];
      if (v == null) return '';
      if (col.fmt === 'pct') return (Number(v) * 100).toFixed(2) + '%';
      return escape(v);
    }).join(',')),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}

// ─── Summary stats ────────────────────────────────────────────────────────────
function computeTotals(rows) {
  return rows.reduce((t, r) => ({
    netSpend:    t.netSpend    + (r.netSpend    || 0),
    impressions: t.impressions + (r.impressions || 0),
    clicks:      t.clicks      + (r.clicks      || 0),
    videoViews:  t.videoViews  + (r.videoViews  || 0),
    video100:    t.video100    + (r.video100     || 0),
  }), { netSpend: 0, impressions: 0, clicks: 0, videoViews: 0, video100: 0 });
}

// ─── Main KenyaTab ────────────────────────────────────────────────────────────
export default function KenyaTab() {
  const { data: session } = useSession();

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate,   setEndDate]   = useState(todayStr);
  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [progress, setProgress]   = useState({ pct: 0, processed: 0, total: 0, rowsSoFar: 0, message: '' });
  const [search,   setSearch]     = useState('');

  const quickDates = [
    { label: 'This Month', fn: () => { setStartDate(firstOfMonth()); setEndDate(todayStr()); } },
    { label: 'Last Month', fn: () => { setStartDate(lastMonthStart()); setEndDate(lastMonthEnd()); } },
    { label: 'Last 7d',    fn: () => { setStartDate(lastNDays(7));  setEndDate(todayStr()); } },
    { label: 'Last 30d',   fn: () => { setStartDate(lastNDays(30)); setEndDate(todayStr()); } },
    { label: 'Today',      fn: () => { setStartDate(todayStr()); setEndDate(todayStr()); } },
  ];

  // Auto-load when session is ready
  useEffect(() => {
    if (session) fetchData();
  }, [session]);

  const [warning, setWarning] = useState('');

  async function fetchData() {
    if (!session) return;
    setLoading(true); setError(''); setWarning('');
    setProgress({ pct: 0, processed: 0, total: 15, rowsSoFar: 0, message: 'Connecting to LinkedIn…' });

    try {
      const res = await fetch('/api/kenya', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalRows = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.error) throw new Error(msg.error);

            // All phases send pct + message directly now
            if (msg.pct != null || msg.message) {
              setProgress(p => ({
                ...p,
                pct:       msg.pct       ?? p.pct,
                message:   msg.message   ?? p.message,
                processed: msg.processed ?? p.processed,
                total:     msg.total     ?? p.total,
                rowsSoFar: msg.rowsSoFar ?? p.rowsSoFar,
              }));
            }

            if (msg.done && Array.isArray(msg.rows)) {
              finalRows = msg.rows;
              if (msg.warning) setWarning(msg.warning);
            }
          } catch (e) {
            if (e.message !== 'Unexpected end of JSON input') throw e;
          }
        }
      }

      if (!finalRows) throw new Error('Stream ended without data. Try again or check your date range.');
      setRows(finalRows);
      setLastRefresh(new Date());
      setProgress(p => ({ ...p, pct: 100, message: `Complete — ${finalRows.length} rows loaded` }));
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  const filteredRows = rows.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [r.campaignName, r.placementName, r.date, r.siteName]
      .some(v => v && String(v).toLowerCase().includes(s));
  });

  const totals = computeTotals(filteredRows);
  const ctr    = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0.00';
  const cpm    = totals.impressions > 0 ? ((totals.netSpend / totals.impressions) * 1000).toFixed(4) : '0.0000';

  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* ══ TOOLBAR ══ */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center gap-2 flex-wrap shrink-0">

        {/* Title badge */}
        <div className="flex items-center gap-2 mr-1">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
          <span className="text-sm font-bold text-white">Kenya Publisher Data</span>
          <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded-full">Diageo Template</span>
          <span className="text-xs text-slate-500">LinkedIn · 15 campaigns</span>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search campaign / placement…"
            className="pl-3 pr-7 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-56" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1.5 text-slate-400 hover:text-white text-xs">✕</button>
          )}
        </div>

        {/* Refresh */}
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 disabled:opacity-40 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>

        {/* Export Excel */}
        <button disabled={filteredRows.length === 0}
          onClick={() => exportExcel(filteredRows, startDate, endDate)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
        </button>

        {/* Export CSV */}
        <button disabled={filteredRows.length === 0}
          onClick={() => exportCSV(filteredRows, startDate, endDate)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <FileDown className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* ══ DATE BAR ══ */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-4 py-2 flex items-center gap-3 flex-wrap shrink-0">
        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">From</label>
          <input type="date" value={startDate} max={endDate}
            onChange={e => setStartDate(e.target.value)}
            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">To</label>
          <input type="date" value={endDate} min={startDate} max={todayStr()}
            onChange={e => setEndDate(e.target.value)}
            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {quickDates.map(q => (
            <button key={q.label} onClick={q.fn}
              className="px-2.5 py-1 bg-slate-700 hover:bg-blue-700 text-slate-300 hover:text-white text-xs rounded-lg border border-slate-600 transition-colors">
              {q.label}
            </button>
          ))}
        </div>
        <button onClick={fetchData}
          className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors">
          Apply
        </button>
        {lastRefresh && (
          <span className="text-xs text-slate-500 ml-auto">Updated {lastRefresh.toLocaleTimeString()} · {filteredRows.length} rows</span>
        )}
      </div>

      {/* ══ SUMMARY BAR ══ */}
      {filteredRows.length > 0 && (
        <div className="bg-slate-900 border-b border-slate-700 px-4 py-1.5 flex items-center gap-5 text-xs flex-wrap shrink-0">
          <span className="text-slate-500">Net Spend: <span className="text-emerald-400 font-bold">${totals.netSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
          <span className="text-slate-500">Impressions: <span className="text-sky-300 font-bold">{totals.impressions.toLocaleString()}</span></span>
          <span className="text-slate-500">Clicks: <span className="text-white font-bold">{totals.clicks.toLocaleString()}</span></span>
          <span className="text-slate-500">CTR: <span className="text-yellow-300 font-mono">{ctr}%</span></span>
          <span className="text-slate-500">CPM: <span className="text-purple-300 font-mono">${cpm}</span></span>
          {totals.videoViews > 0 && <span className="text-slate-500">Video Views: <span className="text-pink-300 font-bold">{totals.videoViews.toLocaleString()}</span></span>}
          <span className="text-slate-500 ml-auto">
            File name: <span className="text-slate-300 font-mono text-xs">
              LinkedIn_{`${String(new Date().getFullYear()).slice(2)}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}`}
            </span>
          </span>
        </div>
      )}

      {/* ══ WARNING BANNER ══ */}
      {warning && !loading && (
        <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-4 py-2 flex items-start gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-300">{warning}</p>
        </div>
      )}

      {/* ══ CONTENT ══ */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
            <RefreshCw className="w-10 h-10 text-green-500 animate-spin" />
            <div className="w-full max-w-md space-y-2">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>{progress.message || 'Fetching Kenya campaign data…'}</span>
                <span className="font-mono text-green-400">{progress.pct}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                <div className="h-2.5 rounded-full transition-all duration-500 bg-green-500"
                  style={{ width: `${progress.pct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>{progress.processed}/{progress.total} campaigns</span>
                {progress.rowsSoFar > 0 && <span>{progress.rowsSoFar} rows so far</span>}
              </div>
            </div>
            <p className="text-xs text-slate-600">{startDate} → {endDate}</p>
          </div>

        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="flex items-center gap-2 text-red-400 bg-red-900/20 px-4 py-3 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
            <button onClick={fetchData}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg">
              Retry
            </button>
          </div>

        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
            <Table2 className="w-12 h-12 opacity-20" />
            <p className="text-sm">No data for this date range</p>
            <p className="text-xs text-center max-w-sm text-slate-600">
              Select a date range that covers your Kenya campaigns (Jul 2025 – Mar 2026) and click Apply.
            </p>
          </div>

        ) : (
          <table className="border-collapse text-xs" style={{ minWidth: 'max-content', width: '100%' }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th key={col.key} style={{
                    minWidth: col.w,
                    background: '#2e4057',
                    color: '#fff',
                    position: 'sticky', top: 0, zIndex: 10,
                    whiteSpace: 'nowrap', padding: '6px 8px',
                    textAlign: col.fmt ? 'right' : 'left',
                    fontWeight: 700,
                    borderRight: '1px solid rgba(255,255,255,0.1)',
                    borderBottom: '2px solid rgba(0,0,0,0.4)',
                    fontSize: 11,
                  }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => (
                <tr key={`${row.date}-${row.campaignName}-${i}`}
                  style={{ background: i % 2 === 0 ? '#1e293b' : '#172033' }}
                  className="hover:brightness-110">
                  {COLS.map(col => {
                    const val = row[col.key];
                    const isNum = col.fmt && val != null && val !== '';
                    return (
                      <td key={col.key} style={{
                        minWidth: col.w,
                        maxWidth: col.w + 100,
                        padding: '4px 8px',
                        borderRight: '1px solid rgba(100,116,139,0.2)',
                        borderBottom: '1px solid rgba(100,116,139,0.15)',
                        textAlign: isNum ? 'right' : 'left',
                        color: col.key === 'netSpend' ? '#34d399'
                             : col.key === 'impressions' ? '#7dd3fc'
                             : col.key === 'clicks' ? '#fde68a'
                             : col.key === 'cpm' ? '#d8b4fe'
                             : val == null ? '#334155'
                             : '#e2e8f0',
                        fontFamily: col.fmt ? 'monospace' : 'inherit',
                        whiteSpace: col.key === 'campaignName' || col.key === 'placementName' ? 'nowrap' : 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={val != null ? String(val) : ''}
                      >
                        {val == null ? <span style={{ color: '#334155' }}>—</span> : fmtCell(val, col.fmt)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#0f172a', borderTop: '2px solid #475569' }}>
                {COLS.map((col, i) => {
                  const showTotal = ['netSpend','impressions','clicks','videoViews','video100'].includes(col.key);
                  return (
                    <td key={col.key} style={{
                      minWidth: col.w, padding: '5px 8px',
                      borderRight: '1px solid rgba(100,116,139,0.3)',
                      color: showTotal ? '#34d399' : '#475569',
                      fontWeight: showTotal ? 700 : 400,
                      fontFamily: 'monospace',
                      textAlign: col.fmt ? 'right' : 'left',
                      position: 'sticky', bottom: 0, zIndex: 5, background: '#0f172a',
                    }}>
                      {i === 0
                        ? `TOTAL (${filteredRows.length} rows)`
                        : showTotal
                          ? fmtCell(totals[col.key], col.fmt)
                          : ''}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}