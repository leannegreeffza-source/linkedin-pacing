'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import {
  TrendingUp, TrendingDown, DollarSign, RefreshCw,
  CheckCircle, AlertCircle, XCircle, Edit3, Save, X,
  ChevronUp, ChevronDown, Users, Calendar, Target, Minus
} from 'lucide-react';

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '0.00';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function fmtD(n) { return `$${fmt(n)}`; }
function fmtR(n) { return `R${fmt(n)}`; }

function getBudgetKey(year, month) {
  return `pacing_budget_${year}_${month}`;
}
function loadBudget(year, month) {
  try {
    const raw = localStorage.getItem(getBudgetKey(year, month));
    return raw ? JSON.parse(raw) : { totalUSD: '', totalZAR: '', note: '' };
  } catch { return { totalUSD: '', totalZAR: '', note: '' }; }
}
function saveBudget(year, month, data) {
  try { localStorage.setItem(getBudgetKey(year, month), JSON.stringify(data)); } catch {}
}

function getPacingStatus(actual, ideal) {
  if (!ideal || ideal === 0) return { label: 'No Budget Set', color: 'slate', icon: Minus };
  const ratio = actual / ideal;
  if (ratio >= 0.9 && ratio <= 1.1) return { label: 'On Track', color: 'emerald', icon: CheckCircle };
  if (ratio < 0.9) return { label: 'Under Pacing', color: 'yellow', icon: AlertCircle };
  return { label: 'Over Pacing', color: 'red', icon: XCircle };
}

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
            <p className="text-sm text-slate-400">{monthName} {year}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">
              Total Budget (USD $)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
              <input type="number" step="0.01" placeholder="e.g. 10000"
                value={form.totalUSD}
                onChange={e => setForm(f => ({ ...f, totalUSD: e.target.value }))}
                className="w-full pl-7 pr-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-lg font-bold focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">
              Total Budget (ZAR R) — optional
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">R</span>
              <input type="number" step="0.01" placeholder="e.g. 185000"
                value={form.totalZAR}
                onChange={e => setForm(f => ({ ...f, totalZAR: e.target.value }))}
                className="w-full pl-7 pr-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-lg font-bold focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">
              Budget Notes
            </label>
            <textarea placeholder="e.g. Q1 LinkedIn budget"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 p-6 pt-0">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 font-medium text-sm">
            Cancel
          </button>
          <button onClick={() => { onSave(form); onClose(); }}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> Save Budget
          </button>
        </div>
      </div>
    </div>
  );
}

function DailyChart({ dailyData, idealDailySpend }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!dailyData || dailyData.length === 0) return;

    function renderChart() {
      const el = canvasRef.current;
      if (!el || !window.Chart) return;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const labels = dailyData.map(d => `${d.day}`);
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
            {
              label: 'Daily Spend ($)',
              data: spends,
              backgroundColor: barColors,
              borderRadius: 4,
              order: 2,
            },
            {
              label: 'Ideal Daily ($)',
              data: idealLine,
              type: 'line',
              borderColor: 'rgba(147,197,253,0.8)',
              borderWidth: 2,
              borderDash: [5, 4],
              pointRadius: 0,
              fill: false,
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
            tooltip: {
              callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}` },
            },
          },
          scales: {
            x: {
              ticks: { color: '#64748b', font: { size: 10 } },
              grid: { color: 'rgba(51,65,85,0.5)' },
              title: { display: true, text: 'Day of Month', color: '#64748b', font: { size: 11 } },
            },
            y: {
              ticks: { color: '#64748b', font: { size: 10 }, callback: v => `$${v}` },
              grid: { color: 'rgba(51,65,85,0.5)' },
              beginAtZero: true,
            },
          },
        },
      });
    }

    if (window.Chart) {
      renderChart();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      script.onload = renderChart;
      document.head.appendChild(script);
    }

    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [dailyData, idealDailySpend]);

  return (
    <div style={{ height: 280, position: 'relative' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export default function PacingDashboard() {
  const { data: session, status } = useSession();

  const [accounts, setAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const [budget, setBudget] = useState({ totalUSD: '', totalZAR: '', note: '' });
  const [showBudgetModal, setShowBudgetModal] = useState(false);

  const [pacingData, setPacingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    const stored = loadBudget(selectedYear, selectedMonth);
    setBudget(stored);
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    if (session) loadAccounts();
  }, [session]);

  useEffect(() => {
    const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === (now.getMonth() + 1);
    if (!isCurrentMonth || selectedAccounts.length === 0) return;
    const interval = setInterval(() => loadPacing(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedAccounts, selectedMonth, selectedYear]);

  async function loadAccounts() {
    setLoadingAccounts(true);
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
        setSelectedAccounts(data.map(a => a.id));
      }
    } catch (err) { console.error(err); }
    setLoadingAccounts(false);
  }

  async function loadPacing() {
    if (selectedAccounts.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/pacing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: selectedAccounts, month: selectedMonth, year: selectedYear }),
      });
      if (res.ok) {
        setPacingData(await res.json());
        setLastRefresh(new Date());
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  useEffect(() => {
    if (selectedAccounts.length > 0) loadPacing();
    else setPacingData(null);
  }, [selectedAccounts, selectedMonth, selectedYear]);

  function handleBudgetSave(newBudget) {
    setBudget(newBudget);
    saveBudget(selectedYear, selectedMonth, newBudget);
  }

  function toggleAccount(id) {
    setSelectedAccounts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  const daysInMonth = pacingData?.summary?.daysInMonth || new Date(selectedYear, selectedMonth, 0).getDate();
  const currentDay = pacingData?.summary?.currentDay || now.getDate();
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === (now.getMonth() + 1);

  const totalSpend = pacingData?.summary?.totalSpend || 0;
  const todaySpend = pacingData?.summary?.todaySpend || 0;
  const yesterdaySpend = pacingData?.summary?.yesterdaySpend || 0;

  const budgetUSD = parseFloat(budget.totalUSD) || 0;
  const budgetZAR = parseFloat(budget.totalZAR) || 0;

  const idealDailySpend = budgetUSD > 0 ? budgetUSD / daysInMonth : 0;
  const idealSpendToDate = idealDailySpend * currentDay;
  const remainingBudget = budgetUSD > 0 ? Math.max(0, budgetUSD - totalSpend) : 0;
  const remainingDays = Math.max(1, daysInMonth - currentDay + 1);

  const avgDailySpend = currentDay > 1 ? totalSpend / (currentDay - 1) : todaySpend;
  const projectedMonthTotal = isCurrentMonth
    ? totalSpend + avgDailySpend * remainingDays
    : totalSpend;

  const pacingStatus = getPacingStatus(totalSpend, idealSpendToDate);

  const todayVsIdeal = idealDailySpend > 0 ? Math.abs(todaySpend - idealDailySpend) : 0;
  const yesterdayVsIdeal = idealDailySpend > 0 ? Math.abs(yesterdaySpend - idealDailySpend) : 0;
  const improvedToday = idealDailySpend > 0
    ? todayVsIdeal <= yesterdayVsIdeal
    : todaySpend >= yesterdaySpend;

  const todayDiffFromIdealPct = idealDailySpend > 0 ? ((todaySpend - idealDailySpend) / idealDailySpend * 100) : 0;
  const budgetUsedPct = budgetUSD > 0 ? Math.min((totalSpend / budgetUSD) * 100, 100) : 0;
  const pacingPct = idealSpendToDate > 0 ? (totalSpend / idealSpendToDate) * 100 : 0;

  const monthName = new Date(selectedYear, selectedMonth - 1).toLocaleString('default', { month: 'long' });

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(selectedYear, i).toLocaleString('default', { month: 'long' }),
  }));

  const activeAccountCount = selectedAccounts.length;
  const perAccountBudget = budgetUSD > 0 && activeAccountCount > 0 ? budgetUSD / activeAccountCount : 0;

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
    });

  const scMap = {
    emerald: { bg: 'bg-emerald-900/40', border: 'border-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-800 text-emerald-200', bar: 'bg-emerald-500' },
    yellow:  { bg: 'bg-yellow-900/30',  border: 'border-yellow-500',  text: 'text-yellow-400',  badge: 'bg-yellow-800 text-yellow-200',  bar: 'bg-yellow-500' },
    red:     { bg: 'bg-red-900/30',     border: 'border-red-500',     text: 'text-red-400',     badge: 'bg-red-800 text-red-200',        bar: 'bg-red-500' },
    slate:   { bg: 'bg-slate-800',      border: 'border-slate-600',   text: 'text-slate-400',   badge: 'bg-slate-700 text-slate-300',    bar: 'bg-slate-500' },
  };
  const sc = scMap[pacingStatus.color];
  const StatusIcon = pacingStatus.icon;

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
            {lastRefresh && (
              <span className="text-xs text-slate-500">Updated {lastRefresh.toLocaleTimeString()}</span>
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
        <div className="col-span-3 space-y-4">

          {/* Month/Year */}
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" /> Reporting Period
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Month</label>
                <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500">
                  {monthOptions.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Year</label>
                <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500">
                  {[2023, 2024, 2025, 2026].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            {isCurrentMonth && (
              <div className="mt-2 text-center">
                <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full font-medium">
                  Current Month — Day {currentDay} of {daysInMonth}
                </span>
              </div>
            )}
          </div>

          {/* Budget */}
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5" /> {monthName} Budget
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
                    <span className="text-slate-400">Per client</span>
                    <span className="text-slate-300 font-mono">{fmtD(perAccountBudget)}</span>
                  </div>
                </div>
                {budget.note && (
                  <div className="text-xs text-slate-500 italic pt-1">{budget.note}</div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowBudgetModal(true)}
                className="w-full py-3 border-2 border-dashed border-slate-600 rounded-lg text-slate-400 text-sm hover:border-blue-500 hover:text-blue-400 transition-colors">
                + Set {monthName} Budget
              </button>
            )}
          </div>

          {/* Clients */}
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Clients
                <span className="text-blue-400">({selectedAccounts.length}/{accounts.length})</span>
              </h3>
              {loadingAccounts && <RefreshCw className="w-3 h-3 text-slate-400 animate-spin" />}
            </div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setSelectedAccounts(accounts.map(a => a.id))}
                className="flex-1 px-2 py-1 bg-blue-700 text-white rounded text-xs font-medium hover:bg-blue-600">
                All
              </button>
              <button onClick={() => setSelectedAccounts([])}
                className="flex-1 px-2 py-1 bg-slate-600 text-slate-300 rounded text-xs font-medium hover:bg-slate-500">
                None
              </button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {accounts.map(account => {
                const selected = selectedAccounts.includes(account.id);
                const totals = pacingData?.accountTotals?.find(t => t.accountId === account.id);
                return (
                  <label key={account.id}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer border transition-colors ${
                      selected
                        ? 'bg-blue-900/40 border-blue-600 text-white'
                        : 'border-slate-600 text-slate-400 hover:bg-slate-700'
                    }`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleAccount(account.id)}
                      className="w-3.5 h-3.5 accent-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white truncate">{account.name}</div>
                      <div className="text-xs text-slate-500 font-mono">ID: {account.id}</div>
                      {totals && (
                        <div className="text-xs text-emerald-400 font-mono mt-0.5">
                          {fmtD(totals.totalSpend)} spent
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
              {accounts.length === 0 && !loadingAccounts && (
                <p className="text-xs text-slate-500 text-center py-4">No accounts found</p>
              )}
            </div>
          </div>
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
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Monthly Budget</div>
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
                    {budgetUSD > 0 ? `${fmt(budgetUsedPct, 1)}% of budget` : `Day ${currentDay} of ${daysInMonth}`}
                  </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Remaining</div>
                  <div className={`text-2xl font-bold mb-1 ${budgetUSD > 0 && totalSpend > budgetUSD ? 'text-red-400' : 'text-white'}`}>
                    {budgetUSD > 0 ? fmtD(remainingBudget) : '-'}
                  </div>
                  <div className="text-xs text-slate-400">
                    {budgetUSD > 0 ? `${remainingDays} days left` : 'Set a budget'}
                  </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                    {isCurrentMonth ? 'Projected Total' : 'Final Spend'}
                  </div>
                  <div className={`text-2xl font-bold mb-1 ${
                    budgetUSD > 0 && projectedMonthTotal > budgetUSD * 1.05 ? 'text-red-400' :
                    budgetUSD > 0 && projectedMonthTotal < budgetUSD * 0.9 ? 'text-yellow-400' : 'text-white'
                  }`}>
                    {fmtD(isCurrentMonth ? projectedMonthTotal : totalSpend)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {isCurrentMonth ? 'End of month estimate' : 'Final spend'}
                  </div>
                </div>
              </div>

              {/* Pacing Status + Today vs Yesterday */}
              <div className="grid grid-cols-2 gap-4">

                {/* Pacing Status */}
                <div className={`rounded-xl p-6 border-2 ${sc.bg} ${sc.border}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Overall Pacing</h3>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${sc.badge}`}>
                      {monthName} {selectedYear}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mb-5">
                    <StatusIcon className={`w-12 h-12 ${sc.text} flex-shrink-0`} />
                    <div>
                      <div className={`text-3xl font-bold ${sc.text}`}>{pacingStatus.label}</div>
                      <div className="text-sm text-slate-400 mt-0.5">
                        {idealSpendToDate > 0
                          ? `${fmt(pacingPct, 1)}% of ideal pacing`
                          : 'Set a budget to track pacing'}
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
                          <span className="text-slate-400">Ideal by day {currentDay}</span>
                          <span className="text-slate-300 font-mono">{fmtD(idealSpendToDate)}</span>
                        </div>
                        <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${sc.bar}`}
                            style={{ width: `${Math.min(budgetUsedPct, 100)}%` }} />
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
                          <span className="text-slate-300">Day {currentDay} / {daysInMonth}</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-slate-500 rounded-full"
                            style={{ width: `${(currentDay / daysInMonth) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Today vs Yesterday */}
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
                          {Math.abs(todayDiffFromIdealPct) <= 10
                            ? <CheckCircle className="w-3 h-3" />
                            : todaySpend < idealDailySpend
                            ? <ChevronDown className="w-3 h-3" />
                            : <ChevronUp className="w-3 h-3" />
                          }
                          Ideal: {fmtD(idealDailySpend)}
                        </div>
                      )}
                    </div>
                    <div className="bg-slate-700/60 rounded-lg p-4">
                      <div className="text-xs text-slate-400 mb-1 font-medium">Yesterday</div>
                      <div className="text-2xl font-bold text-white">{fmtD(yesterdaySpend)}</div>
                      {yesterdaySpend > 0 && (
                        <div className={`text-xs mt-1 font-medium flex items-center gap-1 ${
                          todaySpend >= yesterdaySpend ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {todaySpend >= yesterdaySpend
                            ? <><ChevronUp className="w-3 h-3" /> +{fmtD(todaySpend - yesterdaySpend)} today</>
                            : <><ChevronDown className="w-3 h-3" /> -{fmtD(yesterdaySpend - todaySpend)} today</>
                          }
                        </div>
                      )}
                    </div>
                  </div>

                  {budgetUSD > 0 && isCurrentMonth && (
                    <div className="mt-4 pt-4 border-t border-slate-700 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Needed per day to hit budget</span>
                        <span className="text-white font-bold font-mono">
                          {fmtD(remainingDays > 0 ? remainingBudget / remainingDays : 0)}
                        </span>
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
                    Daily Spend — {monthName} {selectedYear}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded bg-emerald-500"></div>On Track
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded bg-yellow-500"></div>Under
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded bg-red-400"></div>Over
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 border-t-2 border-dashed border-blue-300"></div>Ideal
                    </div>
                  </div>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center h-64">
                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                  </div>
                ) : pacingData?.dailyData?.length > 0 ? (
                  <DailyChart
                    dailyData={pacingData.dailyData}
                    idealDailySpend={idealDailySpend}
                  />
                ) : (
                  <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                    No spend data for this period
                  </div>
                )}
              </div>

              {/* Client Breakdown Table */}
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Client Breakdown
                  <span className="text-slate-500 text-xs font-normal normal-case">
                    {activeAccountCount} clients selected
                  </span>
                </h3>
                {clientRows.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-6">No client data available</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          {['Client', 'Today', 'Yesterday', 'Month Total', '% of Budget', 'Trend', 'Pacing Bar'].map(h => (
                            <th key={h} className={`pb-3 text-xs text-slate-400 font-semibold uppercase tracking-wide ${h === 'Client' || h === 'Pacing Bar' ? 'text-left' : 'text-right'} ${h === 'Trend' ? 'text-center' : ''}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {clientRows.map((client, i) => (
                          <tr key={client.id} className={`border-b border-slate-700/50 ${i % 2 !== 0 ? 'bg-slate-700/20' : ''}`}>
                            <td className="py-3">
                              <div className="font-semibold text-white text-xs">{client.name}</div>
                              <div className="text-xs text-slate-500 font-mono">ID: {client.id}</div>
                            </td>
                            <td className="py-3 text-right font-mono text-white text-xs">{fmtD(client.todaySpend)}</td>
                            <td className="py-3 text-right font-mono text-slate-300 text-xs">{fmtD(client.yesterdaySpend)}</td>
                            <td className="py-3 text-right font-bold text-white text-xs">{fmtD(client.totalSpend)}</td>
                            <td className="py-3 text-right text-xs">
                              {budgetUSD > 0
                                ? <span className={`font-bold ${client.pct > 100 ? 'text-red-400' : client.pct > 75 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                    {fmt(client.pct, 1)}%
                                  </span>
                                : <span className="text-slate-500">-</span>
                              }
                            </td>
                            <td className="py-3 text-center">
                              {client.improved
                                ? <div className="flex items-center justify-center gap-1 text-emerald-400 text-xs font-medium">
                                    <TrendingUp className="w-3.5 h-3.5" /> Up
                                  </div>
                                : <div className="flex items-center justify-center gap-1 text-red-400 text-xs font-medium">
                                    <TrendingDown className="w-3.5 h-3.5" /> Down
                                  </div>
                              }
                            </td>
                            <td className="py-3 w-32">
                              {budgetUSD > 0 ? (
                                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      client.pct > 100 ? 'bg-red-500' :
                                      client.pct > 75 ? 'bg-yellow-500' : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${Math.min(client.pct, 100)}%` }}
                                  />
                                </div>
                              ) : (
                                <span className="text-xs text-slate-600">No budget set</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {clientRows.length > 1 && (
                        <tfoot>
                          <tr className="bg-slate-700/40">
                            <td className="py-3 font-bold text-white text-xs uppercase">Total</td>
                            <td className="py-3 text-right font-bold text-white font-mono text-xs">
                              {fmtD(clientRows.reduce((s, r) => s + r.todaySpend, 0))}
                            </td>
                            <td className="py-3 text-right font-bold text-slate-300 font-mono text-xs">
                              {fmtD(clientRows.reduce((s, r) => s + r.yesterdaySpend, 0))}
                            </td>
                            <td className="py-3 text-right font-bold text-white font-mono text-xs">
                              {fmtD(totalSpend)}
                            </td>
                            <td className="py-3 text-right font-bold text-xs">
                              {budgetUSD > 0
                                ? <span className={`${budgetUsedPct > 100 ? 'text-red-400' : budgetUsedPct > 75 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                    {fmt(budgetUsedPct, 1)}%
                                  </span>
                                : <span className="text-slate-500">-</span>
                              }
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

      <BudgetModal
        show={showBudgetModal}
        onClose={() => setShowBudgetModal(false)}
        budget={budget}
        onSave={handleBudgetSave}
        month={selectedMonth}
        year={selectedYear}
      />
    </div>
  );
}
