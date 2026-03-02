'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import {
  TrendingUp, TrendingDown, DollarSign, RefreshCw,
  CheckCircle, AlertCircle, XCircle, Edit3, Save, X,
  ChevronUp, ChevronDown, Users, Calendar, Target, Minus, Search,
  EyeOff, Eye, Download, FileText, Sparkles, FileSpreadsheet
} from 'lucide-react';

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '0.00';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtD(n) { return `$${fmt(n)}`; }
function fmtR(n) { return `R${fmt(n)}`; }

// ── Budget storage (localStorage, per calendar month — persists across date range changes) ──
function getBudgetKey(year, month) { return `pacing_budget_${year}_${String(month).padStart(2,'0')}`; }
function loadBudget(year, month) {
  try {
    const raw = localStorage.getItem(getBudgetKey(year, month));
    return raw ? JSON.parse(raw) : { totalUSD: '', totalZAR: '', note: '' };
  } catch { return { totalUSD: '', totalZAR: '', note: '' }; }
}
function saveBudget(year, month, data) {
  try { localStorage.setItem(getBudgetKey(year, month), JSON.stringify(data)); } catch {}
}

// ── Pacing status ─────────────────────────────────────────────────────────────
function getPacingStatus(actual, ideal) {
  if (!ideal || ideal === 0) return { label: 'No Budget Set', color: 'slate', icon: Minus };
  const ratio = actual / ideal;
  if (ratio >= 0.9 && ratio <= 1.1) return { label: 'On Track', color: 'emerald', icon: CheckCircle };
  if (ratio < 0.9) return { label: 'Under Pacing', color: 'yellow', icon: AlertCircle };
  return { label: 'Over Pacing', color: 'red', icon: XCircle };
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toDateInput(date) {
  return date.toISOString().split('T')[0];
}
function todayStr() { return toDateInput(new Date()); }
function firstOfMonth() {
  const d = new Date();
  return toDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
}

// ── FilterSection ─────────────────────────────────────────────────────────────
function FilterSection({ title, icon: Icon, items, selectedIds, onToggle, loading,
  searchValue, onSearchChange, onSelectFiltered, onDeselectFiltered,
  excludedIds, onToggleExclude,
  totalCount, accentColor = 'blue', emptyMessage = 'No items found', showExclude = false }) {

  const filtered = items.filter(item =>
    !searchValue ||
    item.name.toLowerCase().includes(searchValue.toLowerCase()) ||
    String(item.id).includes(searchValue)
  );
  const selectedCount = selectedIds.length;

  const colors = {
    blue:    { badge: 'text-blue-400', selected: 'bg-blue-900/40 border-blue-600', btn: 'bg-blue-700 hover:bg-blue-600' },
    purple:  { badge: 'text-purple-400', selected: 'bg-purple-900/40 border-purple-600', btn: 'bg-purple-700 hover:bg-purple-600' },
    emerald: { badge: 'text-emerald-400', selected: 'bg-emerald-900/40 border-emerald-600', btn: 'bg-emerald-700 hover:bg-emerald-600' },
  };
  const c = colors[accentColor] || colors.blue;

  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" /> {title}
        </h3>
        {loading
          ? <span className="text-xs text-slate-400 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /></span>
          : <span className={`text-xs font-bold ${c.badge}`}>{selectedCount}/{totalCount || items.length}</span>
        }
      </div>

      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
        <input
          type="text"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={searchValue}
          onChange={e => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-8 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
        />
        {searchValue && (
          <button onClick={() => onSearchChange('')} className="absolute right-2 top-1.5 text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-2">
        <button onClick={() => onSelectFiltered(filtered)}
          className={`flex-1 px-2 py-1 text-white rounded text-xs font-medium ${c.btn}`}>
          {searchValue ? `Select (${filtered.length})` : 'All'}
        </button>
        <button onClick={() => onDeselectFiltered(filtered)}
          className="flex-1 px-2 py-1 bg-slate-600 text-slate-300 rounded text-xs font-medium hover:bg-slate-500">
          {searchValue ? `Deselect (${filtered.filter(i => selectedIds.includes(i.id)).length})` : 'None'}
        </button>
      </div>

      {searchValue && (
        <div className="text-xs text-slate-500 mb-2 px-1">
          {filtered.length} of {items.length} shown
        </div>
      )}

      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
        {filtered.map(item => {
          const selected = selectedIds.includes(item.id);
          const excluded = excludedIds?.includes(item.id);
          return (
            <label key={item.id}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer border transition-colors ${
                excluded ? 'border-red-700 bg-red-900/20 opacity-60' :
                selected ? `${c.selected} text-white` : 'border-slate-600 text-slate-400 hover:bg-slate-700'
              }`}>
              <input type="checkbox" checked={selected && !excluded} onChange={() => !excluded && onToggle(item.id)}
                className="w-3.5 h-3.5 accent-blue-500 mt-0.5 flex-shrink-0" disabled={excluded} />
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-semibold truncate ${excluded ? 'text-red-400 line-through' : 'text-white'}`}>{item.name}</div>
                <div className="text-xs text-slate-500 font-mono">ID: {item.id}</div>
                {excluded && <div className="text-xs text-red-400 font-medium">Excluded</div>}
              </div>
              {showExclude && onToggleExclude && (
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleExclude(item.id); }}
                  className={`ml-auto flex-shrink-0 p-1 rounded transition-colors ${excluded ? 'text-red-400 hover:text-white' : 'text-slate-500 hover:text-red-400'}`}
                  title={excluded ? 'Remove exclusion' : 'Exclude account'}>
                  {excluded ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              )}
            </label>
          );
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-xs text-slate-500 text-center py-4">
            {searchValue ? `No results for "${searchValue}"` : emptyMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Sign-in / Loading screens ─────────────────────────────────────────────────
function SignInScreen() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="bg-slate-800 rounded-2xl shadow-2xl p-12 max-w-md w-full border border-slate-700 text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Target className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold mb-3 text-white">Budget Pacing Tracker</h1>
        <p className="text-slate-400 mb-8">Track your LinkedIn ad spend pacing daily</p>
        <button onClick={() => signIn('linkedin')}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-semibold hover:bg-blue-700 transition-colors">
          Sign in with LinkedIn
        </button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
        <p className="text-white font-semibold">Loading...</p>
      </div>
    </div>
  );
}

// ── Budget Modal ──────────────────────────────────────────────────────────────
function BudgetModal({ show, onClose, budget, onSave, month, year }) {
  const [form, setForm] = useState(budget);
  useEffect(() => setForm(budget), [budget]);
  if (!show) return null;
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-white">Edit Monthly Budget</h2>
            <p className="text-sm text-slate-400">{monthName} {year} — applies to all date ranges in this month</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">Total Budget (USD $)</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
              <input type="number" step="0.01" placeholder="e.g. 10000" value={form.totalUSD}
                onChange={e => setForm(f => ({ ...f, totalUSD: e.target.value }))}
                className="w-full pl-7 pr-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-lg font-bold focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">Total Budget (ZAR R) — optional</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">R</span>
              <input type="number" step="0.01" placeholder="e.g. 185000" value={form.totalZAR}
                onChange={e => setForm(f => ({ ...f, totalZAR: e.target.value }))}
                className="w-full pl-7 pr-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-lg font-bold focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">Budget Notes</label>
            <textarea placeholder="e.g. Q1 LinkedIn budget" value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 p-6 pt-0">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 font-medium text-sm">Cancel</button>
          <button onClick={() => { onSave(form); onClose(); }}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> Save Budget
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Report Modal ───────────────────────────────────────────────────────────
function AIReportModal({ show, onClose, reportText, loading }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-slate-700 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">AI Pacing Report</h2>
              <p className="text-xs text-slate-400">Generated summary of your LinkedIn ad spend</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-4">
              <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
              <p className="text-slate-400 text-sm">Generating AI report...</p>
            </div>
          ) : (
            <div className="prose prose-invert max-w-none">
              <pre className="whitespace-pre-wrap text-sm text-slate-200 font-sans leading-relaxed">{reportText}</pre>
            </div>
          )}
        </div>
        {!loading && reportText && (
          <div className="p-6 pt-0 border-t border-slate-700 mt-4">
            <button
              onClick={() => { navigator.clipboard.writeText(reportText); }}
              className="w-full py-2.5 bg-purple-700 text-white rounded-lg hover:bg-purple-600 text-sm font-medium flex items-center justify-center gap-2">
              <FileText className="w-4 h-4" /> Copy Report to Clipboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Daily Chart ───────────────────────────────────────────────────────────────
function DailyChart({ dailyData, idealDailySpend }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!dailyData || dailyData.length === 0) return;
    function renderChart() {
      const el = canvasRef.current;
      if (!el || !window.Chart) return;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      const labels = dailyData.map(d => d.date.slice(5)); // MM-DD
      const spends = dailyData.map(d => parseFloat(d.spend.toFixed(2)));
      const idealLine = dailyData.map(() => parseFloat((idealDailySpend || 0).toFixed(2)));
      const barColors = dailyData.map(d => {
        if (!idealDailySpend) return 'rgba(99,102,241,0.8)';
        const ratio = d.spend / idealDailySpend;
        if (ratio >= 0.9 && ratio <= 1.1) return 'rgba(52,211,153,0.85)';
        if (ratio < 0.9) return 'rgba(251,191,36,0.85)';
        return 'rgba(248,113,113,0.85)';
      });
      chartRef.current = new window.Chart(el, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Daily Spend ($)', data: spends, backgroundColor: barColors, borderRadius: 4, order: 2 },
            { label: 'Ideal Daily ($)', data: idealLine, type: 'line', borderColor: 'rgba(147,197,253,0.8)', borderWidth: 2, borderDash: [5, 4], pointRadius: 0, fill: false, order: 1 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}` } },
          },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(51,65,85,0.5)' }, title: { display: true, text: 'Date', color: '#64748b', font: { size: 11 } } },
            y: { ticks: { color: '#64748b', font: { size: 10 }, callback: v => `$${v}` }, grid: { color: 'rgba(51,65,85,0.5)' }, beginAtZero: true },
          },
        },
      });
    }
    if (window.Chart) { renderChart(); }
    else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      script.onload = renderChart;
      document.head.appendChild(script);
    }
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [dailyData, idealDailySpend]);

  return <div style={{ height: 280, position: 'relative' }}><canvas ref={canvasRef} /></div>;
}

// ── Export helpers ────────────────────────────────────────────────────────────
function exportToExcel(clientRows, dailyData, startDate, endDate, totalSpend, budgetUSD) {
  // Build a simple CSV that Excel can open
  const lines = [];
  lines.push(`LinkedIn Budget Pacing Report`);
  lines.push(`Period,${startDate} to ${endDate}`);
  lines.push(`Total Spend,$${totalSpend.toFixed(2)}`);
  lines.push(`Budget,$${budgetUSD > 0 ? budgetUSD.toFixed(2) : 'Not set'}`);
  lines.push('');
  lines.push('CLIENT BREAKDOWN');
  lines.push('Rank,Client,Account ID,Today Spend,Yesterday Spend,Month Total,% of Budget');
  clientRows.forEach((c, i) => {
    lines.push(`${i + 1},"${c.name}",${c.id},$${c.todaySpend.toFixed(2)},$${c.yesterdaySpend.toFixed(2)},$${c.totalSpend.toFixed(2)},${budgetUSD > 0 ? c.pct.toFixed(1) + '%' : 'N/A'}`);
  });
  lines.push('');
  lines.push('DAILY SPEND DATA');
  lines.push('Date,Spend,Impressions,Clicks,Leads');
  dailyData.forEach(d => {
    lines.push(`${d.date},$${d.spend.toFixed(2)},${d.impressions},${d.clicks},${d.leads}`);
  });

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linkedin_pacing_${startDate}_${endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToPDF(clientRows, dailyData, startDate, endDate, totalSpend, budgetUSD, pacingLabel) {
  const win = window.open('', '_blank');
  if (!win) return;
  const rows = clientRows.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${c.name}</td>
      <td>$${c.todaySpend.toFixed(2)}</td>
      <td>$${c.yesterdaySpend.toFixed(2)}</td>
      <td><strong>$${c.totalSpend.toFixed(2)}</strong></td>
      <td>${budgetUSD > 0 ? c.pct.toFixed(1) + '%' : '—'}</td>
    </tr>`).join('');
  win.document.write(`
    <!DOCTYPE html><html><head><title>LinkedIn Pacing Report</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; color: #1e293b; }
      h1 { color: #2563eb; } h2 { color: #475569; margin-top: 32px; }
      .meta { display:flex; gap:32px; margin: 16px 0 32px; }
      .meta div { background:#f1f5f9; padding:12px 20px; border-radius:8px; }
      .meta .label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; }
      .meta .value { font-size:22px; font-weight:700; margin-top:4px; }
      table { width:100%; border-collapse:collapse; font-size:13px; }
      th { background:#1e40af; color:white; padding:10px 12px; text-align:left; }
      td { padding:9px 12px; border-bottom:1px solid #e2e8f0; }
      tr:nth-child(even) { background:#f8fafc; }
      .status { display:inline-block; padding:4px 12px; border-radius:20px; font-weight:600; font-size:12px; background:#dcfce7; color:#166534; }
      @media print { body { margin: 20px; } }
    </style></head><body>
    <h1>LinkedIn Budget Pacing Report</h1>
    <p style="color:#64748b">Period: <strong>${startDate}</strong> to <strong>${endDate}</strong></p>
    <div class="meta">
      <div><div class="label">Total Spend</div><div class="value">$${totalSpend.toFixed(2)}</div></div>
      <div><div class="label">Budget</div><div class="value">${budgetUSD > 0 ? '$' + budgetUSD.toFixed(2) : 'Not set'}</div></div>
      <div><div class="label">Pacing Status</div><div class="value">${pacingLabel}</div></div>
    </div>
    <h2>Client Breakdown — Ranked by Contribution</h2>
    <table><thead><tr><th>#</th><th>Client</th><th>Today</th><th>Yesterday</th><th>Period Total</th><th>% of Budget</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="margin-top:40px;font-size:11px;color:#94a3b8">Generated by LinkedIn Budget Pacing Tracker • ${new Date().toLocaleString()}</p>
    <script>window.onload=()=>window.print();<\/script>
    </body></html>`);
  win.document.close();
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function PacingDashboard() {
  const { data: session, status } = useSession();

  // Accounts
  const [accounts, setAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [excludedAccounts, setExcludedAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [exclusionSaving, setExclusionSaving] = useState(false);

  // Campaign Groups
  const [campaignGroups, setCampaignGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  // Campaigns
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState('');

  // Date range
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(todayStr());

  // Budget
  const [budget, setBudget] = useState({ totalUSD: '', totalZAR: '', note: '' });
  const [showBudgetModal, setShowBudgetModal] = useState(false);

  // Pacing
  const [pacingData, setPacingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // AI Report
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const now = new Date();

  // Derive the budget month from the startDate (budget persists per calendar month)
  const budgetYear = parseInt(startDate.split('-')[0]);
  const budgetMonth = parseInt(startDate.split('-')[1]);

  // Load budget when start month changes
  useEffect(() => {
    const stored = loadBudget(budgetYear, budgetMonth);
    setBudget(stored);
  }, [budgetYear, budgetMonth]);

  // Load accounts on login — load exclusions first, then accounts so exclusions apply immediately
  useEffect(() => {
    if (session) { loadExclusions().then(() => loadAccounts()); }
  }, [session]);

  // Load campaign groups/campaigns when accounts change
  useEffect(() => {
    if (selectedAccounts.length > 0) { loadCampaignGroups(); loadCampaigns(); }
    else { setCampaignGroups([]); setSelectedGroups([]); setCampaigns([]); setSelectedCampaigns([]); }
  }, [selectedAccounts]);

  useEffect(() => {
    if (selectedAccounts.length > 0) loadCampaigns();
  }, [selectedGroups]);

  // Auto-refresh (current period only)
  useEffect(() => {
    const isToday = endDate === todayStr();
    if (!isToday || selectedAccounts.length === 0) return;
    const interval = setInterval(() => loadPacing(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedAccounts, selectedCampaigns, selectedGroups, startDate, endDate]);

  async function loadAccounts() {
    setLoadingAccounts(true);
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
        // Apply any saved exclusions immediately using the ref
        const excl = excludedRef.current || [];
        setSelectedAccounts(data.map(a => a.id).filter(id => !excl.includes(id)));
      }
    } catch (err) { console.error(err); }
    setLoadingAccounts(false);
  }

  // Use a ref to hold exclusions so loadAccounts can read the latest value synchronously
  const excludedRef = React.useRef([]);

  async function loadExclusions() {
    try {
      const res = await fetch('/api/exclusions');
      if (res.ok) {
        const data = await res.json();
        const excl = data.excludedAccountIds || [];
        excludedRef.current = excl;
        setExcludedAccounts(excl);
      }
    } catch (err) { console.error(err); }
  }

  async function saveExclusions(newExclusions) {
    setExclusionSaving(true);
    try {
      await fetch('/api/exclusions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludedAccountIds: newExclusions }),
      });
    } catch (err) { console.error(err); }
    setExclusionSaving(false);
  }

  function toggleExcludeAccount(id) {
    setExcludedAccounts(prev => {
      const newExcl = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      // Also update selected
      if (!prev.includes(id)) {
        // Excluding — remove from selected
        setSelectedAccounts(s => s.filter(x => x !== id));
      } else {
        // Un-excluding — add back to selected
        setSelectedAccounts(s => [...s, id]);
      }
      saveExclusions(newExcl);
      return newExcl;
    });
  }

  async function loadCampaignGroups() {
    setLoadingGroups(true);
    try {
      const res = await fetch('/api/campaigngroups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: selectedAccounts }),
      });
      if (res.ok) { const data = await res.json(); setCampaignGroups(data); setSelectedGroups(data.map(g => g.id)); }
    } catch (err) { console.error(err); }
    setLoadingGroups(false);
  }

  async function loadCampaigns() {
    setLoadingCampaigns(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: selectedAccounts, campaignGroupIds: selectedGroups.length > 0 ? selectedGroups : null }),
      });
      if (res.ok) { const data = await res.json(); setCampaigns(data); setSelectedCampaigns(data.map(c => c.id)); }
    } catch (err) { console.error(err); }
    setLoadingCampaigns(false);
  }

  async function loadPacing() {
    if (selectedAccounts.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/pacing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountIds: selectedAccounts,
          campaignGroupIds: selectedGroups.length < campaignGroups.length ? selectedGroups : null,
          campaignIds: selectedCampaigns.length < campaigns.length ? selectedCampaigns : null,
          startDate,
          endDate,
        }),
      });
      if (res.ok) { setPacingData(await res.json()); setLastRefresh(new Date()); }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  useEffect(() => {
    if (selectedAccounts.length > 0) loadPacing();
    else setPacingData(null);
  }, [selectedAccounts, selectedCampaigns, selectedGroups, startDate, endDate]);

  function handleBudgetSave(newBudget) {
    setBudget(newBudget);
    saveBudget(budgetYear, budgetMonth, newBudget);
  }

  // Helpers
  function makeToggle(setter) {
    return (id) => setter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function makeSelectFiltered(setter) {
    return (filtered) => setter(prev => [...new Set([...prev, ...filtered.map(i => i.id)])]);
  }
  function makeDeselectFiltered(setter) {
    return (filtered) => { const toRemove = new Set(filtered.map(i => i.id)); setter(prev => prev.filter(id => !toRemove.has(id))); };
  }

  // Derived values
  const totalSpend = pacingData?.summary?.totalSpend || 0;
  const todaySpend = pacingData?.summary?.todaySpend || 0;
  const yesterdaySpend = pacingData?.summary?.yesterdaySpend || 0;
  const totalDays = pacingData?.summary?.totalDays || 1;
  const daysElapsed = pacingData?.summary?.daysElapsed || 1;

  const budgetUSD = parseFloat(budget.totalUSD) || 0;
  const budgetZAR = parseFloat(budget.totalZAR) || 0;

  const idealDailySpend = budgetUSD > 0 ? budgetUSD / totalDays : 0;
  const idealSpendToDate = idealDailySpend * daysElapsed;
  const remainingBudget = budgetUSD > 0 ? Math.max(0, budgetUSD - totalSpend) : 0;
  const remainingDays = Math.max(1, totalDays - daysElapsed + 1);
  const avgDailySpend = daysElapsed > 1 ? totalSpend / (daysElapsed - 1) : todaySpend;
  const isCurrentPeriod = endDate === todayStr();
  const projectedTotal = isCurrentPeriod ? totalSpend + avgDailySpend * remainingDays : totalSpend;

  const pacingStatus = getPacingStatus(totalSpend, idealSpendToDate);
  const todayDiffFromIdealPct = idealDailySpend > 0 ? ((todaySpend - idealDailySpend) / idealDailySpend * 100) : 0;
  const improvedToday = idealDailySpend > 0 ? Math.abs(todaySpend - idealDailySpend) <= Math.abs(yesterdaySpend - idealDailySpend) : todaySpend >= yesterdaySpend;
  const budgetUsedPct = budgetUSD > 0 ? Math.min((totalSpend / budgetUSD) * 100, 100) : 0;
  const pacingPct = idealSpendToDate > 0 ? (totalSpend / idealSpendToDate) * 100 : 0;

  const activeAccountCount = selectedAccounts.length;
  const perAccountBudget = budgetUSD > 0 && activeAccountCount > 0 ? budgetUSD / activeAccountCount : 0;

  // ── Change 3: Ranked clients (top contributor first) ──────────────────────
  const clientRows = accounts
    .filter(a => selectedAccounts.includes(a.id))
    .map(a => {
      const totals = pacingData?.accountTotals?.find(t => t.accountId === a.id);
      return {
        ...a,
        totalSpend: totals?.totalSpend || 0,
        todaySpend: totals?.todaySpend || 0,
        yesterdaySpend: totals?.yesterdaySpend || 0,
        pct: perAccountBudget > 0 ? ((totals?.totalSpend || 0) / perAccountBudget) * 100 : 0,
        improved: (totals?.todaySpend || 0) >= (totals?.yesterdaySpend || 0),
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend); // Top contributor first

  const scMap = {
    emerald: { bg: 'bg-emerald-900/40', border: 'border-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-800 text-emerald-200', bar: 'bg-emerald-500' },
    yellow:  { bg: 'bg-yellow-900/30',  border: 'border-yellow-500',  text: 'text-yellow-400',  badge: 'bg-yellow-800 text-yellow-200',  bar: 'bg-yellow-500' },
    red:     { bg: 'bg-red-900/30',     border: 'border-red-500',     text: 'text-red-400',     badge: 'bg-red-800 text-red-200',        bar: 'bg-red-500' },
    slate:   { bg: 'bg-slate-800',      border: 'border-slate-600',   text: 'text-slate-400',   badge: 'bg-slate-700 text-slate-300',    bar: 'bg-slate-500' },
  };
  const sc = scMap[pacingStatus.color];
  const StatusIcon = pacingStatus.icon;

  const filterSummary = [];
  if (selectedGroups.length < campaignGroups.length) filterSummary.push(`${selectedGroups.length}/${campaignGroups.length} groups`);
  if (selectedCampaigns.length < campaigns.length) filterSummary.push(`${selectedCampaigns.length}/${campaigns.length} campaigns`);
  if (excludedAccounts.length > 0) filterSummary.push(`${excludedAccounts.length} excluded`);

  // ── AI Report generator ───────────────────────────────────────────────────
  async function generateAIReport() {
    setShowAIModal(true);
    setAiLoading(true);
    setAiReport('');

    const topClients = clientRows.slice(0, 5).map((c, i) =>
      `  ${i + 1}. ${c.name}: $${c.totalSpend.toFixed(2)} total spend${budgetUSD > 0 ? ` (${c.pct.toFixed(1)}% of per-client budget)` : ''}`
    ).join('\n');

    const prompt = `You are an expert digital marketing analyst. Write a professional, concise pacing report for a LinkedIn advertising campaign based on the following data:

REPORTING PERIOD: ${startDate} to ${endDate}
TOTAL BUDGET: ${budgetUSD > 0 ? '$' + budgetUSD.toFixed(2) + ' USD' : 'Not set'}${budgetZAR > 0 ? ' / R' + budgetZAR.toFixed(2) + ' ZAR' : ''}
TOTAL SPEND TO DATE: $${totalSpend.toFixed(2)}
BUDGET USED: ${budgetUSD > 0 ? budgetUsedPct.toFixed(1) + '%' : 'N/A'}
PACING STATUS: ${pacingStatus.label}
PACING VS IDEAL: ${pacingPct > 0 ? pacingPct.toFixed(1) + '% of ideal pacing' : 'No budget set'}
TODAY'S SPEND: $${todaySpend.toFixed(2)}
YESTERDAY'S SPEND: $${yesterdaySpend.toFixed(2)}
IDEAL DAILY SPEND: ${idealDailySpend > 0 ? '$' + idealDailySpend.toFixed(2) : 'N/A'}
DAYS ELAPSED: ${daysElapsed} of ${totalDays}
REMAINING BUDGET: ${budgetUSD > 0 ? '$' + remainingBudget.toFixed(2) : 'N/A'}
PROJECTED END-OF-PERIOD TOTAL: ${isCurrentPeriod ? '$' + projectedTotal.toFixed(2) : 'N/A (completed period)'}
NUMBER OF ACTIVE ACCOUNTS: ${activeAccountCount}
${excludedAccounts.length > 0 ? `EXCLUDED ACCOUNTS: ${excludedAccounts.length}` : ''}
${budget.note ? `BUDGET NOTES: ${budget.note}` : ''}

TOP CLIENTS BY SPEND:
${topClients || '  No client data available'}

Please write a structured report with:
1. Executive Summary (2-3 sentences)
2. Pacing Analysis (performance vs budget)
3. Today vs Yesterday Trend
4. Top Client Contributors
5. Recommendations (2-3 actionable bullet points)

Keep it professional, data-driven, and concise. Use plain text (no markdown).`;

    try {
      const response = await fetch('/api/ai-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAiReport(`❌ Error (${response.status}): ${data.error || 'Unknown server error'}\n\nCheck your server logs or .env.local for ANTHROPIC_API_KEY.`);
      } else {
        setAiReport(data.report || 'No report generated.');
      }
    } catch (err) {
      setAiReport(`❌ Network error: ${err.message}\n\nMake sure the /api/ai-report route file exists and has been deployed.`);
    }
    setAiLoading(false);
  }

  if (status === 'loading') return <LoadingScreen />;
  if (!session) return <SignInScreen />;

  return (
    <div className="min-h-screen bg-slate-900 text-white">

      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Budget Pacing Tracker</h1>
              <p className="text-xs text-slate-400">LinkedIn Ad Spend — Daily Pacing</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {filterSummary.length > 0 && (
              <span className="text-xs bg-purple-900 text-purple-300 px-3 py-1 rounded-full font-medium">
                {filterSummary.join(' · ')}
              </span>
            )}
            {lastRefresh && <span className="text-xs text-slate-500">Updated {lastRefresh.toLocaleTimeString()}</span>}

            {/* Export buttons in ribbon — only visible when data is loaded */}
            {selectedAccounts.length > 0 && (
              <div className="flex items-center gap-2 border-l border-slate-600 pl-3">
                <button
                  onClick={() => exportToExcel(clientRows, pacingData?.dailyData || [], startDate, endDate, totalSpend, budgetUSD)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors">
                  <FileSpreadsheet className="w-4 h-4" /> Excel
                </button>
                <button
                  onClick={() => exportToPDF(clientRows, pacingData?.dailyData || [], startDate, endDate, totalSpend, budgetUSD, pacingStatus.label)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">
                  <FileText className="w-4 h-4" /> PDF
                </button>
                <button
                  onClick={generateAIReport}
                  className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors">
                  <Sparkles className="w-4 h-4" /> AI Report
                </button>
              </div>
            )}

            <button onClick={loadPacing} disabled={loading || selectedAccounts.length === 0}
              className="flex items-center gap-2 px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm disabled:opacity-40 transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button onClick={() => signOut()}
              className="px-3 py-2 bg-red-700 text-white rounded-lg text-sm hover:bg-red-600 transition-colors">
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6 grid grid-cols-12 gap-6">

        {/* Sidebar */}
        <div className="col-span-3 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)', position: 'sticky', top: 16 }}>

          {/* ── Change 2: Custom Date Range Picker ── */}
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" /> Date Range
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Start Date</label>
                <input type="date" value={startDate}
                  max={endDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">End Date</label>
                <input type="date" value={endDate}
                  min={startDate}
                  max={todayStr()}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            {/* Quick selectors */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {[
                { label: 'Today', fn: () => { setStartDate(todayStr()); setEndDate(todayStr()); } },
                { label: 'This Month', fn: () => { setStartDate(firstOfMonth()); setEndDate(todayStr()); } },
                { label: 'Last 7d', fn: () => { const d = new Date(); d.setDate(d.getDate() - 6); setStartDate(toDateInput(d)); setEndDate(todayStr()); } },
                { label: 'Last 30d', fn: () => { const d = new Date(); d.setDate(d.getDate() - 29); setStartDate(toDateInput(d)); setEndDate(todayStr()); } },
              ].map(q => (
                <button key={q.label} onClick={q.fn}
                  className="px-2 py-1 bg-slate-700 hover:bg-blue-700 text-slate-300 hover:text-white rounded text-xs transition-colors">
                  {q.label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-center">
              <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                {totalDays} day{totalDays !== 1 ? 's' : ''} · {daysElapsed} elapsed
              </span>
            </div>
          </div>

          {/* Budget */}
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5" /> Budget
              </h3>
              <button onClick={() => setShowBudgetModal(true)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            </div>
            {budgetUSD > 0 ? (
              <div className="space-y-2">
                <div>
                  <div className="text-2xl font-bold text-white">{fmtD(budgetUSD)}</div>
                  <div className="text-xs text-slate-400">USD Total Budget</div>
                </div>
                {budgetZAR > 0 && (
                  <div>
                    <div className="text-lg font-bold text-yellow-400">{fmtR(budgetZAR)}</div>
                    <div className="text-xs text-slate-400">ZAR Total Budget</div>
                  </div>
                )}
                <div className="pt-2 border-t border-slate-700 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Ideal daily</span>
                    <span className="text-white font-mono">{fmtD(idealDailySpend)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Per client ({activeAccountCount})</span>
                    <span className="text-slate-300 font-mono">{fmtD(perAccountBudget)}</span>
                  </div>
                </div>
                {budget.note && <div className="text-xs text-slate-500 italic pt-1">{budget.note}</div>}
              </div>
            ) : (
              <button onClick={() => setShowBudgetModal(true)}
                className="w-full py-3 border-2 border-dashed border-slate-600 rounded-lg text-slate-400 text-sm hover:border-blue-500 hover:text-blue-400 transition-colors">
                + Set Budget
              </button>
            )}
          </div>

          {/* Step 1 — Clients (with exclusion) */}
          <div className="flex items-center gap-2 px-1">
            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Clients</span>
            {exclusionSaving && <RefreshCw className="w-3 h-3 text-slate-500 animate-spin ml-auto" />}
          </div>
          {excludedAccounts.length > 0 && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400 flex items-center gap-2">
              <EyeOff className="w-3.5 h-3.5 flex-shrink-0" />
              {excludedAccounts.length} account{excludedAccounts.length > 1 ? 's' : ''} excluded · saved for future sessions
            </div>
          )}
          <FilterSection
            title="Clients"
            icon={Users}
            items={accounts}
            selectedIds={selectedAccounts}
            onToggle={makeToggle(setSelectedAccounts)}
            loading={loadingAccounts}
            searchValue={clientSearch}
            onSearchChange={setClientSearch}
            onSelectFiltered={makeSelectFiltered(setSelectedAccounts)}
            onDeselectFiltered={makeDeselectFiltered(setSelectedAccounts)}
            excludedIds={excludedAccounts}
            onToggleExclude={toggleExcludeAccount}
            totalCount={accounts.length}
            accentColor="blue"
            emptyMessage="No accounts found"
            showExclude={true}
          />

          {selectedAccounts.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-1 pt-1">
                <span className="w-5 h-5 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Campaign Groups</span>
              </div>
              <FilterSection
                title="Campaign Groups"
                icon={Target}
                items={campaignGroups}
                selectedIds={selectedGroups}
                onToggle={makeToggle(setSelectedGroups)}
                loading={loadingGroups}
                searchValue={groupSearch}
                onSearchChange={setGroupSearch}
                onSelectFiltered={makeSelectFiltered(setSelectedGroups)}
                onDeselectFiltered={makeDeselectFiltered(setSelectedGroups)}
                totalCount={campaignGroups.length}
                accentColor="purple"
                emptyMessage="No campaign groups found"
              />
              <div className="flex items-center gap-2 px-1 pt-1">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Campaigns</span>
              </div>
              <FilterSection
                title="Campaigns"
                icon={Target}
                items={campaigns}
                selectedIds={selectedCampaigns}
                onToggle={makeToggle(setSelectedCampaigns)}
                loading={loadingCampaigns}
                searchValue={campaignSearch}
                onSearchChange={setCampaignSearch}
                onSelectFiltered={makeSelectFiltered(setSelectedCampaigns)}
                onDeselectFiltered={makeDeselectFiltered(setSelectedCampaigns)}
                totalCount={campaigns.length}
                accentColor="emerald"
                emptyMessage="No campaigns found"
              />
            </>
          )}
        </div>

        {/* Main Content */}
        <div className="col-span-9 space-y-6">
          {selectedAccounts.length === 0 ? (
            <div className="bg-slate-800 rounded-xl p-16 text-center border border-slate-700">
              <Users className="w-14 h-14 text-slate-600 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">No Clients Selected</h2>
              <p className="text-slate-400">Select at least one client from the sidebar to view pacing</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Budget</div>
                  <div className="text-2xl font-bold text-white mb-1">{budgetUSD > 0 ? fmtD(budgetUSD) : '-'}</div>
                  <button onClick={() => setShowBudgetModal(true)}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> {budgetUSD > 0 ? 'Edit budget' : 'Set budget'}
                  </button>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Spent to Date</div>
                  <div className="text-2xl font-bold text-white mb-1">{fmtD(totalSpend)}</div>
                  <div className="text-xs text-slate-400">
                    {budgetUSD > 0 ? `${fmt(budgetUsedPct, 1)}% of budget` : `Day ${daysElapsed} of ${totalDays}`}
                  </div>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Remaining</div>
                  <div className={`text-2xl font-bold mb-1 ${budgetUSD > 0 && totalSpend > budgetUSD ? 'text-red-400' : 'text-white'}`}>
                    {budgetUSD > 0 ? fmtD(remainingBudget) : '-'}
                  </div>
                  <div className="text-xs text-slate-400">{budgetUSD > 0 ? `${remainingDays} days left` : 'Set a budget'}</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                    {isCurrentPeriod ? 'Projected Total' : 'Final Spend'}
                  </div>
                  <div className={`text-2xl font-bold mb-1 ${
                    budgetUSD > 0 && projectedTotal > budgetUSD * 1.05 ? 'text-red-400' :
                    budgetUSD > 0 && projectedTotal < budgetUSD * 0.9 ? 'text-yellow-400' : 'text-white'
                  }`}>
                    {fmtD(isCurrentPeriod ? projectedTotal : totalSpend)}
                  </div>
                  <div className="text-xs text-slate-400">{isCurrentPeriod ? 'End of period estimate' : 'Final spend'}</div>
                </div>
              </div>

              {/* Pacing Status + Today vs Yesterday */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`rounded-xl p-6 border-2 ${sc.bg} ${sc.border}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Overall Pacing</h3>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${sc.badge}`}>{startDate} → {endDate}</span>
                  </div>
                  <div className="flex items-center gap-4 mb-5">
                    <StatusIcon className={`w-12 h-12 ${sc.text} flex-shrink-0`} />
                    <div>
                      <div className={`text-3xl font-bold ${sc.text}`}>{pacingStatus.label}</div>
                      <div className="text-sm text-slate-400 mt-0.5">
                        {idealSpendToDate > 0 ? `${fmt(pacingPct, 1)}% of ideal pacing` : 'Set a budget to track pacing'}
                      </div>
                    </div>
                  </div>
                  {budgetUSD > 0 && (
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">Actual spend</span>
                          <span className="text-white font-mono">{fmtD(totalSpend)}</span>
                        </div>
                        <div className="flex justify-between text-xs mb-2">
                          <span className="text-slate-400">Ideal by day {daysElapsed}</span>
                          <span className="text-slate-300 font-mono">{fmtD(idealSpendToDate)}</span>
                        </div>
                        <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${sc.bar}`} style={{ width: `${Math.min(budgetUsedPct, 100)}%` }} />
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-slate-500">{fmtD(0)}</span>
                          <span className="text-slate-400">{fmt(budgetUsedPct, 1)}% used</span>
                          <span className="text-slate-500">{fmtD(budgetUSD)}</span>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">Time elapsed</span>
                          <span className="text-slate-300">Day {daysElapsed} / {totalDays}</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-slate-500 rounded-full" style={{ width: `${(daysElapsed / totalDays) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Today vs Yesterday</h3>
                  <div className={`flex items-center gap-3 mb-5 p-4 rounded-xl border ${
                    improvedToday ? 'bg-emerald-900/30 border-emerald-600' : 'bg-red-900/20 border-red-700'
                  }`}>
                    {improvedToday
                      ? <TrendingUp className="w-10 h-10 text-emerald-400 flex-shrink-0" />
                      : <TrendingDown className="w-10 h-10 text-red-400 flex-shrink-0" />
                    }
                    <div>
                      <div className={`text-xl font-bold ${improvedToday ? 'text-emerald-400' : 'text-red-400'}`}>
                        {improvedToday ? 'Pacing Improved' : 'Pacing Declined'}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {idealDailySpend > 0
                          ? `Today is ${Math.abs(todayDiffFromIdealPct).toFixed(1)}% ${todayDiffFromIdealPct >= 0 ? 'above' : 'below'} ideal`
                          : 'Set a budget to see ideal pacing'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-700/60 rounded-lg p-4">
                      <div className="text-xs text-slate-400 mb-1 font-medium">Today</div>
                      <div className="text-2xl font-bold text-white">{fmtD(todaySpend)}</div>
                      {idealDailySpend > 0 && (
                        <div className={`text-xs mt-1 font-medium flex items-center gap-1 ${
                          Math.abs(todayDiffFromIdealPct) <= 10 ? 'text-emerald-400' :
                          todaySpend < idealDailySpend ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {Math.abs(todayDiffFromIdealPct) <= 10 ? <CheckCircle className="w-3 h-3" /> :
                            todaySpend < idealDailySpend ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                          Ideal: {fmtD(idealDailySpend)}
                        </div>
                      )}
                    </div>
                    <div className="bg-slate-700/60 rounded-lg p-4">
                      <div className="text-xs text-slate-400 mb-1 font-medium">Yesterday</div>
                      <div className="text-2xl font-bold text-white">{fmtD(yesterdaySpend)}</div>
                      {yesterdaySpend > 0 && (
                        <div className={`text-xs mt-1 font-medium flex items-center gap-1 ${todaySpend >= yesterdaySpend ? 'text-emerald-400' : 'text-red-400'}`}>
                          {todaySpend >= yesterdaySpend
                            ? <><ChevronUp className="w-3 h-3" /> +{fmtD(todaySpend - yesterdaySpend)} today</>
                            : <><ChevronDown className="w-3 h-3" /> -{fmtD(yesterdaySpend - todaySpend)} today</>}
                        </div>
                      )}
                    </div>
                  </div>
                  {budgetUSD > 0 && isCurrentPeriod && (
                    <div className="mt-4 pt-4 border-t border-slate-700 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Needed per day to hit budget</span>
                        <span className="text-white font-bold font-mono">{fmtD(remainingDays > 0 ? remainingBudget / remainingDays : 0)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Original daily target</span>
                        <span className="text-slate-300 font-mono">{fmtD(idealDailySpend)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Daily Chart */}
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                    Daily Spend — {startDate} to {endDate}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500"></div>On Track</div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-yellow-500"></div>Under</div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-400"></div>Over</div>
                    <div className="flex items-center gap-1.5"><div className="w-6 border-t-2 border-dashed border-blue-300"></div>Ideal</div>
                  </div>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center h-64">
                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                  </div>
                ) : pacingData?.dailyData?.length > 0 ? (
                  <DailyChart dailyData={pacingData.dailyData} idealDailySpend={idealDailySpend} />
                ) : (
                  <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                    No spend data for this period
                  </div>
                )}
              </div>

              {/* Client Breakdown — Ranked */}
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
                    <Users className="w-4 h-4" /> Client Breakdown
                    <span className="text-slate-500 text-xs font-normal normal-case">{activeAccountCount} clients · ranked by spend</span>
                  </h3>
                </div>

                {clientRows.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-6">No client data available</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          {['#', 'Client', 'Today', 'Yesterday', 'Period Total', '% of Budget', 'Trend', 'Pacing Bar'].map(h => (
                            <th key={h} className={`pb-3 text-xs text-slate-400 font-semibold uppercase tracking-wide ${
                              h === '#' ? 'text-center w-8' :
                              h === 'Client' || h === 'Pacing Bar' ? 'text-left' :
                              h === 'Trend' ? 'text-center' : 'text-right'
                            }`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {clientRows.map((client, i) => (
                          <tr key={client.id} className={`border-b border-slate-700/50 ${i % 2 !== 0 ? 'bg-slate-700/20' : ''}`}>
                            <td className="py-3 text-center">
                              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                                i === 0 ? 'bg-yellow-500 text-yellow-900' :
                                i === 1 ? 'bg-slate-400 text-slate-900' :
                                i === 2 ? 'bg-amber-700 text-amber-100' :
                                'bg-slate-700 text-slate-400'
                              }`}>{i + 1}</span>
                            </td>
                            <td className="py-3">
                              <div className="font-semibold text-white text-xs">{client.name}</div>
                              <div className="text-xs text-slate-500 font-mono">ID: {client.id}</div>
                            </td>
                            <td className="py-3 text-right font-mono text-white text-xs">{fmtD(client.todaySpend)}</td>
                            <td className="py-3 text-right font-mono text-slate-300 text-xs">{fmtD(client.yesterdaySpend)}</td>
                            <td className="py-3 text-right font-bold text-white text-xs">{fmtD(client.totalSpend)}</td>
                            <td className="py-3 text-right text-xs">
                              {budgetUSD > 0
                                ? <span className={`font-bold ${client.pct > 100 ? 'text-red-400' : client.pct > 75 ? 'text-yellow-400' : 'text-emerald-400'}`}>{fmt(client.pct, 1)}%</span>
                                : <span className="text-slate-500">-</span>}
                            </td>
                            <td className="py-3 text-center">
                              {client.improved
                                ? <div className="flex items-center justify-center gap-1 text-emerald-400 text-xs font-medium"><TrendingUp className="w-3.5 h-3.5" /> Up</div>
                                : <div className="flex items-center justify-center gap-1 text-red-400 text-xs font-medium"><TrendingDown className="w-3.5 h-3.5" /> Down</div>}
                            </td>
                            <td className="py-3 w-32">
                              {budgetUSD > 0 ? (
                                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${client.pct > 100 ? 'bg-red-500' : client.pct > 75 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.min(client.pct, 100)}%` }} />
                                </div>
                              ) : <span className="text-xs text-slate-600">No budget set</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {clientRows.length > 1 && (
                        <tfoot>
                          <tr className="bg-slate-700/40">
                            <td className="py-3"></td>
                            <td className="py-3 font-bold text-white text-xs uppercase">Total</td>
                            <td className="py-3 text-right font-bold text-white font-mono text-xs">{fmtD(clientRows.reduce((s, r) => s + r.todaySpend, 0))}</td>
                            <td className="py-3 text-right font-bold text-slate-300 font-mono text-xs">{fmtD(clientRows.reduce((s, r) => s + r.yesterdaySpend, 0))}</td>
                            <td className="py-3 text-right font-bold text-white font-mono text-xs">{fmtD(totalSpend)}</td>
                            <td className="py-3 text-right font-bold text-xs">
                              {budgetUSD > 0
                                ? <span className={`${budgetUsedPct > 100 ? 'text-red-400' : budgetUsedPct > 75 ? 'text-yellow-400' : 'text-emerald-400'}`}>{fmt(budgetUsedPct, 1)}%</span>
                                : <span className="text-slate-500">-</span>}
                            </td>
                            <td colSpan={2}></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <BudgetModal show={showBudgetModal} onClose={() => setShowBudgetModal(false)}
        budget={budget} onSave={handleBudgetSave} month={budgetMonth} year={budgetYear} />

      <AIReportModal show={showAIModal} onClose={() => setShowAIModal(false)}
        reportText={aiReport} loading={aiLoading} />
    </div>
  );
}