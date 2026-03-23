'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  RefreshCw, FileSpreadsheet, Calendar, AlertCircle,
  FileDown, Table2, ChevronDown, Check, Search, X,
  Users, BarChart2, Info, BookTemplate
} from 'lucide-react';

const COLS = [
  { key: 'date',          label: 'Date',                         w: 100 },
  { key: 'currency',      label: 'Currency Spend is Entered In', w: 90  },
  { key: 'siteName',      label: 'Site Name',                    w: 100 },
  { key: 'campaignName',  label: 'Campaign Name',                w: 400 },
  { key: 'placementName', label: 'Placement Name',               w: 500 },
  { key: 'packageName',   label: 'Package Name',                 w: 130 },
  { key: 'creativeName',  label: 'Creative Name',                w: 130 },
  { key: 'netSpend',      label: 'Net Spend',                    w: 110, fmt: 'num4' },
  { key: 'impressions',   label: 'Impressions',                  w: 110, fmt: 'int'  },
  { key: 'clicks',        label: 'Clicks',                       w: 80,  fmt: 'int'  },
  { key: 'engagements',   label: 'Engagements',                  w: 110, fmt: 'int'  },
  { key: 'videoViews',    label: 'Video Views',                  w: 100, fmt: 'int'  },
  { key: 'videoStarts',   label: 'Video Starts',                 w: 100, fmt: 'int'  },
  { key: 'video3sec',     label: 'Video 3 Sec View',             w: 120, fmt: 'int'  },
  { key: 'video25',       label: 'Video Complete (25%)',         w: 140, fmt: 'int'  },
  { key: 'video50',       label: 'Video Complete (50%)',         w: 140, fmt: 'int'  },
  { key: 'video75',       label: 'Video Complete (75%)',         w: 140, fmt: 'int'  },
  { key: 'video100',      label: 'Video Complete (100%)',        w: 150, fmt: 'int'  },
  { key: 'vcr',           label: 'Video Completion Rate (VCR)',  w: 160, fmt: 'pct'  },
  { key: 'appDownloads',  label: 'App Downloads',                w: 120, fmt: 'int'  },
  { key: 'custom1',       label: 'Custom Performance Metric 1',  w: 180, fmt: 'int'  },
  { key: 'custom2',       label: 'Custom Performance Metric 2',  w: 180, fmt: 'int'  },
  { key: 'cpm',           label: 'CPM',                          w: 90,  fmt: 'num4' },
];

function toYMD(d)         { return d.toISOString().split('T')[0]; }
function todayStr()       { return toYMD(new Date()); }
function firstOfMonth()   { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 1)); }
function lastNDays(n)     { const d = new Date(); d.setDate(d.getDate() - n + 1); return toYMD(d); }
function lastMonthStart() { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth()-1, 1)); }
function lastMonthEnd()   { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 0)); }

function fmtCell(val, fmt) {
  if (val == null || val === '') return '';
  if (fmt === 'num4') return Number(val).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (fmt === 'int')  return Number(val).toLocaleString('en-US');
  if (fmt === 'pct')  return `${(Number(val) * 100).toFixed(2)}%`;
  return String(val);
}

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ── Diageo brand taxonomy ──────────────────────────────────────────────────
// Brand name is the 6th segment of campaign name split by |
// e.g. STO-306|SN|Saracen|Diageo|LI|Singleton_Q3... → "Singleton"
const BRAND_TAXONOMY = {
  'Singleton':    '123',
  'Johnnie Walker': '124',
  'JW':           '124',
  'Johnniewalker':'124',
  'Whitecap':     '125',
  'Don Julio':    '126',
  'DonJulio':     '126',
  'Baileys':      '127',
  'Smirnoff':     '128',
  'Tanqueray':    '129',
  'Gordons':      '130',
  'Gordon':       '130',
  'Captain Morgan':'131',
  'Tusker':       '132',
  'Senator':      '133',
  'Chrome':       '134',
};

function getBrand(campaignName) {
  // Split by | and take 6th segment (index 5), then take part before first _
  const parts = (campaignName || '').split('|');
  if (parts.length < 6) return null;
  return parts[5].split('_')[0].trim();
}

function getTaxonomyCode(brand, customCodes) {
  if (!brand) return '';
  const key = Object.keys({ ...BRAND_TAXONOMY, ...customCodes }).find(
    k => k.toLowerCase() === brand.toLowerCase()
  );
  return key ? ({ ...BRAND_TAXONOMY, ...customCodes })[key] : '';
}

function getWeeksInData(rows) {
  // Returns list of week ranges (Mon–Sun) covering the data dates
  const dates = rows
    .map(r => { const [m,d,y] = r.date.split('/'); return new Date(`${y}-${m}-${d}`); })
    .filter(d => !isNaN(d))
    .sort((a,b) => a-b);
  if (!dates.length) return [];
  const weeks = [];
  const seen = new Set();
  for (const d of dates) {
    const dow  = d.getDay(); // 0=Sun
    const mon  = new Date(d); mon.setDate(d.getDate() - ((dow + 6) % 7));
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    const key  = mon.toISOString().slice(0,10);
    if (!seen.has(key)) {
      seen.add(key);
      const fmt = dt => `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}/${dt.getFullYear()}`;
      weeks.push({ key, label: `${fmt(mon)} – ${fmt(sun)}`, start: mon, end: sun });
    }
  }
  return weeks;
}

async function exportDiageoTemplate(rows, selectedWeeks, selectedBrands, customCodes) {
  const XLSX = await loadXLSX();
  const today = new Date();
  const tag   = `${String(today.getFullYear()).slice(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;

  // Filter rows by selected weeks and brands
  let filtered = rows.filter(r => {
    const [m,d,y] = r.date.split('/');
    const dt = new Date(`${y}-${m}-${d}`);
    const inWeek = selectedWeeks.length === 0 || selectedWeeks.some(w => dt >= w.start && dt <= w.end);
    const brand  = getBrand(r.campaignName);
    const inBrand = selectedBrands.length === 0 || selectedBrands.includes(brand);
    return inWeek && inBrand;
  });

  // Build rows with taxonomy prefix on campaign/placement name
  const dataRows = filtered.map(r => {
    const brand = getBrand(r.campaignName);
    const code  = getTaxonomyCode(brand, customCodes);
    const prefix = code ? `${code}_` : '';
    return [
      r.date,
      r.currency || 'USD',
      r.siteName  || 'LinkedIn',
      prefix + (r.campaignName  || ''),
      prefix + (r.placementName || ''),
      r.packageName  || null,
      r.creativeName || null,
      r.netSpend    != null ? r.netSpend    : null,
      r.impressions != null ? r.impressions : null,
      r.clicks      != null ? r.clicks      : null,
      r.engagements != null ? r.engagements : null,
      r.videoViews  != null ? r.videoViews  : null,
      r.videoStarts != null ? r.videoStarts : null,
      r.video3sec   != null ? r.video3sec   : null,
      r.video25     != null ? r.video25     : null,
      r.video50     != null ? r.video50     : null,
      r.video75     != null ? r.video75     : null,
      r.video100    != null ? r.video100    : null,
      r.vcr         != null ? r.vcr         : null,
      r.appDownloads != null ? r.appDownloads : null,
      r.custom1     != null ? r.custom1     : null,
      r.custom2     != null ? r.custom2     : null,
    ];
  });

  const HEADERS = [
    'Date','Currency Spend is Entered In','Site Name','Campaign Name','Placement Name',
    'Package Name','Creative Name','Net Spend','Impressions','Clicks','Engagements',
    'Video Views','Video Starts','Video 3 Sec View','Video Complete (25%)','Video Complete (50%)',
    'Video Complete (75%)','Video Complete (100%)','Video Completion Rate (VCR)',
    'App Downloads','Custom Performance Metric 1','Custom Performance Metric 2',
  ];

  const INSTR = [
    'Data must be broken out by day (daily break down). No ranges in the Date field.\nMM/DD/YYYYY',
    'Required (Should align with the taxonomy currency code)',
    'Please include your publisher or site name',
    'There should be no extra white spaces in campaign and placement name. Please use our taxonomy for campaign and placement name.',
    'There should be no extra white spaces in campaign and placement name. Please use our taxonomy for campaign and placement name.',
    'If available','If available','Required','Required','If applicable',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If applicable','If applicable','If applicable',
  ];

  const ws = XLSX.utils.aoa_to_sheet([INSTR, HEADERS, ...dataRows]);

  // Column widths
  const colWidths = [12,28,14,60,60,18,18,12,14,10,14,12,12,16,20,20,20,20,24,14,26,26];
  ws['!cols'] = colWidths.map(w => ({ wch: w }));

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  // Row 1: instruction row — yellow fill, black bold text
  for (let C = 0; C <= 21; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[addr]) ws[addr] = { v: '', t: 's' };
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FF000000' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFE598' } },
      alignment: { wrapText: true, vertical: 'top' },
    };
  }

  // Row 2: header row — grey fill, bold black text
  for (let C = 0; C <= 21; C++) {
    const addr = XLSX.utils.encode_cell({ r: 1, c: C });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font:  { bold: true, color: { rgb: 'FF000000' } },
      fill:  { patternType: 'solid', fgColor: { rgb: 'C0C0C0' } },
      alignment: { horizontal: 'center', wrapText: true },
      border: {
        bottom: { style: 'medium', color: { rgb: 'FF000000' } },
      },
    };
  }

  // Data rows — number formatting
  // Col 7 = Net Spend ($), col 22 = CPM ($) — must use dollar format
  const fmtMap = {
    7:  '"$"#,##0.0000',   // Net Spend — dollar, 4dp
    8:  '#,##0',            // Impressions
    9:  '#,##0',            // Clicks
    10: '#,##0',            // Engagements
    11: '#,##0',            // Video Views
    12: '#,##0',            // Video Starts
    13: '#,##0',            // Video 3 Sec
    14: '#,##0',            // Video 25%
    15: '#,##0',            // Video 50%
    16: '#,##0',            // Video 75%
    17: '#,##0',            // Video 100%
    18: '0.00%',            // VCR
    19: '#,##0',            // App Downloads
  };
  for (let R = 2; R <= range.e.r; R++) {
    for (let C = 0; C <= 21; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      // Apply format AND preserve alternating row fill together
      const fmt  = fmtMap[C];
      const fill = R % 2 === 0 ? { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } } : undefined;
      ws[addr].s = fill ? { fill } : {};
      if (fmt) ws[addr].z = fmt;
    }
  }

  // Add CPM formula column (W = col 22) with red header like template
  const cpmHeader = XLSX.utils.encode_cell({ r: 1, c: 22 });
  ws[cpmHeader] = { v: 'CPM', t: 's', s: {
    font:  { bold: true, color: { rgb: 'FF000000' } },
    fill:  { patternType: 'solid', fgColor: { rgb: 'FF0000' } },
    alignment: { horizontal: 'center' },
  }};
  // Campaign Underscore Counter (col 23) — red
  const cuc = XLSX.utils.encode_cell({ r: 1, c: 23 });
  ws[cuc] = { v: 'Campaign Underscore Counter', t: 's', s: {
    font:  { bold: true, color: { rgb: 'FF000000' } },
    fill:  { patternType: 'solid', fgColor: { rgb: 'FF0000' } },
    alignment: { horizontal: 'center', wrapText: true },
  }};
  // Placement Underscore Counter (col 24)
  const puc = XLSX.utils.encode_cell({ r: 1, c: 24 });
  ws[puc] = { v: 'Placement Underscore Counter', t: 's', s: {
    font:  { bold: true, color: { rgb: 'FF000000' } },
    fill:  { patternType: 'solid', fgColor: { rgb: 'FF0000' } },
    alignment: { horizontal: 'center', wrapText: true },
  }};

  // Add formulas for CPM, underscore counters for each data row
  for (let R = 2; R <= range.e.r; R++) {
    const r1 = R + 1; // Excel is 1-indexed
    // CPM = Net Spend / (Impressions / 1000)
    const cpmCell = XLSX.utils.encode_cell({ r: R, c: 22 });
    ws[cpmCell] = { f: `IFERROR(H${r1}/(I${r1}/1000),0)`, t: 'n', z: '"$"#,##0.0000' };
    // Campaign underscore counter
    const cucCell = XLSX.utils.encode_cell({ r: R, c: 23 });
    ws[cucCell] = { f: `LEN(D${r1})-LEN(SUBSTITUTE(D${r1},"_",""))`, t: 'n' };
    // Placement underscore counter
    const pucCell = XLSX.utils.encode_cell({ r: R, c: 24 });
    ws[pucCell] = { f: `LEN(E${r1})-LEN(SUBSTITUTE(E${r1},"_",""))`, t: 'n' };
  }

  // Update range to include the 3 extra formula cols
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: 24 } });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Capture');
  XLSX.writeFile(wb, `Diageo_LinkedIn_${tag}.xlsx`);
}

async function exportExcel(rows) {
  const XLSX  = await loadXLSX();
  const today = new Date();
  const tag   = `${String(today.getFullYear()).slice(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;

  const instrRow = [
    'Data must be broken out by day (daily break down). No ranges in the Date field.\nMM/DD/YYYYY',
    'Required (Should align with the taxonomy currency code)',
    'Please include your publisher or site name',
    'There should be no extra white spaces in campaign and placement name. Please use our taxonomy for campaign and placement name.',
    'There should be no extra white spaces in campaign and placement name. Please use our taxonomy for campaign and placement name.',
    'If available','If available','Required','Required','If applicable',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If bought on CPE/CPV, Engagements & Views MUST be provided',
    'If applicable','If applicable','If applicable',
    'Columns in Red are indicator/flag fields.',
    null, null, null,
  ];

  const ws = XLSX.utils.aoa_to_sheet([
    instrRow,
    COLS.map(c => c.label),
    ...rows.map(r => COLS.map(col => {
      const v = r[col.key];
      if (v == null) return null;
      if (col.fmt === 'num4' || col.fmt === 'int') return typeof v === 'number' ? v : parseFloat(v) || 0;
      return v;
    })),
  ]);
  ws['!cols'] = COLS.map(c => ({ wch: Math.round(c.w / 6) }));

  COLS.forEach((_, C) => {
    const addr = XLSX.utils.encode_cell({ r: 1, c: C });
    if (!ws[addr]) return;
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '2E4057' } },
      alignment: { horizontal: 'center', wrapText: true },
    };
  });

  const range = XLSX.utils.decode_range(ws['!ref']);
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
  XLSX.writeFile(wb, `LinkedIn_${tag}.xlsx`);
}

function exportCSV(rows) {
  const today = new Date();
  const tag   = `${String(today.getFullYear()).slice(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
  const esc   = v => { if (v == null) return ''; const s = String(v); return (s.includes(',') || s.includes('"')) ? `"${s.replace(/"/g,'""')}"` : s; };
  const lines = [
    COLS.map(c => esc(c.label)).join(','),
    ...rows.map(r => COLS.map(col => { const v = r[col.key]; if (v == null) return ''; if (col.fmt === 'pct') return (Number(v)*100).toFixed(2)+'%'; return esc(v); }).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `LinkedIn_${tag}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function computeTotals(rows) {
  const n = rows.length || 1;
  const sum = rows.reduce((t, r) => ({
    netSpend:    t.netSpend    + (r.netSpend    || 0),
    impressions: t.impressions + (r.impressions || 0),
    clicks:      t.clicks      + (r.clicks      || 0),
    engagements: t.engagements + (r.engagements || 0),
    videoViews:  t.videoViews  + (r.videoViews  || 0),
    videoStarts: t.videoStarts + (r.videoStarts || 0),
    video25:     t.video25     + (r.video25     || 0),
    video50:     t.video50     + (r.video50     || 0),
    video75:     t.video75     + (r.video75     || 0),
    video100:    t.video100    + (r.video100     || 0),
    cpm:         t.cpm         + (r.cpm         || 0),
    vcrSum:      t.vcrSum      + (r.vcr != null ? r.vcr : 0),
    vcrCount:    t.vcrCount    + (r.vcr != null ? 1 : 0),
  }), { netSpend:0, impressions:0, clicks:0, engagements:0, videoViews:0, videoStarts:0, video25:0, video50:0, video75:0, video100:0, cpm:0, vcrSum:0, vcrCount:0 });

  return {
    ...sum,
    // Averages for % / rate columns
    vcr:    sum.vcrCount  > 0 ? sum.vcrSum  / sum.vcrCount  : null,
    cpmAvg: n             > 0 ? sum.cpm     / n             : null,
  };
}

export default function KenyaTab() {
  const { data: session } = useSession();

  const [accounts,     setAccounts]     = useState([]);
  const [loadingAccts, setLoadingAccts] = useState(false);
  const [selectedAcct, setSelectedAcct] = useState(null);
  const [showAcctMenu, setShowAcctMenu] = useState(false);
  const [acctSearch,   setAcctSearch]   = useState('');

  const [campaigns,    setCampaigns]    = useState([]);
  const [loadingCamps, setLoadingCamps] = useState(false);
  const [selectedCamps,setSelectedCamps]= useState([]);
  const [showCampMenu, setShowCampMenu] = useState(false);
  const [campSearch,   setCampSearch]   = useState('');

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate,   setEndDate]   = useState(todayStr);

  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [warning,     setWarning]     = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [progress,    setProgress]    = useState({ pct: 0, message: '', processed: 0, total: 0, rowsSoFar: 0 });
  const [tableSearch, setTableSearch] = useState('');
  const [showColInfo,  setShowColInfo]  = useState(false);
  const [showDiageo,   setShowDiageo]   = useState(false);
  const [diageoWeeks,  setDiageoWeeks]  = useState([]);    // selected week keys
  const [diageoB,      setDiageoB]      = useState([]);    // selected brand names
  const [customCodes,  setCustomCodes]  = useState({});    // user-editable brand→code map
  const [editingCode,  setEditingCode]  = useState(null);  // brand being edited

  const acctMenuRef = useRef();
  const campMenuRef = useRef();

  useEffect(() => {
    function h(e) {
      if (acctMenuRef.current && !acctMenuRef.current.contains(e.target)) setShowAcctMenu(false);
      if (campMenuRef.current && !campMenuRef.current.contains(e.target)) setShowCampMenu(false);
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoadingAccts(true);
    fetch('/api/kenya')
      .then(r => r.json())
      .then(data => { setAccounts(Array.isArray(data) ? data : []); setLoadingAccts(false); })
      .catch(() => setLoadingAccts(false));
  }, [session]);

  async function selectAccount(acct) {
    setSelectedAcct(acct); setShowAcctMenu(false);
    setSelectedCamps([]); setCampaigns([]); setRows([]); setError(''); setWarning('');
    if (!acct) return;
    setLoadingCamps(true);
    try {
      const res  = await fetch('/api/kenya', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: acct.id }),
      });
      const data = await res.json();
      const camps = data.campaigns || [];
      setCampaigns(camps);
      setSelectedCamps(camps);
    } catch (e) {
      setError('Failed to load campaigns: ' + e.message);
    }
    setLoadingCamps(false);
  }

  function toggleCampaign(camp) {
    setSelectedCamps(prev =>
      prev.find(c => c.id === camp.id) ? prev.filter(c => c.id !== camp.id) : [...prev, camp]
    );
  }

  async function fetchData() {
    if (!selectedCamps.length) { setError('Select at least one campaign.'); return; }
    setLoading(true); setError(''); setWarning('');
    setProgress({ pct: 0, message: `Fetching ${selectedCamps.length} campaign${selectedCamps.length !== 1 ? 's' : ''}…`, processed: 0, total: selectedCamps.length, rowsSoFar: 0 });

    try {
      const res = await fetch('/api/kenya', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId:   selectedAcct.id,
          campaignIds: selectedCamps.map(c => ({ id: c.id, name: c.name })),
          startDate, endDate,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }

      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = '', finalRows = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.error) throw new Error(msg.error);
            if (msg.pct != null || msg.message) setProgress(p => ({ pct: msg.pct ?? p.pct, message: msg.message ?? p.message, processed: msg.processed ?? p.processed, total: msg.total ?? p.total, rowsSoFar: msg.rowsSoFar ?? p.rowsSoFar }));
            if (msg.done && Array.isArray(msg.rows)) { finalRows = msg.rows; if (msg.warning) setWarning(msg.warning); }
          } catch (e) { if (e.message !== 'Unexpected end of JSON input') throw e; }
        }
      }
      if (!finalRows) throw new Error('No data received.');
      setRows(finalRows); setLastRefresh(new Date());
      setProgress(p => ({ ...p, pct: 100, message: `Complete — ${finalRows.length} rows` }));
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  const quickDates = [
    { label: 'This Month', fn: () => { setStartDate(firstOfMonth()); setEndDate(todayStr()); } },
    { label: 'Last Month', fn: () => { setStartDate(lastMonthStart()); setEndDate(lastMonthEnd()); } },
    { label: 'Last 7d',    fn: () => { setStartDate(lastNDays(7));  setEndDate(todayStr()); } },
    { label: 'Last 30d',   fn: () => { setStartDate(lastNDays(30)); setEndDate(todayStr()); } },
    { label: 'Today',      fn: () => { setStartDate(todayStr()); setEndDate(todayStr()); } },
  ];

  const filteredRows  = rows.filter(r => !tableSearch || [r.campaignName, r.placementName, r.date].some(v => v && String(v).toLowerCase().includes(tableSearch.toLowerCase())));
  const totals        = computeTotals(filteredRows);
  const ctr           = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0.00';
  const cpmAvg        = totals.impressions > 0 ? ((totals.netSpend / totals.impressions) * 1000).toFixed(4) : '0.0000';
  const filteredCamps = campaigns.filter(c => !campSearch || c.name.toLowerCase().includes(campSearch.toLowerCase()));
  const filteredAccts = accounts.filter(a => !acctSearch || a.name.toLowerCase().includes(acctSearch.toLowerCase()) || String(a.id).includes(acctSearch));
  const today         = new Date();
  const fileTag       = `${String(today.getFullYear()).slice(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;

  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* TOOLBAR */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center gap-2 flex-wrap shrink-0">

        <div className="flex items-center gap-2 mr-1">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
          <span className="text-sm font-bold text-white">Kenya Publisher Data</span>
          <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded-full">Diageo Template</span>
        </div>

        {/* Account picker */}
        <div className="relative" ref={acctMenuRef}>
          <button onClick={() => setShowAcctMenu(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${selectedAcct ? 'bg-blue-700 border-blue-600 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
            <Users className="w-3.5 h-3.5" />
            {loadingAccts ? 'Loading…' : selectedAcct ? <span className="max-w-[180px] truncate">{selectedAcct.name}</span> : `Select Account (${accounts.length})`}
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </button>
          {showAcctMenu && (
            <div className="absolute left-0 top-9 z-40 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 p-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Select Ad Account ({accounts.length})</p>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-400" />
                <input value={acctSearch} onChange={e => setAcctSearch(e.target.value)} placeholder="Search…"
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filteredAccts.map(a => (
                  <div key={a.id} onClick={() => selectAccount(a)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${selectedAcct?.id === a.id ? 'bg-blue-700' : 'bg-slate-700 hover:bg-slate-600'}`}>
                    {selectedAcct?.id === a.id && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate font-medium">{a.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{a.id}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Campaign picker */}
        {selectedAcct && (
          <div className="relative" ref={campMenuRef}>
            <button onClick={() => setShowCampMenu(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${selectedCamps.length > 0 ? 'bg-emerald-700 border-emerald-600 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
              <BarChart2 className="w-3.5 h-3.5" />
              {loadingCamps ? 'Loading campaigns…' : selectedCamps.length === campaigns.length && campaigns.length > 0 ? `All ${campaigns.length} campaigns` : `${selectedCamps.length} / ${campaigns.length} campaigns`}
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>
            {showCampMenu && (
              <div className="absolute left-0 top-9 z-40 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-[480px] p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Campaigns ({campaigns.length})</p>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedCamps([...campaigns])} className="text-xs text-blue-400 hover:text-blue-300">Select All</button>
                    <span className="text-slate-600">·</span>
                    <button onClick={() => setSelectedCamps([])} className="text-xs text-slate-400 hover:text-white">Clear</button>
                  </div>
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-400" />
                  <input value={campSearch} onChange={e => setCampSearch(e.target.value)} placeholder="Filter campaigns…"
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                  {filteredCamps.map(c => {
                    const sel = !!selectedCamps.find(s => s.id === c.id);
                    return (
                      <div key={c.id} onClick={() => toggleCampaign(c)}
                        className={`flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${sel ? 'bg-emerald-900/40 border border-emerald-700/50' : 'bg-slate-700 hover:bg-slate-600'}`}>
                        <div className={`w-4 h-4 mt-0.5 rounded shrink-0 border flex items-center justify-center ${sel ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>
                          {sel && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white leading-snug break-all">{c.name}</p>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">{c.id} · {c.status}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-slate-700">
                  <span className="text-xs text-slate-400">{selectedCamps.length} selected</span>
                  <button onClick={() => setShowCampMenu(false)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg">Done</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-400" />
          <input value={tableSearch} onChange={e => setTableSearch(e.target.value)} placeholder="Search table…"
            className="pl-8 pr-7 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44" />
          {tableSearch && <button onClick={() => setTableSearch('')} className="absolute right-2 top-1.5 text-slate-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
        </div>

        <button onClick={fetchData} disabled={loading || !selectedCamps.length}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Fetching…' : 'Pull Data'}
        </button>

        <button disabled={filteredRows.length === 0} onClick={() => exportExcel(filteredRows)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
        </button>

        <button disabled={filteredRows.length === 0} onClick={() => exportCSV(filteredRows)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <FileDown className="w-3.5 h-3.5" /> Export CSV
        </button>

        <button onClick={() => setShowColInfo(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${showColInfo ? 'bg-indigo-700 border-indigo-600 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
          <Info className="w-3.5 h-3.5" /> Columns
        </button>

        <button disabled={filteredRows.length === 0} onClick={() => { setShowDiageo(true); setDiageoWeeks([]); setDiageoB([]); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Diageo Template
        </button>
      </div>

      {/* ── DIAGEO TEMPLATE EXPORT MODAL ────────────────────────────────── */}
      {showDiageo && (() => {
        const allWeeks  = getWeeksInData(filteredRows);
        // Extract unique brands from current rows
        const allBrands = [...new Set(filteredRows.map(r => getBrand(r.campaignName)).filter(Boolean))].sort();
        const selWeeks  = allWeeks.filter(w => diageoWeeks.includes(w.key));
        const canExport = filteredRows.length > 0;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                <div>
                  <p className="text-sm font-bold text-white">Export Diageo Publisher Template</p>
                  <p className="text-xs text-slate-400 mt-0.5">Select week(s) and brand(s) — data will be filtered and formatted exactly to the Diageo FY26 template</p>
                </div>
                <button onClick={() => setShowDiageo(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>

              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

                {/* ── Week Selector ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">Select Week(s)</p>
                    <div className="flex gap-2">
                      <button onClick={() => setDiageoWeeks(allWeeks.map(w => w.key))} className="text-xs text-blue-400 hover:text-blue-300">All</button>
                      <span className="text-slate-600">·</span>
                      <button onClick={() => setDiageoWeeks([])} className="text-xs text-slate-400 hover:text-white">Clear</button>
                    </div>
                  </div>
                  {allWeeks.length === 0
                    ? <p className="text-xs text-slate-500 italic">No weeks detected — pull data first</p>
                    : <div className="grid grid-cols-2 gap-1.5">
                        {allWeeks.map(w => {
                          const sel = diageoWeeks.includes(w.key);
                          const cnt = filteredRows.filter(r => { const [m,d,y]=r.date.split('/'); const dt=new Date(`${y}-${m}-${d}`); return dt>=w.start&&dt<=w.end; }).length;
                          return (
                            <button key={w.key} onClick={() => setDiageoWeeks(prev => sel ? prev.filter(k=>k!==w.key) : [...prev, w.key])}
                              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors ${sel ? 'bg-blue-700 border-blue-600 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
                              <span>{w.label}</span>
                              <span className={`font-mono text-xs ${sel ? 'text-blue-200' : 'text-slate-500'}`}>{cnt} rows</span>
                            </button>
                          );
                        })}
                      </div>
                  }
                </div>

                {/* ── Brand Selector ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">Select Brand(s)</p>
                    <div className="flex gap-2">
                      <button onClick={() => setDiageoB([...allBrands])} className="text-xs text-blue-400 hover:text-blue-300">All</button>
                      <span className="text-slate-600">·</span>
                      <button onClick={() => setDiageoB([])} className="text-xs text-slate-400 hover:text-white">Clear</button>
                    </div>
                  </div>
                  {allBrands.length === 0
                    ? <p className="text-xs text-slate-500 italic">No brands detected in campaign names</p>
                    : <div className="grid grid-cols-3 gap-1.5">
                        {allBrands.map(brand => {
                          const sel  = diageoB.includes(brand);
                          const code = customCodes[brand] || BRAND_TAXONOMY[brand] || '';
                          return (
                            <div key={brand} className={`rounded-lg border transition-colors ${sel ? 'bg-emerald-900/40 border-emerald-700' : 'bg-slate-700 border-slate-600'}`}>
                              <button onClick={() => setDiageoB(prev => sel ? prev.filter(b=>b!==brand) : [...prev, brand])}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left">
                                <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${sel ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>
                                  {sel && <Check className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-white truncate">{brand}</p>
                                  {editingCode === brand
                                    ? <input
                                        autoFocus
                                        defaultValue={code}
                                        className="w-full text-xs bg-slate-600 border border-blue-500 rounded px-1 py-0.5 text-white font-mono focus:outline-none mt-0.5"
                                        onBlur={e => { setCustomCodes(p=>({...p,[brand]:e.target.value.trim()})); setEditingCode(null); }}
                                        onKeyDown={e => { if(e.key==='Enter'||e.key==='Escape'){setCustomCodes(p=>({...p,[brand]:e.target.value.trim()}));setEditingCode(null);}}}
                                        onClick={e => e.stopPropagation()}
                                      />
                                    : <p className="text-xs text-slate-400 font-mono mt-0.5 flex items-center gap-1">
                                        Code: <span className={`${code ? 'text-yellow-400' : 'text-slate-600'}`}>{code || '—'}</span>
                                        <button onClick={e=>{e.stopPropagation();setEditingCode(brand);}} className="text-slate-500 hover:text-blue-400 ml-1 text-xs">✏️</button>
                                      </p>
                                  }
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                  }
                  <p className="text-xs text-slate-500 mt-2">Click ✏️ to set/edit the taxonomy code for a brand. The code will be prefixed to campaign and placement names: <span className="text-yellow-400 font-mono">123_STO-306|SN|...</span></p>
                </div>

                {/* ── Summary ── */}
                <div className="bg-slate-700/50 rounded-lg px-4 py-3 text-xs text-slate-400 space-y-1">
                  {(() => {
                    const wSel = diageoWeeks.length === 0 ? allWeeks : allWeeks.filter(w => diageoWeeks.includes(w.key));
                    const exportRows = filteredRows.filter(r => {
                      const [m,d,y]=r.date.split('/'); const dt=new Date(`${y}-${m}-${d}`);
                      const inW = wSel.length===0||wSel.some(w=>dt>=w.start&&dt<=w.end);
                      const brand=getBrand(r.campaignName);
                      const inB = diageoB.length===0||diageoB.includes(brand);
                      return inW && inB;
                    });
                    return (
                      <>
                        <p><span className="text-white font-semibold">{exportRows.length}</span> rows will be exported</p>
                        <p>Weeks: <span className="text-white">{diageoWeeks.length === 0 ? 'All' : diageoWeeks.length}</span> · Brands: <span className="text-white">{diageoB.length === 0 ? 'All' : diageoB.join(', ')}</span></p>
                        <p className="text-slate-500">File: <span className="font-mono text-slate-300">Diageo_LinkedIn_{(() => { const t=new Date(); return `${String(t.getFullYear()).slice(2)}${String(t.getMonth()+1).padStart(2,'0')}${String(t.getDate()).padStart(2,'0')}`; })()}.xlsx</span></p>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-700 shrink-0">
                <button onClick={() => setShowDiageo(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-semibold">Cancel</button>
                <button
                  disabled={!canExport}
                  onClick={() => {
                    const wSel = diageoWeeks.length === 0 ? allWeeks : allWeeks.filter(w => diageoWeeks.includes(w.key));
                    const bSel = diageoB.length === 0 ? allBrands : diageoB;
                    exportDiageoTemplate(filteredRows, wSel, bSel, customCodes);
                    setShowDiageo(false);
                  }}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors flex items-center gap-2">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Export Diageo Template
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* COLUMN SUMMARY PANEL */}
      {showColInfo && (
        <div className="bg-slate-800/80 border-b border-slate-700 px-4 py-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Column Summary — 23 Columns</span>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1"><span className="text-green-400">✅</span><span className="text-slate-400">Live from LinkedIn API</span></span>
              <span className="flex items-center gap-1"><span className="text-yellow-400">⚬</span><span className="text-slate-400">Computed</span></span>
              <span className="flex items-center gap-1"><span className="text-slate-400">⬜</span><span className="text-slate-400">Blank (not available)</span></span>
              <span className="flex items-center gap-1"><span className="text-red-400">🚫</span><span className="text-slate-400">Restricted (needs special LinkedIn permission)</span></span>
              <button onClick={() => setShowColInfo(false)} className="text-slate-400 hover:text-white ml-2"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {[
              { n:  1, label: 'Date',                        status: '✅', note: 'Daily, MM/DD/YYYY format',                             color: 'text-green-400' },
              { n:  2, label: 'Currency Spend is Entered In',status: '✅', note: 'Always "USD"',                                         color: 'text-green-400' },
              { n:  3, label: 'Site Name',                   status: '✅', note: 'Always "LinkedIn"',                                    color: 'text-green-400' },
              { n:  4, label: 'Campaign Name',               status: '✅', note: 'From LinkedIn campaign list',                          color: 'text-green-400' },
              { n:  5, label: 'Placement Name',              status: '✅', note: 'Same as Campaign Name',                               color: 'text-green-400' },
              { n:  6, label: 'Package Name',                status: '⬜', note: 'Not available via LinkedIn API',                       color: 'text-slate-500' },
              { n:  7, label: 'Creative Name',               status: '⬜', note: 'Requires separate creative API call',                  color: 'text-slate-500' },
              { n:  8, label: 'Net Spend',                   status: '✅', note: 'costInLocalCurrency — USD',                           color: 'text-green-400' },
              { n:  9, label: 'Impressions',                 status: '✅', note: 'Total impressions served',                             color: 'text-green-400' },
              { n: 10, label: 'Clicks',                      status: '✅', note: 'Total clicks',                                        color: 'text-green-400' },
              { n: 11, label: 'Engagements',                 status: '✅', note: 'Reactions + comments + shares + follows',              color: 'text-green-400' },
              { n: 12, label: 'Video Views',                 status: '✅', note: 'videoViews (2-second views)',                          color: 'text-green-400' },
              { n: 13, label: 'Video Starts',                status: '✅', note: 'videoStarts',                                         color: 'text-green-400' },
              { n: 14, label: 'Video 3 Sec View',            status: '🚫', note: 'videoThruPlayActions — ACCESS_DENIED on this account', color: 'text-red-400' },
              { n: 15, label: 'Video Complete 25%',          status: '✅', note: 'videoFirstQuartileCompletions',                        color: 'text-green-400' },
              { n: 16, label: 'Video Complete 50%',          status: '✅', note: 'videoMidpointCompletions',                             color: 'text-green-400' },
              { n: 17, label: 'Video Complete 75%',          status: '✅', note: 'videoThirdQuartileCompletions',                        color: 'text-green-400' },
              { n: 18, label: 'Video Complete 100%',         status: '✅', note: 'videoCompletions',                                    color: 'text-green-400' },
              { n: 19, label: 'VCR',                         status: '⚬', note: 'Computed: video100 ÷ videoStarts',                     color: 'text-yellow-400' },
              { n: 20, label: 'App Downloads',               status: '🚫', note: 'mobileAppInstall — requires special app permissions',  color: 'text-red-400' },
              { n: 21, label: 'Custom Performance Metric 1', status: '⬜', note: 'Not available via LinkedIn standard API',              color: 'text-slate-500' },
              { n: 22, label: 'Custom Performance Metric 2', status: '⬜', note: 'Not available via LinkedIn standard API',              color: 'text-slate-500' },
              { n: 23, label: 'CPM',                         status: '⚬', note: 'Computed: (spend ÷ impressions) × 1000',               color: 'text-yellow-400' },
            ].map(col => (
              <div key={col.n} className="flex items-start gap-2 bg-slate-700/50 rounded-lg px-3 py-2">
                <span className="text-slate-500 font-mono text-xs w-5 shrink-0 mt-0.5">{col.n}</span>
                <span className={`text-sm shrink-0 mt-0.5`}>{col.status}</span>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${col.color} leading-snug`}>{col.label}</p>
                  <p className="text-xs text-slate-500 leading-snug mt-0.5">{col.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DATE BAR */}
      <div className="bg-slate-800/60 border-b border-slate-700 px-4 py-2 flex items-center gap-3 flex-wrap shrink-0">
        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">From</label>
          <input type="date" value={startDate} max={endDate} onChange={e => setStartDate(e.target.value)}
            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">To</label>
          <input type="date" value={endDate} min={startDate} max={todayStr()} onChange={e => setEndDate(e.target.value)}
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
        {lastRefresh && <span className="text-xs text-slate-500 ml-auto">Updated {lastRefresh.toLocaleTimeString()} · {filteredRows.length} rows</span>}
      </div>

      {/* SUMMARY */}
      {filteredRows.length > 0 && (
        <div className="bg-slate-900 border-b border-slate-700 px-4 py-1.5 flex items-center gap-5 text-xs flex-wrap shrink-0">
          <span className="text-slate-500">Net Spend: <span className="text-emerald-400 font-bold">${totals.netSpend.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></span>
          <span className="text-slate-500">Impressions: <span className="text-sky-300 font-bold">{totals.impressions.toLocaleString()}</span></span>
          <span className="text-slate-500">Clicks: <span className="text-white font-bold">{totals.clicks.toLocaleString()}</span></span>
          <span className="text-slate-500">CTR: <span className="text-yellow-300 font-mono">{ctr}%</span></span>
          <span className="text-slate-500">CPM: <span className="text-purple-300 font-mono">${cpmAvg}</span></span>
          {totals.videoViews > 0 && <span className="text-slate-500">Video Views: <span className="text-pink-300 font-bold">{totals.videoViews.toLocaleString()}</span></span>}
          <span className="text-slate-400 ml-auto text-xs font-mono">LinkedIn_{fileTag}.xlsx</span>
        </div>
      )}

      {/* WARNING */}
      {warning && !loading && (
        <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-4 py-2 flex items-start gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-300">{warning}</p>
        </div>
      )}

      {/* CONTENT */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
            <RefreshCw className="w-10 h-10 text-green-500 animate-spin" />
            <div className="w-full max-w-md space-y-2">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>{progress.message || 'Fetching…'}</span>
                <span className="font-mono text-green-400">{progress.pct}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                <div className="h-2.5 rounded-full transition-all duration-500 bg-green-500" style={{ width: `${progress.pct}%` }} />
              </div>
              {progress.rowsSoFar > 0 && <p className="text-xs text-slate-500 text-right">{progress.rowsSoFar} rows so far</p>}
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2 text-red-400 bg-red-900/20 px-4 py-3 rounded-lg max-w-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && filteredRows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500 px-8">
            <Table2 className="w-14 h-14 opacity-20" />
            {!selectedAcct
              ? <><p className="text-sm font-semibold text-slate-300">Select an account to get started</p><p className="text-xs text-center max-w-sm">Use <strong className="text-blue-400">Select Account</strong> to pick your LinkedIn ad account. All its campaigns will load — choose any or all, pick a date range, then click <strong className="text-blue-400">Pull Data</strong>.</p></>
              : !selectedCamps.length
                ? <><p className="text-sm font-semibold text-slate-300">No campaigns selected</p><p className="text-xs text-center max-w-sm">Select campaigns from the dropdown above then click Pull Data.</p></>
                : <><p className="text-sm">No spend data for this date range</p><p className="text-xs text-center max-w-sm">Adjust the dates and click Pull Data.</p></>
            }
          </div>
        )}

        {!loading && filteredRows.length > 0 && (
          <table className="border-collapse text-xs" style={{ minWidth: 'max-content', width: '100%' }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th key={col.key} style={{
                    minWidth: col.w, background: '#2e4057', color: '#fff',
                    position: 'sticky', top: 0, zIndex: 10,
                    whiteSpace: 'nowrap', padding: '6px 8px',
                    textAlign: col.fmt ? 'right' : 'left',
                    fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.1)',
                    borderBottom: '2px solid rgba(0,0,0,0.4)', fontSize: 11,
                  }}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => (
                <tr key={`${row.date}-${row.campaignName}-${i}`} style={{ background: i % 2 === 0 ? '#1e293b' : '#172033' }} className="hover:brightness-110">
                  {COLS.map(col => {
                    const val = row[col.key];
                    return (
                      <td key={col.key} title={val != null ? String(val) : ''} style={{
                        minWidth: col.w, maxWidth: col.w + 100, padding: '4px 8px',
                        borderRight: '1px solid rgba(100,116,139,0.2)',
                        borderBottom: '1px solid rgba(100,116,139,0.15)',
                        textAlign: col.fmt ? 'right' : 'left',
                        color: col.key==='netSpend' ? '#34d399' : col.key==='impressions' ? '#7dd3fc' : col.key==='clicks' ? '#fde68a' : col.key==='cpm' ? '#d8b4fe' : val==null ? '#334155' : '#e2e8f0',
                        fontFamily: col.fmt ? 'monospace' : 'inherit',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {val == null ? '—' : fmtCell(val, col.fmt)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#0f172a', borderTop: '2px solid #475569' }}>
                {COLS.map((col, i) => {
                  // Columns that get SUM in the footer
                  const sumCols = ['netSpend','impressions','clicks','engagements','videoViews','videoStarts','video25','video50','video75','video100'];
                  // Columns that get AVERAGE (%) — show avg label
                  const avgCols = ['vcr','cpm'];

                  let cellVal = '';
                  let cellColor = '#475569';
                  let cellWeight = 400;
                  let cellLabel = null;

                  if (i === 0) {
                    cellVal = `TOTAL (${filteredRows.length} rows)`;
                    cellColor = '#94a3b8';
                    cellWeight = 700;
                  } else if (sumCols.includes(col.key) && totals[col.key] > 0) {
                    cellVal = fmtCell(totals[col.key], col.fmt);
                    cellColor = '#34d399';
                    cellWeight = 700;
                  } else if (col.key === 'vcr' && totals.vcr != null) {
                    cellVal = fmtCell(totals.vcr, 'pct');
                    cellLabel = 'avg';
                    cellColor = '#a78bfa';
                    cellWeight = 700;
                  } else if (col.key === 'cpm' && totals.cpmAvg != null) {
                    cellVal = fmtCell(totals.cpmAvg, 'num4');
                    cellLabel = 'avg';
                    cellColor = '#a78bfa';
                    cellWeight = 700;
                  }

                  return (
                    <td key={col.key} style={{
                      minWidth: col.w, padding: '5px 8px',
                      borderRight: '1px solid rgba(100,116,139,0.3)',
                      color: cellColor, fontWeight: cellWeight, fontFamily: 'monospace',
                      textAlign: col.fmt ? 'right' : 'left',
                      position: 'sticky', bottom: 0, zIndex: 5, background: '#0f172a',
                      fontSize: 11,
                    }}>
                      {cellVal}
                      {cellLabel && <span style={{ fontSize: 9, color: '#7c3aed', marginLeft: 3, verticalAlign: 'super' }}>{cellLabel}</span>}
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