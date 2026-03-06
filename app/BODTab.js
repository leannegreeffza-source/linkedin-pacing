'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  RefreshCw, FileSpreadsheet, Eye, EyeOff, Search, X,
  Upload, ChevronDown, Calendar, List, Users, AlertCircle, CheckCircle2
} from 'lucide-react';

// ─── Column definitions (exact 202602 BOD with PMF order) ───────────────────
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

const BLUE_HDR   = '#00B0F0';
const BLACK_HDR  = '#595959';
const TOTAL_KEYS = new Set(['localSpend','mediaSpendUSD','pmfUSD','mediaSpendZAR','pmfZAR','grossZAR']);

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toYMD(d)       { return d.toISOString().split('T')[0]; }
function todayStr()     { return toYMD(new Date()); }
function firstOfMonth() { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 1)); }
function lastNDays(n)   { const d = new Date(); d.setDate(d.getDate() - n + 1); return toYMD(d); }
function lastMonthStart(){ const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth()-1, 1)); }
function lastMonthEnd() { const d = new Date(); return toYMD(new Date(d.getFullYear(), d.getMonth(), 0)); }
function fmtDate(v)     {
  if (!v) return '';
  if (v instanceof Date) return toYMD(v);
  if (typeof v === 'number') return toYMD(new Date((v - 25569) * 86400 * 1000)); // Excel serial
  return String(v).split('T')[0];
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCell(val, fmt) {
  if (val == null || val === '') return '';
  if (fmt === 'num2') return Number(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (fmt === 'pct')  return `${(Number(val) * 100).toFixed(2)}%`;
  return String(val);
}

function computeRow(r, exchangeRate) {
  const pmfUSD        = (r.mediaSpendUSD || 0) * (r.pmfPercentage || 0);
  const mediaSpendZAR = (r.mediaSpendUSD || 0) * exchangeRate;
  const pmfZAR        = pmfUSD * exchangeRate;
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
    grossZAR:      mediaSpendZAR + pmfZAR,
    pmfPct:        r.pmfPercentage || 0,
  };
}

// ─── LocalStorage ─────────────────────────────────────────────────────────────
function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function lsSet(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ─── Load SheetJS once ────────────────────────────────────────────────────────
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX);
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ─── Parse uploaded BOD Excel list ───────────────────────────────────────────
// Reads a BOD-format Excel and returns:
//   { rows: [{accountId, campaignGroupId, ...all black fields}], accountIds: [unique ids] }
async function parseBODList(file) {
  const XLSX = await loadXLSX();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });

        // Find a BOD-like sheet: prefer one containing 'BOD' or 'PMF', else first sheet
        const sheetName =
          wb.SheetNames.find(n => n.toLowerCase().includes('bod') || n.toLowerCase().includes('pmf')) ||
          wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

        if (rawRows.length < 2) throw new Error('Sheet appears empty');

        // Detect header row — find the row containing 'Account ID' or 'Acount ID'
        let headerIdx = 0;
        for (let i = 0; i < Math.min(5, rawRows.length); i++) {
          const row = rawRows[i].map(v => String(v).toLowerCase().trim());
          if (row.some(v => v.includes('account') && (v.includes('id') || v.includes('no')))) {
            headerIdx = i;
            break;
          }
        }

        // Map header labels → column indices
        const headers = rawRows[headerIdx].map(v => String(v).toLowerCase().trim());
        const col = name => headers.findIndex(h => h.includes(name));

        const iAccId   = headers.findIndex(h => h.includes('acount') || (h.includes('account') && h.includes('id')));
        const iGrpId   = headers.findIndex(h => h.includes('campaign group') && h.includes('id'));
        const iCat     = col('category');
        const iIO      = headers.findIndex(h => h === 'io' || h === 'io number');
        const iPartner = col('partner');
        const iStaff   = col('staff');
        const iBill    = headers.findIndex(h => h.includes('agency') && h.includes('bill'));
        const iBook    = headers.findIndex(h => h.includes('booking'));
        const iAdv     = col('advertiser');
        const iCampN   = headers.findIndex(h => h.includes('campaign name') && !h.includes('group'));
        const iGrpN    = headers.findIndex(h => h.includes('campaign group name'));
        const iInd     = col('industry');
        const iIO2     = headers.findIndex((h, i) => (h === 'io' || h === 'io number') && i !== iIO);
        const iCI      = headers.findIndex(h => h.includes('ci') || h.includes('po number') || h.includes('ci #'));
        const iStart   = col('start date');
        const iEnd     = col('end date');
        const iAd      = col('ad unit');
        const iItem    = col('item code');
        const iPMF     = headers.findIndex(h => h.includes('pmf') && h.includes('percent'));
        const iNotes   = headers.findIndex(h => h.includes('special') || h.includes('notes'));
        const iFX      = col('exchange rate');

        const bodRows = [];
        const accountIdSet = new Set();

        for (let i = headerIdx + 1; i < rawRows.length; i++) {
          const r = rawRows[i];
          const accRaw = r[iAccId] !== undefined ? String(r[iAccId]).trim() : '';
          if (!accRaw || !/^\d+$/.test(accRaw)) continue;

          const accId = accRaw;
          const grpRaw = r[iGrpId] !== undefined ? String(r[iGrpId]).trim() : '';
          const grpId = /^\d+$/.test(grpRaw) ? grpRaw : '';

          accountIdSet.add(accId);

          // Parse PMF — could be 0.15 or 15 (percent)
          let pmf = 0;
          if (iPMF >= 0 && r[iPMF] !== '') {
            pmf = parseFloat(r[iPMF]) || 0;
            if (pmf > 1) pmf = pmf / 100; // convert 15 → 0.15
          }

          // Parse exchange rate
          let fx = 0;
          if (iFX >= 0 && r[iFX] !== '') fx = parseFloat(r[iFX]) || 0;

          bodRows.push({
            // Keys for spend matching
            accountId:         accId,
            campaignGroupId:   grpId,
            // Black fields from the uploaded file
            category:          iCat     >= 0 ? String(r[iCat]  || '').trim() : '',
            io:                iIO      >= 0 ? String(r[iIO]   || '').trim() : '',
            partner:           iPartner >= 0 ? String(r[iPartner] || 'LinkedIn').trim() : 'LinkedIn',
            staffCode:         iStaff   >= 0 ? String(r[iStaff] || '').trim() : '',
            billingAgency:     iBill    >= 0 ? String(r[iBill]  || '').trim() : '',
            bookingAgency:     iBook    >= 0 ? String(r[iBook]  || '').trim() : '',
            advertiser:        iAdv     >= 0 ? String(r[iAdv]   || '').trim() : '',
            campaignName:      iCampN   >= 0 ? String(r[iCampN] || '').trim() : '',
            campaignGroupName: iGrpN    >= 0 ? String(r[iGrpN]  || '').trim() : '',
            industry:          iInd     >= 0 ? String(r[iInd]   || '').trim() : '',
            ciNumber:          iCI      >= 0 ? String(r[iCI]    || '').trim() : '',
            campStartDate:     iStart   >= 0 ? fmtDate(r[iStart]) : '',
            campEndDate:       iEnd     >= 0 ? fmtDate(r[iEnd])   : '',
            adUnit:            iAd      >= 0 ? String(r[iAd]    || '').trim() : '',
            itemCode:          iItem    >= 0 ? String(r[iItem]   || '').trim() : '',
            pmfPercentage:     pmf,
            fileExchangeRate:  fx,
            specialNotes:      iNotes   >= 0 ? String(r[iNotes] || '').trim() : '',
            // Spend will be populated from API
            localSpend:    0,
            mediaSpendUSD: 0,
          });
        }

        resolve({
          rows:       bodRows,
          accountIds: [...accountIdSet],
          sheetName,
          rowCount:   bodRows.length,
        });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Parse reference sheet (for "All Accounts" mode) ─────────────────────────
async function parseRefExcel(file) {
  const XLSX = await loadXLSX();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('ref')) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        const byAccGrp = {}, byAcc = {};
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const acc = r[0] ? String(r[0]).trim() : '';
          if (!acc || !/^\d+$/.test(acc)) continue;
          let grp = '0';
          try { if (r[1] && !isNaN(Number(r[1]))) grp = String(Math.round(Number(r[1]))); } catch {}
          const entry = {
            io: r[2]?String(r[2]).trim():'', staffCode: r[4]?String(r[4]).trim():'',
            billingAgency: r[6]?String(r[6]).trim():'', bookingAgency: r[7]?String(r[7]).trim():'',
            advertiser: r[8]?String(r[8]).trim():'', industry: r[9]?String(r[9]).trim():'',
            poNumber: r[12]?String(r[12]).trim():'', category: r[13]?String(r[13]).trim():'',
            pmfPercentage: r[15] ? parseFloat(r[15]) || 0 : 0,
            specialNotes: r[17]?String(r[17]).trim():'',
          };
          if (!byAccGrp[`${acc}_${grp}`]) byAccGrp[`${acc}_${grp}`] = entry;
          if (!byAcc[acc]) byAcc[acc] = entry;
        }
        resolve({ byAccGrp, byAcc });
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

function applyRef(rawRows, ref) {
  return rawRows.map(r => {
    const key = `${r.accountId}_${r.campaignGroupId}`;
    const d = ref.byAccGrp?.[key] || ref.byAcc?.[String(r.accountId)] || {};
    return {
      ...r,
      category: d.category||r.category||'', io: d.io||r.io||'',
      staffCode: d.staffCode||r.staffCode||'', billingAgency: d.billingAgency||r.billingAgency||'',
      bookingAgency: d.bookingAgency||r.bookingAgency||'', advertiser: d.advertiser||r.advertiser||'',
      industry: d.industry||r.industry||'', ciNumber: d.poNumber||r.ciNumber||'',
      pmfPercentage: d.pmfPercentage != null ? d.pmfPercentage : (r.pmfPercentage || 0),
      specialNotes: d.specialNotes||r.specialNotes||'',
    };
  });
}

// ─── Excel export ─────────────────────────────────────────────────────────────
async function exportToExcel(rows, startDate, endDate) {
  const XLSX = await loadXLSX();
  const wsData = [COLS.map(c => c.label)];
  rows.forEach(row => {
    wsData.push(COLS.map(col => {
      const v = row[col.key];
      if (v == null) return '';
      if (col.fmt === 'num2' || col.fmt === 'pct') return typeof v === 'number' ? v : parseFloat(v) || 0;
      return v;
    }));
  });
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = COLS.map(c => ({ wch: Math.round(c.w / 6.5) }));
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = 1; R <= range.e.r; R++) {
    COLS.forEach((col, C) => {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) return;
      if (col.fmt === 'num2') ws[addr].z = '#,##0.00';
      if (col.fmt === 'pct')  ws[addr].z = '0.00%';
    });
  }
  COLS.forEach((col, C) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[addr]) return;
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: col.source === 'blue' ? '00B0F0' : '595959' } },
      alignment: { horizontal: 'center' },
    };
  });
  const monthStr = startDate ? startDate.slice(0, 7).replace('-', '') : 'BOD';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${monthStr} BOD with PMF`);
  XLSX.writeFile(wb, `${monthStr}_BOD_with_PMF_${startDate}_to_${endDate}.xlsx`);
}

// ─── Main BOD Tab ─────────────────────────────────────────────────────────────
export default function BODTab() {
  const { data: session } = useSession();

  // ── Mode: 'all' = all user accounts | 'list' = uploaded BOD list ─
  const [mode, setMode] = useState('all');  // 'all' | 'list'

  // ── "All Accounts" mode state ─────────────────────────────────────
  const [allAccounts, setAllAccounts]   = useState([]);
  const [loadingAccs, setLoadingAccs]   = useState(false);
  const [excludedIds, setExcludedIds]   = useState([]);
  const [showAccMenu, setShowAccMenu]   = useState(false);
  const [ref, setRef]                   = useState({ byAccGrp: {}, byAcc: {} });
  const [refCount, setRefCount]         = useState(0);

  // ── "BOD List" mode state ─────────────────────────────────────────
  const [bodList, setBodList]           = useState(null); // { rows, accountIds, sheetName, rowCount }
  const [bodFileName, setBodFileName]   = useState('');
  const [uploadingBOD, setUploadingBOD] = useState(false);

  // ── Shared state ──────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate,   setEndDate]   = useState(todayStr);
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(18);
  const [editRate, setEditRate]   = useState(false);
  const [rateInput, setRateInput] = useState('18');
  const [search, setSearch]       = useState('');

  const refFileRef  = useRef();
  const bodFileRef  = useRef();
  const menuRef     = useRef();

  // ── Persist settings ──────────────────────────────────────────────
  useEffect(() => {
    const savedRef = lsGet('bod_ref_data_v1', null);
    if (savedRef) { setRef(savedRef); setRefCount(Object.keys(savedRef.byAccGrp || {}).length); }
    setExcludedIds(lsGet('bod_excluded_ids', []));
    const r = lsGet('bod_exchange_rate', 18);
    setExchangeRate(r); setRateInput(String(r));
  }, []);

  // ── Fetch all accounts (all-accounts mode) ────────────────────────
  useEffect(() => {
    if (!session) return;
    setLoadingAccs(true);
    fetch('/api/accounts')
      .then(r => r.json())
      .then(data => { setAllAccounts(Array.isArray(data) ? data : []); setLoadingAccs(false); })
      .catch(() => setLoadingAccs(false));
  }, [session]);

  // ── Close dropdown on outside click ──────────────────────────────
  useEffect(() => {
    function h(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setShowAccMenu(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Fetch spend from LinkedIn API ─────────────────────────────────
  async function loadBOD() {
    setLoading(true); setError('');
    try {
      if (mode === 'list' && bodList) {
        // ── BOD List mode: fetch spend for the exact account IDs in the file ──
        const uniqueAccIds = bodList.accountIds;
        if (!uniqueAccIds.length) { setRows([]); setLoading(false); return; }

        const res = await fetch('/api/bod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountIds: uniqueAccIds, startDate, endDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'API error');

        // Build spend lookup: "accountId_campaignGroupId" → spend
        // and "accountId_campaignName" as fallback
        const spendByAccGrp  = {};
        const spendByAccCamp = {};
        (data.rows || []).forEach(r => {
          const keyAG = `${r.accountId}_${r.campaignGroupId}`;
          spendByAccGrp[keyAG]  = (spendByAccGrp[keyAG]  || 0) + (r.localSpend || 0);

          const keyAC = `${r.accountId}_${(r.campaignName || '').toLowerCase()}`;
          spendByAccCamp[keyAC] = (spendByAccCamp[keyAC] || 0) + (r.localSpend || 0);
        });

        // Merge spend into BOD list rows
        const merged = bodList.rows.map(r => {
          const keyAG = `${r.accountId}_${r.campaignGroupId}`;
          const keyAC = `${r.accountId}_${(r.campaignName || '').toLowerCase()}`;
          const spend  = spendByAccGrp[keyAG] || spendByAccCamp[keyAC] || 0;
          // Use exchange rate from the uploaded file if present, else current setting
          const fx = r.fileExchangeRate || exchangeRate;
          return { ...r, localSpend: spend, mediaSpendUSD: spend, exchangeRate: fx };
        });

        setRows(merged);
        setLastRefresh(new Date());

      } else {
        // ── All Accounts mode ──────────────────────────────────────────────────
        const activeIds = allAccounts.filter(a => !excludedIds.includes(a.id)).map(a => a.id);
        if (!activeIds.length) { setRows([]); setLoading(false); return; }

        const res = await fetch('/api/bod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountIds: activeIds, startDate, endDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'API error');
        setRows(applyRef(data.rows || [], ref));
        setLastRefresh(new Date());
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // Auto-load
  useEffect(() => {
    if (mode === 'all' && allAccounts.length > 0) loadBOD();
  }, [allAccounts, startDate, endDate]);

  useEffect(() => {
    if (mode === 'list' && bodList) loadBOD();
  }, [bodList, startDate, endDate]);

  // ── Upload BOD list file ──────────────────────────────────────────
  async function handleBODUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBOD(true);
    try {
      const parsed = await parseBODList(file);
      setBodList(parsed);
      setBodFileName(file.name);
      setMode('list');
      setRows([]); // clear — loadBOD will fire via useEffect
    } catch (err) {
      setError('Failed to parse BOD list: ' + err.message);
    }
    setUploadingBOD(false);
    e.target.value = '';
  }

  // ── Upload Reference sheet (all-accounts mode) ────────────────────
  async function handleRefUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseRefExcel(file);
      setRef(parsed); setRefCount(Object.keys(parsed.byAccGrp || {}).length);
      lsSet('bod_ref_data_v1', parsed);
      setRows(prev => applyRef(prev, parsed));
      alert(`✅ Reference data loaded: ${Object.keys(parsed.byAccGrp).length} entries`);
    } catch (err) { alert('❌ ' + err.message); }
    e.target.value = '';
  }

  function clearBODList() {
    setBodList(null); setBodFileName(''); setMode('all'); setRows([]);
  }

  function toggleExclude(id) {
    setExcludedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      lsSet('bod_excluded_ids', next);
      return next;
    });
  }

  function commitRate() {
    const r = parseFloat(rateInput);
    if (!isNaN(r) && r > 0) { setExchangeRate(r); lsSet('bod_exchange_rate', r); }
    setEditRate(false);
  }

  const quickDates = [
    { label: 'This Month', fn: () => { setStartDate(firstOfMonth()); setEndDate(todayStr()); } },
    { label: 'Last Month', fn: () => { setStartDate(lastMonthStart()); setEndDate(lastMonthEnd()); } },
    { label: 'Last 7d',    fn: () => { setStartDate(lastNDays(7));  setEndDate(todayStr()); } },
    { label: 'Last 30d',   fn: () => { setStartDate(lastNDays(30)); setEndDate(todayStr()); } },
    { label: 'Today',      fn: () => { setStartDate(todayStr()); setEndDate(todayStr()); } },
  ];

  // ── Derived display data ──────────────────────────────────────────
  const activeRows = mode === 'list'
    ? rows                                            // BOD list: show all rows (already filtered by file)
    : rows.filter(r => !excludedIds.includes(String(r.accountId)));  // All accs: respect exclusions

  const filteredRows = activeRows.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [r.accountId, r.campaignGroupId, r.advertiser, r.campaignName,
            r.campaignGroupName, r.billingAgency, r.io, r.ciNumber]
      .some(v => v && String(v).toLowerCase().includes(s));
  });

  const computedRows = filteredRows.map(r => computeRow(r, r.fileExchangeRate || exchangeRate));

  const totals = computedRows.reduce((t, r) => ({
    localSpend:    t.localSpend    + (r.localSpend    || 0),
    mediaSpendUSD: t.mediaSpendUSD + (r.mediaSpendUSD || 0),
    pmfUSD:        t.pmfUSD        + (r.pmfUSD        || 0),
    mediaSpendZAR: t.mediaSpendZAR + (r.mediaSpendZAR || 0),
    pmfZAR:        t.pmfZAR        + (r.pmfZAR        || 0),
    grossZAR:      t.grossZAR      + (r.grossZAR      || 0),
  }), { localSpend:0, mediaSpendUSD:0, pmfUSD:0, mediaSpendZAR:0, pmfZAR:0, grossZAR:0 });

  const activeAccCount = mode === 'list'
    ? (bodList?.accountIds?.length || 0)
    : allAccounts.filter(a => !excludedIds.includes(a.id)).length;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* ══ TOP TOOLBAR ══ */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center gap-2 flex-wrap shrink-0">

        {/* Mode toggle */}
        <div className="flex items-center bg-slate-900 rounded-lg p-0.5 gap-0.5">
          <button onClick={() => { setMode('all'); setRows([]); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mode === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            <Users className="w-3.5 h-3.5" /> All Accounts
          </button>
          <button onClick={() => bodFileRef.current?.click()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mode === 'list' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {uploadingBOD
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <List className="w-3.5 h-3.5" />
            }
            {mode === 'list' && bodFileName ? 'BOD List ✓' : 'Upload BOD List'}
          </button>
        </div>

        {/* BOD list badge */}
        {mode === 'list' && bodList && (
          <div className="flex items-center gap-2 bg-emerald-900/40 border border-emerald-700/50 rounded-lg px-2.5 py-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-xs text-emerald-300 truncate max-w-[180px]" title={bodFileName}>
              {bodFileName}
            </span>
            <span className="text-xs text-emerald-500">· {bodList.rowCount} rows · {bodList.accountIds.length} accounts</span>
            <button onClick={clearBODList} className="text-slate-400 hover:text-red-400 ml-1">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 ml-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: BLUE_HDR }} />
            <span className="text-xs text-slate-400">LinkedIn API</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-slate-500" />
            <span className="text-xs text-slate-400">
              {mode === 'list' ? 'From uploaded BOD' : 'Reference Sheet'}
            </span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="pl-8 pr-7 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1.5 text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Exchange Rate (only relevant when not using file's own rate) */}
        <div className="flex items-center gap-1.5 bg-slate-700 rounded-lg px-2.5 py-1.5 border border-slate-600">
          <span className="text-xs text-slate-400">USD/ZAR</span>
          {editRate ? (
            <input autoFocus value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              onBlur={commitRate}
              onKeyDown={e => { if (e.key==='Enter') commitRate(); if (e.key==='Escape') setEditRate(false); }}
              className="w-14 bg-slate-600 text-yellow-300 text-xs font-bold rounded px-1 py-0.5 focus:outline-none" />
          ) : (
            <button onClick={() => { setRateInput(String(exchangeRate)); setEditRate(true); }}
              className="text-xs font-bold text-yellow-300 hover:text-yellow-200 min-w-[2rem]">
              {exchangeRate}
            </button>
          )}
        </div>

        {/* Ref sheet upload — only shown in All Accounts mode */}
        {mode === 'all' && (
          <>
            <input type="file" ref={refFileRef} accept=".xlsx,.xls" className="hidden" onChange={handleRefUpload} />
            <button onClick={() => refFileRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              {refCount > 0 ? `Ref (${refCount.toLocaleString()})` : 'Upload Ref Sheet'}
            </button>
          </>
        )}

        {/* Account menu — All Accounts mode only */}
        {mode === 'all' && (
          <div className="relative" ref={menuRef}>
            <button onClick={() => setShowAccMenu(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 transition-colors">
              {loadingAccs ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{loadingAccs ? 'Loading…' : `${activeAccCount} Accounts`}</span>
              {excludedIds.length > 0 && (
                <span className="bg-red-600 text-white text-xs font-bold rounded-full px-1.5">{excludedIds.length} hidden</span>
              )}
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showAccMenu && (
              <div className="absolute right-0 top-9 z-30 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-80 p-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
                  Include / Exclude Accounts ({allAccounts.length} total)
                </p>
                {allAccounts.length === 0
                  ? <p className="text-xs text-slate-500 py-3 text-center">No accounts found</p>
                  : (
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                      {allAccounts.map(a => {
                        const excl = excludedIds.includes(a.id);
                        return (
                          <div key={a.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${excl ? 'bg-red-900/30 border border-red-800/50' : 'bg-slate-700 hover:bg-slate-600'}`}
                            onClick={() => toggleExclude(a.id)}>
                            {excl ? <EyeOff className="w-3.5 h-3.5 text-red-400 shrink-0" /> : <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                            <span className={`text-xs flex-1 truncate ${excl ? 'text-red-300 line-through' : 'text-white'}`}>{a.name}</span>
                            <span className="text-xs text-slate-500 font-mono shrink-0">{a.id}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                }
                <div className="flex gap-2 mt-2.5">
                  <button onClick={() => { setExcludedIds([]); lsSet('bod_excluded_ids',[]); }}
                    className="flex-1 py-1.5 bg-slate-600 hover:bg-slate-500 text-slate-200 text-xs rounded-lg">Include All</button>
                  <button onClick={() => { setShowAccMenu(false); loadBOD(); }}
                    className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg">Apply & Reload</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hidden BOD list file input */}
        <input type="file" ref={bodFileRef} accept=".xlsx,.xls" className="hidden" onChange={handleBODUpload} />

        {/* Refresh */}
        <button onClick={loadBOD} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium border border-slate-600 disabled:opacity-40 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>

        {/* Export */}
        <button disabled={computedRows.length === 0} onClick={() => exportToExcel(computedRows, startDate, endDate)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
        </button>
      </div>

      {/* ══ DATE RANGE BAR ══ */}
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
        {lastRefresh && <span className="text-xs text-slate-500 ml-auto">Updated {lastRefresh.toLocaleTimeString()} · {computedRows.length} rows</span>}
      </div>

      {/* ══ SUMMARY BAR ══ */}
      {computedRows.length > 0 && (
        <div className="bg-slate-900 border-b border-slate-700 px-4 py-1.5 flex items-center gap-5 text-xs flex-wrap shrink-0">
          <span className="text-slate-500">Local Spend: <span className="text-white font-bold">{fmtCell(totals.localSpend,'num2')}</span></span>
          <span className="text-slate-500">Media USD: <span className="text-sky-300 font-bold">${fmtCell(totals.mediaSpendUSD,'num2')}</span></span>
          <span className="text-slate-500">PMF USD: <span className="text-white font-mono">${fmtCell(totals.pmfUSD,'num2')}</span></span>
          <span className="text-slate-500">Media ZAR: <span className="text-yellow-300 font-bold">R{fmtCell(totals.mediaSpendZAR,'num2')}</span></span>
          <span className="text-slate-500">PMF ZAR: <span className="text-white font-mono">R{fmtCell(totals.pmfZAR,'num2')}</span></span>
          <span className="text-slate-500">Gross ZAR: <span className="text-emerald-400 font-bold">R{fmtCell(totals.grossZAR,'num2')}</span></span>
        </div>
      )}

      {/* ══ TABLE ══ */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-slate-400 text-sm">
              {mode === 'list'
                ? `Fetching spend for ${bodList?.accountIds?.length || 0} accounts in your BOD list…`
                : `Fetching spend for ${activeAccCount} account${activeAccCount !== 1 ? 's' : ''}…`}
            </p>
            <p className="text-slate-500 text-xs">{startDate} → {endDate}</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2 text-red-400 bg-red-900/20 px-4 py-3 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          </div>
        ) : computedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-slate-500">
            <FileSpreadsheet className="w-12 h-12 opacity-20" />
            {mode === 'list' && !bodList ? (
              <>
                <p className="text-sm font-medium text-slate-300">Upload a BOD List to get started</p>
                <p className="text-xs text-center max-w-sm">
                  Click <strong className="text-emerald-400">Upload BOD List</strong> to select your BOD Excel file.
                  The app will read every row's account IDs and black-field data, then pull fresh LinkedIn spend for the selected date range.
                </p>
                <button onClick={() => bodFileRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold transition-colors">
                  <Upload className="w-4 h-4" /> Choose BOD Excel File
                </button>
              </>
            ) : (
              <>
                <p className="text-sm">No spend data for this period</p>
                <p className="text-xs text-center max-w-sm">
                  {mode === 'all' && refCount === 0
                    ? 'Upload the Reference Sheet to populate Agency, Advertiser, IO and other fields — then click Refresh.'
                    : 'Adjust the date range or click Refresh.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <table className="border-collapse text-xs" style={{ minWidth: 'max-content', width: '100%' }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th key={col.key} style={{
                    minWidth: col.w,
                    background: col.source === 'blue' ? BLUE_HDR : BLACK_HDR,
                    color: '#fff', position: 'sticky', top: 0, zIndex: 10,
                    whiteSpace: 'nowrap', padding: '6px 8px', textAlign: 'left',
                    fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.15)',
                    borderBottom: '2px solid rgba(0,0,0,0.3)', fontSize: 11,
                  }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {computedRows.map((row, i) => (
                <tr key={`${row.accountId}-${row.campaignGroupId}-${row.campaignName}-${i}`}
                  style={{ background: i % 2 === 0 ? '#1e293b' : '#172033' }}
                  className="hover:brightness-110">
                  {COLS.map(col => {
                    const val = row[col.key];
                    // Highlight rows with no spend fetched in BOD list mode
                    const noSpend = mode === 'list' && (col.key === 'localSpend' || col.key === 'mediaSpendUSD') && !val;
                    return (
                      <td key={col.key} style={{
                        minWidth: col.w, maxWidth: col.w + 80,
                        padding: '4px 8px',
                        borderRight: '1px solid rgba(100,116,139,0.2)',
                        borderBottom: '1px solid rgba(100,116,139,0.15)',
                        color: noSpend ? '#64748b' : col.source === 'blue' ? '#7dd3fc' : '#e2e8f0',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        fontFamily: col.fmt ? 'monospace' : 'inherit',
                      }} title={val != null ? String(val) : ''}>
                        {fmtCell(val, col.fmt)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#0f172a', borderTop: '2px solid #475569' }}>
                {COLS.map((col, i) => (
                  <td key={col.key} style={{
                    minWidth: col.w, padding: '5px 8px',
                    borderRight: '1px solid rgba(100,116,139,0.3)',
                    color: TOTAL_KEYS.has(col.key) ? '#34d399' : '#94a3b8',
                    fontWeight: TOTAL_KEYS.has(col.key) ? 700 : 400,
                    fontFamily: 'monospace', whiteSpace: 'nowrap',
                    position: 'sticky', bottom: 0, zIndex: 5, background: '#0f172a',
                  }}>
                    {i === 0
                      ? `TOTAL (${computedRows.length})`
                      : TOTAL_KEYS.has(col.key) ? fmtCell(totals[col.key], 'num2') : ''}
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