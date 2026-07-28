'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
const BODTab   = dynamic(() => import('./BODTab'),   { ssr: false });
const BOD2Tab  = dynamic(() => import('./BOD2Tab'),  { ssr: false });
const KenyaTab = dynamic(() => import('./KenyaTab'), { ssr: false });
const MetaTab  = dynamic(() => import('./MetaTab'),  { ssr: false });
import { useSession, signIn, signOut } from 'next-auth/react';
import {
  TrendingUp, TrendingDown, DollarSign, RefreshCw,
  CheckCircle, AlertCircle, XCircle, Edit3, Save, X,
  ChevronUp, ChevronDown, Users, Calendar, Target, Minus, Search,
  EyeOff, Eye, Download, FileText, Sparkles, FileSpreadsheet, Upload, Activity
} from 'lucide-react';

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '0.00';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtD(n) { return `$${fmt(n)}`; }
function fmtR(n) { return `R${fmt(n)}`; }

// Detect billing currency. Priority:
// 1. Real API field (currencyCode/currency) if the accounts route ever returns one
// 2. Known ZAR account IDs (add new ones here as they appear)
// 3. Account-name pattern (e.g. "..._ZAR")
const KNOWN_ZAR_ACCOUNT_IDS = new Set(['512261276', '518886222']);
function detectCurrency(account) {
  if (!account) return 'USD';
  const api = (account.currencyCode || account.currency || '').toUpperCase();
  if (api === 'ZAR' || api === 'USD') return api;
  if (KNOWN_ZAR_ACCOUNT_IDS.has(String(account.id))) return 'ZAR';
  const tokens = (account.name || '').toUpperCase().split(/[_\s-]+/);
  return tokens.includes('ZAR') ? 'ZAR' : 'USD';
}

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
  if (!ideal || ideal === 0) return { label: 'No Target Set', color: 'slate', icon: Minus };
  const ratio = actual / ideal;
  if (ratio >= 0.9 && ratio <= 1.1) return { label: 'On Track', color: 'emerald', icon: CheckCircle };
  if (ratio < 0.9) return { label: 'Under Pacing', color: 'yellow', icon: AlertCircle };
  return { label: 'Over Pacing', color: 'emerald', icon: CheckCircle }; // green — over is good
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
// ── ClientTable ───────────────────────────────────────────────────────────────
function ClientTable({ rows, currencySymbol, fmtCur, calcCTR, calcCPC, onRowClick, daysElapsed, lastMonthDays }) {
  const [search, setSearch] = React.useState('');
  const filtered = !search ? rows
    : rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || String(r.id).includes(search));
  const de = daysElapsed || 1;
  const lmd = lastMonthDays || 30;
  const totalThisMonth  = filtered.reduce((s, r) => s + r.totalSpend, 0);
  const totalLastMonth  = filtered.reduce((s, r) => s + (r.lastMonthSpend || 0), 0);
  const totalAvgThis    = de > 0 ? totalThisMonth / de : 0;
  const totalAvgLast    = lmd > 0 ? totalLastMonth / lmd : 0;
  return (
    <div>
      {rows.length > 0 && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
            <input type="text" placeholder="Search client or account ID..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1.5 text-slate-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
          </div>
          {rows.some(r => r.isNewSpender) && (
            <div className="flex items-center gap-1.5 text-xs text-red-300">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              New this month (no spend last month)
            </div>
          )}
        </div>
      )}
      {rows.length === 0
        ? <p className="text-slate-500 text-sm text-center py-6">No accounts in this currency group</p>
        : filtered.length === 0
        ? <p className="text-slate-500 text-sm text-center py-6">No results for "{search}"</p>
        : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                {['Client', 'Account ID', 'This Month', 'Last Month', 'Avg Daily (This Mo.)', 'Avg Daily (Last Mo.)'].map(h => (
                  <th key={h} className={`pb-3 text-xs text-slate-400 font-bold uppercase tracking-wide ${['Client','Account ID'].includes(h) ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((client, i) => {
                const avgThis = de > 0 ? client.totalSpend / de : 0;
                const avgLast = lmd > 0 ? (client.lastMonthSpend || 0) / lmd : 0;
                const vsLast  = client.lastMonthSpend > 0
                  ? ((client.totalSpend - client.lastMonthSpend) / client.lastMonthSpend) * 100 : null;
                return (
                  <tr key={client.id}
                    className={`border-b border-slate-700/50 ${client.isNewSpender ? 'bg-red-900/20 hover:bg-red-900/30' : i % 2 !== 0 ? 'bg-slate-700/20 hover:bg-slate-700/40' : 'hover:bg-slate-700/40'} cursor-pointer`}
                    onClick={() => onRowClick(client)}>
                    <td className="py-2.5 pr-4 max-w-xs">
                      <div className="flex items-center gap-1.5">
                        {client.isNewSpender && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title="New spender this month" />}
                        <div className={`font-semibold text-xs truncate hover:text-blue-300 ${client.isNewSpender ? 'text-red-300' : 'text-white'}`}>{client.name}</div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4"><div className="text-xs text-slate-400 font-mono">{client.id}</div></td>
                    <td className="py-2.5 text-right text-xs">
                      <div className="font-bold text-white font-mono">{fmtCur(client.totalSpend)}</div>
                      {vsLast !== null && (
                        <div className={`text-xs font-mono ${vsLast >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {vsLast >= 0 ? '+' : ''}{vsLast.toFixed(1)}% vs LM
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-300 text-xs">
                      {client.lastMonthSpend > 0 ? fmtCur(client.lastMonthSpend) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className={`py-2.5 text-right font-mono text-xs font-semibold ${avgThis >= avgLast && avgLast > 0 ? 'text-emerald-400' : avgLast > 0 ? 'text-yellow-400' : 'text-white'}`}>
                      {fmtCur(avgThis)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-400 text-xs">
                      {avgLast > 0 ? fmtCur(avgLast) : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-slate-600 bg-slate-700/40">
                  <td className="py-3 font-bold text-white text-xs uppercase" colSpan={2}>
                    Total{search ? ` (${filtered.length} of ${rows.length})` : ''}
                  </td>
                  <td className="py-3 text-right font-bold text-white font-mono text-xs">{fmtCur(totalThisMonth)}</td>
                  <td className="py-3 text-right font-bold text-slate-300 font-mono text-xs">{totalLastMonth > 0 ? fmtCur(totalLastMonth) : '—'}</td>
                  <td className={`py-3 text-right font-bold font-mono text-xs ${totalAvgThis >= totalAvgLast && totalAvgLast > 0 ? 'text-emerald-400' : 'text-white'}`}>{fmtCur(totalAvgThis)}</td>
                  <td className="py-3 text-right font-bold text-slate-300 font-mono text-xs">{totalAvgLast > 0 ? fmtCur(totalAvgLast) : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p className="text-xs text-slate-600 mt-3">Click any row to drill into that account</p>
        </div>
      )}
    </div>
  );
}

function FilterSection({ title, icon: Icon, items, selectedIds, onToggle, loading,
  searchValue, onSearchChange, onSelectFiltered, onDeselectFiltered,
  excludedIds, onToggleExclude, onUploadExclusion, onClearExclusion, uploadingExcl, uploadedCount,
  totalCount, accentColor = 'blue', emptyMessage = 'No items found', showExclude = false }) {

  const [showExcluded, setShowExcluded] = React.useState(false);
  const fileInputRef = React.useRef(null);

  // Visible items: non-excluded by default; show excluded when toggled
  const activeItems  = items.filter(i => !excludedIds?.includes(i.id));
  const excludedItems = items.filter(i => excludedIds?.includes(i.id));
  const listItems = showExcluded ? excludedItems : activeItems;

  const filtered = listItems.filter(item =>
    !searchValue ||
    item.name.toLowerCase().includes(searchValue.toLowerCase()) ||
    String(item.id).includes(searchValue)
  );
  const selectedCount = selectedIds.filter(id => !excludedIds?.includes(id)).length;

  const colors = {
    blue:    { badge: 'text-blue-400', selected: 'bg-blue-900/40 border-blue-600', btn: 'bg-blue-700 hover:bg-blue-600' },
    purple:  { badge: 'text-purple-400', selected: 'bg-purple-900/40 border-purple-600', btn: 'bg-purple-700 hover:bg-purple-600' },
    emerald: { badge: 'text-emerald-400', selected: 'bg-emerald-900/40 border-emerald-600', btn: 'bg-emerald-700 hover:bg-emerald-600' },
  };
  const c = colors[accentColor] || colors.blue;

  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" /> {title}
        </h3>
        {loading
          ? <span className="text-xs text-slate-400 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /></span>
          : <span className={`text-xs font-bold ${c.badge}`}>{selectedCount}/{activeItems.length}</span>
        }
      </div>

      {/* Exclusion controls — upload + stats */}
      {showExclude && (
        <div className="mb-3 pb-3 border-b border-slate-700 space-y-1.5">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => { onUploadExclusion?.(e.target.files?.[0]); fileInputRef.current.value=''; }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingExcl}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex-1 justify-center">
              <Upload className="w-3 h-3" />
              {uploadingExcl ? 'Parsing…' : 'Upload Exclusion List'}
            </button>
            {uploadedCount > 0 && (
              <button onClick={onClearExclusion} className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5 bg-slate-700 rounded-lg" title="Clear uploaded exclusion list">
                ✕ Clear
              </button>
            )}
          </div>
          {excludedIds?.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-red-400">{excludedIds.length} excluded{uploadedCount > 0 ? ` (${uploadedCount} from file)` : ''}</span>
              <button onClick={() => setShowExcluded(s => !s)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${showExcluded ? 'bg-red-900/40 text-red-300' : 'text-slate-500 hover:text-slate-300'}`}>
                {showExcluded ? `Hide excluded` : `Show excluded (${excludedItems.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
        <input type="text"
          placeholder={showExcluded ? 'Search excluded…' : `Search ${title.toLowerCase()}...`}
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

      {/* All / None buttons — only show for active list */}
      {!showExcluded && (
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
      )}

      {searchValue && (
        <div className="text-xs text-slate-500 mb-2 px-1">{filtered.length} of {listItems.length} shown</div>
      )}

      {/* Account list */}
      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
        {filtered.map(item => {
          const isExcluded = excludedIds?.includes(item.id);
          const selected = selectedIds.includes(item.id);
          return (
            <label key={item.id}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${
                isExcluded
                  ? 'border-red-800 bg-red-900/10 cursor-default'
                  : selected
                  ? `${c.selected} text-white cursor-pointer`
                  : 'border-slate-600 text-slate-400 hover:bg-slate-700 cursor-pointer'
              }`}>
              {!isExcluded && (
                <input type="checkbox" checked={selected} onChange={() => onToggle(item.id)}
                  className="w-3.5 h-3.5 accent-blue-500 mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-semibold truncate ${isExcluded ? 'text-red-400' : 'text-white'}`}>{item.name}</div>
                <div className="text-xs text-slate-500 font-mono">ID: {item.id}</div>
              </div>
              {showExclude && onToggleExclude && (
                <button type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleExclude(item.id); }}
                  className={`ml-auto flex-shrink-0 p-1 rounded transition-colors ${isExcluded ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-500 hover:text-red-400'}`}
                  title={isExcluded ? 'Re-include this account' : 'Exclude this account'}>
                  {isExcluded ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              )}
            </label>
          );
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-xs text-slate-500 text-center py-4">
            {showExcluded ? 'No excluded accounts' : searchValue ? `No results for "${searchValue}"` : emptyMessage}
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
        <h1 className="text-3xl font-bold mb-3 text-white">Pacing Tracker</h1>
        <p className="text-slate-400 mb-8">Track your LinkedIn ad spend pacing daily</p>
        <button onClick={() => signIn('linkedin')}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-semibold hover:bg-blue-700 transition-colors">
          Sign in with LinkedIn
        </button>
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-slate-600" />
          <span className="text-xs text-slate-500">also connect</span>
          <div className="flex-1 h-px bg-slate-600" />
        </div>
        <button onClick={() => signIn('facebook')}
          className="w-full bg-[#1877F2] text-white py-3 rounded-xl font-semibold hover:bg-[#166FE5] transition-colors flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
          Connect Facebook for Meta ads
        </button>
        <p className="text-xs text-slate-500 mt-3">Sign in with LinkedIn first, then connect Facebook to access all Meta ad accounts</p>
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
            <h2 className="text-lg font-bold text-white">Edit Monthly Target</h2>
            <p className="text-sm text-slate-400">{monthName} {year} — applies to all date ranges in this month</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">Monthly Target (USD $)</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
              <input type="number" step="0.01" placeholder="e.g. 10000" value={form.totalUSD}
                onChange={e => setForm(f => ({ ...f, totalUSD: e.target.value }))}
                className="w-full pl-7 pr-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-lg font-bold focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">Monthly Target (ZAR R) — optional</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">R</span>
              <input type="number" step="0.01" placeholder="e.g. 185000" value={form.totalZAR}
                onChange={e => setForm(f => ({ ...f, totalZAR: e.target.value }))}
                className="w-full pl-7 pr-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-lg font-bold focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">Target Notes</label>
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
            <Save className="w-4 h-4" /> Save Target
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
// ── Metric helpers ────────────────────────────────────────────────────────────
function calcCTR(clicks, impressions) {
  if (!impressions) return 0;
  return (clicks / impressions) * 100;
}
function calcCPM(spend, impressions) {
  if (!impressions) return 0;
  return (spend / impressions) * 1000;
}
function calcCPC(spend, clicks) {
  if (!clicks) return 0;
  return spend / clicks;
}

// ── DailyChart (with optional forecast line) ──────────────────────────────────
function DailyChart({ dailyData, idealDailySpend, forecastData, budgetUSD, avgLastMonthDaily }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!dailyData || dailyData.length === 0) return;
    function renderChart() {
      const el = canvasRef.current;
      if (!el || !window.Chart) return;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      // Combine actual + forecast labels
      const allLabels = [
        ...dailyData.map(d => d.date.slice(5)),
        ...(forecastData || []).map(d => d.date.slice(5)),
      ];
      const actualLen = dailyData.length;
      const totalLen  = allLabels.length;

      const spends = dailyData.map(d => parseFloat(d.spend.toFixed(2)));
      const forecastSpends = forecastData ? forecastData.map(d => parseFloat(d.forecastSpend.toFixed(2))) : [];
      // Pad actual to full length with null so bars don't extend into forecast zone
      const paddedSpends = [...spends, ...new Array(totalLen - actualLen).fill(null)];
      // Pad forecast to full length — null for actual days
      const paddedForecast = [...new Array(actualLen).fill(null), ...forecastSpends];

      // Use idealDailySpend if set, otherwise fall back to last month avg for colouring
      const benchmarkDaily = idealDailySpend > 0 ? idealDailySpend : (avgLastMonthDaily > 0 ? avgLastMonthDaily : 0);
      const barColors = dailyData.map(d => {
        if (!benchmarkDaily) return 'rgba(52,211,153,0.85)'; // no benchmark — show green (over is good)
        const ratio = d.spend / benchmarkDaily;
        if (ratio >= 0.9 && ratio <= 1.1) return 'rgba(52,211,153,0.85)'; // green — on track
        if (ratio < 0.9) return 'rgba(251,191,36,0.85)';                   // yellow — under
        return 'rgba(52,211,153,0.85)';                                     // green — over is good
      });

      const idealLine = allLabels.map(() => parseFloat((idealDailySpend || 0).toFixed(2)));

      const datasets = [
        { label: 'Daily Spend ($)', data: paddedSpends, backgroundColor: barColors, borderRadius: 4, order: 3, type: 'bar' },
        { label: 'Ideal Daily ($)', data: idealLine, type: 'line', borderColor: 'rgba(147,197,253,0.7)', borderWidth: 2, borderDash: [5, 4], pointRadius: 0, fill: false, order: 1 },
        ...(avgLastMonthDaily > 0 ? [{ label: 'Last Month Avg ($)', data: allLabels.map(() => parseFloat(avgLastMonthDaily.toFixed(2))), type: 'line', borderColor: 'rgba(251,191,36,0.8)', borderWidth: 2, borderDash: [4, 3], pointRadius: 0, fill: false, order: 0 }] : []),
      ];

      if (forecastData && forecastData.length > 0) {
        datasets.push({
          label: 'Forecast ($)',
          data: paddedForecast,
          type: 'line',
          borderColor: 'rgba(167,139,250,0.9)',
          borderWidth: 2,
          borderDash: [8, 4],
          pointRadius: 3,
          pointBackgroundColor: 'rgba(167,139,250,0.9)',
          fill: false,
          order: 2,
        });
      }

      if (budgetUSD > 0) {
        datasets.push({
          label: 'Target ($)',
          data: allLabels.map(() => parseFloat(budgetUSD.toFixed(2))),
          type: 'line',
          borderColor: 'rgba(248,113,113,0.6)',
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          order: 0,
        });
      }

      chartRef.current = new window.Chart(el, {
        type: 'bar',
        data: { labels: allLabels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: $${(ctx.parsed.y || 0).toFixed(2)}` } },
          },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(51,65,85,0.5)' } },
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
  }, [dailyData, idealDailySpend, forecastData, budgetUSD]);

  return <div style={{ height: 300, position: 'relative' }}><canvas ref={canvasRef} /></div>;
}

// ── Forecast calculator (linear with day-of-week weighting) ──────────────────
function buildForecast(dailyData, budget, budgetMonth, budgetYear) {
  if (!dailyData || dailyData.length === 0 || !budget) return [];
  const today = new Date();
  const daysInMonth = new Date(budgetYear, budgetMonth, 0).getDate();

  // Average daily spend from available data (exclude today as it's partial)
  const completeDays = dailyData.filter(d => {
    const dDate = new Date(d.date + 'T00:00:00');
    return dDate < today;
  });
  if (completeDays.length === 0) return [];

  // Day-of-week weights from actual data
  const dowTotals = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
  completeDays.forEach(d => {
    const dow = new Date(d.date + 'T00:00:00').getDay();
    dowTotals[dow].push(d.spend);
  });
  const avgSpend = completeDays.reduce((s, d) => s + d.spend, 0) / completeDays.length;
  const dowWeights = {};
  for (let i = 0; i < 7; i++) {
    const arr = dowTotals[i];
    dowWeights[i] = arr.length > 0 ? (arr.reduce((s, v) => s + v, 0) / arr.length) / (avgSpend || 1) : 1;
  }

  // Build forecast for remaining days this month
  const forecast = [];
  const todayDate = today.getDate();
  for (let day = todayDate + 1; day <= daysInMonth; day++) {
    const d = new Date(budgetYear, budgetMonth - 1, day);
    const dow = d.getDay();
    const weight = dowWeights[dow] || 1;
    const forecastSpend = parseFloat((avgSpend * weight).toFixed(2));
    const dateStr = `${budgetYear}-${String(budgetMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    forecast.push({ date: dateStr, forecastSpend });
  }
  return forecast;
}

// ── MetricsBar — Impressions / Clicks / CTR / CPM / CPC ──────────────────────
function MetricsBar({ totalSpend, totalImpressions, totalClicks, prevData, showComparison }) {
  const ctr = calcCTR(totalClicks, totalImpressions);
  const cpm = calcCPM(totalSpend, totalImpressions);
  const cpc = calcCPC(totalSpend, totalClicks);

  const prevCTR = prevData ? calcCTR(prevData.totalClicks, prevData.totalImpressions) : null;
  const prevCPM = prevData ? calcCPM(prevData.totalSpend, prevData.totalImpressions) : null;
  const prevCPC = prevData ? calcCPC(prevData.totalSpend, prevData.totalClicks) : null;

  function Delta({ current, prev, higherIsBetter = true, suffix = '' }) {
    if (!showComparison || prev == null || prev === 0) return null;
    const diff = current - prev;
    const pct  = (diff / prev) * 100;
    const good = higherIsBetter ? diff >= 0 : diff <= 0;
    return (
      <div className={`text-xs font-medium flex items-center gap-0.5 mt-0.5 ${good ? 'text-emerald-400' : 'text-red-400'}`}>
        {diff >= 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {Math.abs(pct).toFixed(1)}%{suffix}
      </div>
    );
  }

  const metrics = [
    { label: 'Impressions', value: totalImpressions.toLocaleString(), prev: prevData?.totalImpressions, higherIsBetter: true, raw: totalImpressions, prevRaw: prevData?.totalImpressions },
    { label: 'Clicks',      value: totalClicks.toLocaleString(),      prev: prevData?.totalClicks,      higherIsBetter: true, raw: totalClicks, prevRaw: prevData?.totalClicks },
    { label: 'CTR',         value: `${ctr.toFixed(2)}%`,              prev: prevCTR,                   higherIsBetter: true, raw: ctr, prevRaw: prevCTR },
    { label: 'CPM',         value: `$${cpm.toFixed(2)}`,              prev: prevCPM,                   higherIsBetter: false, raw: cpm, prevRaw: prevCPM },
    { label: 'CPC',         value: `$${cpc.toFixed(2)}`,              prev: prevCPC,                   higherIsBetter: false, raw: cpc, prevRaw: prevCPC },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {metrics.map(m => (
        <div key={m.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">{m.label}</div>
          <div className="text-xl font-bold text-white">{m.value}</div>
          {showComparison && m.prevRaw != null && m.prevRaw !== 0 && (() => {
            const diff = m.raw - m.prevRaw;
            const pct = (diff / m.prevRaw) * 100;
            const good = m.higherIsBetter ? diff >= 0 : diff <= 0;
            return (
              <div className={`text-xs font-medium flex items-center gap-0.5 mt-0.5 ${good ? 'text-emerald-400' : 'text-red-400'}`}>
                {diff >= 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {Math.abs(pct).toFixed(1)}% vs prev
              </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
}

// ── AccountDrillDown — single account detail view ─────────────────────────────
function AccountDrillDown({ account, totals, onBack, idealDailySpend, budgetUSD, budgetMonth, budgetYear }) {
  const spend       = totals?.totalSpend || 0;
  const impressions = totals?.totalImpressions || 0;
  const clicks      = totals?.totalClicks || 0;
  const leads       = totals?.totalLeads || 0;
  const dailyData   = totals?.dailyData || [];

  const ctr = calcCTR(clicks, impressions);
  const cpm = calcCPM(spend, impressions);
  const cpc = calcCPC(spend, clicks);

  const forecastData = buildForecast(dailyData, budgetUSD, budgetMonth, budgetYear);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-medium transition-colors">
          ← All Clients
        </button>
        <div>
          <h2 className="text-lg font-bold text-white">{account.name}</h2>
          <div className="text-xs text-slate-500 font-mono">ID: {account.id}</div>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Spend', value: fmtD(spend) },
          { label: 'Impressions', value: impressions.toLocaleString() },
          { label: 'Clicks', value: clicks.toLocaleString() },
          { label: 'CTR', value: `${ctr.toFixed(2)}%` },
          { label: 'CPM', value: `$${cpm.toFixed(2)}` },
        ].map(m => (
          <div key={m.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">{m.label}</div>
            <div className="text-xl font-bold text-white">{m.value}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'CPC', value: `$${cpc.toFixed(2)}` },
          { label: 'Leads', value: leads.toLocaleString() },
        ].map(m => (
          <div key={m.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">{m.label}</div>
            <div className="text-xl font-bold text-white">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Daily chart for this account */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Daily Spend + Forecast</h3>
        {dailyData.length > 0 ? (
          <DailyChart
            dailyData={dailyData}
            idealDailySpend={idealDailySpend}
            forecastData={forecastData}
            budgetUSD={budgetUSD}
          />
        ) : (
          <div className="h-64 flex items-center justify-center text-slate-500 text-sm">No daily data</div>
        )}
      </div>
    </div>
  );
}

// ── ComparisonTable — side-by-side account comparison ────────────────────────
function ComparisonTable({ accounts, accountTotals, selectedIds }) {
  const selected = accounts
    .filter(a => selectedIds.includes(a.id))
    .map(a => {
      const t = accountTotals?.find(x => x.accountId === a.id) || {};
      const spend = t.totalSpend || 0;
      const imp   = t.totalImpressions || 0;
      const clk   = t.totalClicks || 0;
      return {
        ...a,
        spend, imp, clk,
        leads: t.totalLeads || 0,
        ctr: calcCTR(clk, imp),
        cpm: calcCPM(spend, imp),
        cpc: calcCPC(spend, clk),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  if (selected.length === 0) {
    return <p className="text-slate-500 text-sm text-center py-8">Select accounts to compare</p>;
  }

  const cols = ['Spend', 'Impressions', 'Clicks', 'CTR', 'CPM', 'CPC', 'Leads'];
  const getVal = (a, col) => {
    switch(col) {
      case 'Spend':       return { display: fmtD(a.spend), raw: a.spend };
      case 'Impressions': return { display: a.imp.toLocaleString(), raw: a.imp };
      case 'Clicks':      return { display: a.clk.toLocaleString(), raw: a.clk };
      case 'CTR':         return { display: `${a.ctr.toFixed(2)}%`, raw: a.ctr };
      case 'CPM':         return { display: `$${a.cpm.toFixed(2)}`, raw: a.cpm };
      case 'CPC':         return { display: `$${a.cpc.toFixed(2)}`, raw: a.cpc };
      case 'Leads':       return { display: a.leads.toLocaleString(), raw: a.leads };
      default:            return { display: '-', raw: 0 };
    }
  };

  // For each column, who's the best?
  const lowerIsBetter = new Set(['CPM', 'CPC']);
  const bestIdx = {};
  cols.forEach(col => {
    const vals = selected.map((a, i) => ({ i, raw: getVal(a, col).raw }));
    vals.sort((a, b) => lowerIsBetter.has(col) ? a.raw - b.raw : b.raw - a.raw);
    bestIdx[col] = vals[0]?.raw > 0 ? vals[0].i : -1;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700">
            <th className="pb-3 text-left text-xs text-slate-400 font-semibold uppercase tracking-wide w-40">Metric</th>
            {selected.map(a => (
              <th key={a.id} className="pb-3 text-right text-xs text-white font-semibold px-3">
                <div className="truncate max-w-32">{a.name}</div>
                <div className="text-slate-500 font-mono font-normal">{a.id}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cols.map(col => (
            <tr key={col} className="border-b border-slate-700/50">
              <td className="py-3 text-xs text-slate-400 font-semibold uppercase tracking-wide">{col}</td>
              {selected.map((a, i) => {
                const { display, raw } = getVal(a, col);
                const isBest = bestIdx[col] === i && raw > 0;
                return (
                  <td key={a.id} className={`py-3 text-right font-mono text-xs px-3 ${isBest ? 'text-emerald-400 font-bold' : 'text-white'}`}>
                    {display}
                    {isBest && <span className="ml-1 text-emerald-500">▲</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────
async function exportToExcel(clientRows, dailyData, startDate, endDate, totalSpend, budgetUSD) {
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['LinkedIn Pacing Report'],
    ['Period', `${startDate} to ${endDate}`],
    ['Total Spend', totalSpend],
    ['Target', budgetUSD > 0 ? budgetUSD : 'Not set'],
    ['Generated', new Date().toLocaleString()],
    [],
    ['Client Name','Account ID',"Today's Spend ($)","Yesterday's Spend ($)",'Total Spend ($)','Impressions','Clicks','CTR (%)','CPM ($)','CPC ($)','% of Target'],
    ...clientRows.map(c => [
      c.name, c.id,
      parseFloat(c.todaySpend.toFixed(2)), parseFloat(c.yesterdaySpend.toFixed(2)),
      parseFloat(c.totalSpend.toFixed(2)), c.totalImpressions||0, c.totalClicks||0,
      parseFloat(((c.totalClicks||0)/Math.max(c.totalImpressions||1,1)*100).toFixed(2)),
      parseFloat(((c.totalSpend||0)/Math.max(c.totalImpressions||1,1)*1000).toFixed(2)),
      parseFloat(((c.totalSpend||0)/Math.max(c.totalClicks||1,1)).toFixed(2)),
      budgetUSD > 0 ? parseFloat(c.pct.toFixed(1)) : 'N/A',
    ]),
  ]);
  ws1['!cols'] = [40,15,16,18,16,14,10,10,10,10,14].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws1, 'Client Breakdown');
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Date','Spend ($)','Impressions','Clicks','Leads','CTR (%)','CPM ($)','CPC ($)'],
    ...dailyData.map(d => [d.date, parseFloat(d.spend.toFixed(2)), d.impressions, d.clicks, d.leads,
      parseFloat((d.impressions>0?d.clicks/d.impressions*100:0).toFixed(2)),
      parseFloat((d.impressions>0?d.spend/d.impressions*1000:0).toFixed(2)),
      parseFloat((d.clicks>0?d.spend/d.clicks:0).toFixed(2))]),
  ]);
  ws2['!cols'] = [14,12,14,10,10,10,10,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws2, 'Daily Spend');
  XLSX.writeFile(wb, `linkedin_pacing_${startDate}_${endDate}.xlsx`);
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
    <h1>LinkedIn Pacing Report</h1>
    <p style="color:#64748b">Period: <strong>${startDate}</strong> to <strong>${endDate}</strong></p>
    <div class="meta">
      <div><div class="label">Total Spend</div><div class="value">$${totalSpend.toFixed(2)}</div></div>
      <div><div class="label">Target</div><div class="value">${budgetUSD > 0 ? '$' + budgetUSD.toFixed(2) : 'Not set'}</div></div>
      <div><div class="label">Pacing Status</div><div class="value">${pacingLabel}</div></div>
    </div>
    <h2>Client Breakdown — Ranked by Contribution</h2>
    <table><thead><tr><th>#</th><th>Client</th><th>Today</th><th>Yesterday</th><th>Period Total</th><th>% of Target</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="margin-top:40px;font-size:11px;color:#94a3b8">Generated by LinkedIn Pacing Tracker • ${new Date().toLocaleString()}</p>
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

  // (Campaign Groups and Campaigns removed)
  const [uploadedExclusions, setUploadedExclusions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pacing_uploaded_excl') || '[]'); } catch { return []; }
  });
  const [uploadingExcl, setUploadingExcl] = useState(false);
  const exclusionFileRef = React.useRef(null);
  const [pacingMode, setPacingMode] = useState('target');
  const [lastMonthData, setLastMonthData] = useState(null);
  const [loadingLastMonth, setLoadingLastMonth] = useState(false);

  // Date range
  const [startDate, setStartDate] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`; });
  const [endDate, setEndDate] = useState(todayStr());

  // Budget
  const [budget, setBudget] = useState({ totalUSD: '', totalZAR: '', note: '' });
  const [activeTab, setActiveTab] = useState('pacing'); // 'pacing' | 'bod' | 'bod2' | 'kenya' | 'meta'
  const [showBudgetModal, setShowBudgetModal] = useState(false);

  // ── Platform toggle (LinkedIn / Meta) ─────────────────────────────────────
  // Default to LinkedIn so existing users see no change on first load. Choice
  // persists in localStorage. When Meta is active:
  //  - API calls route to /api/meta/* instead of /api/*
  //  - In Meta's hierarchy: campaign-groups slot → Meta campaigns,
  //    campaigns slot → Meta ad sets. The UI labels stay the same so the
  //    component re-uses without changes.
  //  - BOD/BOD2/Kenya tabs are hidden — they depend on the LinkedIn-shaped
  //    recon format. Meta-equivalent recon tabs ship in Stage 2.
  const [platform, setPlatform] = useState('linkedin');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pacing_platform');
      if (saved === 'meta' || saved === 'linkedin') setPlatform(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('pacing_platform', platform); } catch {}
    // BOD / BOD2 / Kenya are LinkedIn-only; Meta tab is Meta-only.
    // When platform changes, drop the user back to 'pacing' if they were on a tab
    // that isn't available for the newly-selected platform.
    if (platform === 'meta'    && ['bod','bod2','kenya'].includes(activeTab)) setActiveTab('pacing');
    if (platform === 'linkedin' && activeTab === 'meta')                       setActiveTab('pacing');
  }, [platform]);
  const apiPrefix = platform === 'meta' ? '/api/meta' : '/api';

  // Pacing
  const [pacingData, setPacingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // AI Report
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Drill-down: single account detail view
  const [drillAccount, setDrillAccount] = useState(null); // account object | null

  // Comparison mode: multi-account side-by-side
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelected, setCompareSelected] = useState([]);

  // Period comparison: compare current range against a previous period
  const [showPeriodCompare, setShowPeriodCompare] = useState(false);
  const [prevPacingData, setPrevPacingData] = useState(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [compareStart, setCompareStart] = useState('');
  const [compareEnd,   setCompareEnd]   = useState('');

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

  // Reload accounts when platform toggles (LinkedIn ↔ Meta). Also clears
  // selections from the previous platform so we don't briefly try to filter
  // Meta campaigns by LinkedIn IDs (or vice versa). The if(session) guard
  // prevents this firing on the initial localStorage hydration before login.
  useEffect(() => {
    if (!session) return;
    setSelectedAccounts([]);
    setPacingData(null);
    loadAccounts();
  }, [platform]);

  // Only reload last month when pacingMode switches to trend — NOT on every account change
  const lastMonthLoadedForMode = React.useRef(false);
  useEffect(() => {
    if (pacingMode === 'trend' && selectedAccounts.length > 0 && !lastMonthLoadedForMode.current) {
      lastMonthLoadedForMode.current = true;
      setLastMonthData(null);
      loadLastMonth();
    }
    if (pacingMode !== 'trend') lastMonthLoadedForMode.current = false;
  }, [pacingMode]);

  // Always load last month in background (needed for new-spender detection
  // in Client Breakdown regardless of pacing mode).
  const hasLoadedLastMonth = React.useRef(false);
  useEffect(() => {
    if (selectedAccounts.length > 0 && !hasLoadedLastMonth.current) {
      hasLoadedLastMonth.current = true;
      loadLastMonth();
    }
  }, [selectedAccounts]);

  // Auto-refresh removed — data only updates on manual Refresh button click

  async function loadAccounts() {
    setLoadingAccounts(true);
    try {
      const res = await fetch(`${apiPrefix}/accounts`);
      if (res.ok) {
        const data = await res.json();
        // Normalize IDs to strings — the LinkedIn API returns numeric IDs but
        // exclusion list IDs are always strings, so this prevents silent mismatches.
        const normalized = data.map(a => ({ ...a, id: String(a.id) }));
        setAccounts(normalized);
        const excl = excludedRef.current || [];
        setSelectedAccounts(normalized.map(a => a.id).filter(id => !excl.includes(id)));
      }
    } catch (err) { console.error(err); }
    setLoadingAccounts(false);
  }

  const excludedRef = React.useRef([]);

  async function loadExclusions() {
    try {
      // Single source of truth: the uploaded exclusion file stored in localStorage.
      // Manual per-account server exclusions are no longer used — the uploaded
      // list is the only thing that drives what gets excluded.
      let uploaded = [];
      try { uploaded = JSON.parse(localStorage.getItem('pacing_uploaded_excl') || '[]'); } catch {}
      // Normalize to strings to prevent type mismatches with account IDs from the API
      const normalized = uploaded.map(String);
      excludedRef.current = normalized;
      setExcludedAccounts(normalized);
      setUploadedExclusions(normalized);
    } catch (err) {}
  }

  function saveExclusions(newExclusions) {
    // Eye-icon manual toggles are session-only — not persisted to server.
    // The uploaded exclusion file (localStorage) remains the persistent source of truth.
    excludedRef.current = newExclusions;
    setExcludedAccounts(newExclusions);
  }

  async function handleExclusionFileUpload(file) {
    if (!file) return;
    setUploadingExcl(true);
    try {
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const data = await file.arrayBuffer();
      const wb = window.XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
      const ids = [];
      rows.forEach(row => {
        row.forEach(cell => {
          const val = String(cell).trim();
          if (/^\d{6,12}$/.test(val)) ids.push(val);
        });
      });
      // Normalize to strings — prevents type mismatch with numeric API account IDs
      const unique = [...new Set(ids.map(String))];
      localStorage.setItem('pacing_uploaded_excl', JSON.stringify(unique));
      setUploadedExclusions(unique);
      excludedRef.current = unique;
      setExcludedAccounts(unique);
      // Remove newly excluded accounts from selected immediately
      setSelectedAccounts(prev => prev.filter(id => !unique.includes(String(id))));
      alert(`Loaded ${unique.length} account IDs from exclusion list`);
    } catch (err) {
      alert('Failed to parse file. Use a CSV or Excel file with account IDs.');
    }
    setUploadingExcl(false);
    if (exclusionFileRef.current) exclusionFileRef.current.value = '';
  }

  function clearUploadedExclusions() {
    localStorage.removeItem('pacing_uploaded_excl');
    setUploadedExclusions([]);
    excludedRef.current = [];
    setExcludedAccounts([]);
    // Add all accounts back to selected
    setSelectedAccounts(accounts.map(a => String(a.id)));
  }

  async function loadLastMonth() {
    const zarIds = new Set(accounts.filter(a => detectCurrency(a) === 'ZAR').map(a => String(a.id)));
    const activeIds = selectedAccounts.filter(id => !excludedAccounts.includes(id) && !zarIds.has(String(id)));
    if (activeIds.length === 0) return;
    setLoadingLastMonth(true);
    try {
      const now = new Date();
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const body = {
        accountIds: activeIds,
        startDate: prevStart.toISOString().split('T')[0],
        endDate: prevEnd.toISOString().split('T')[0],
      };
      const res = await fetch(`${apiPrefix}/pacing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) setLastMonthData(await res.json());
    } catch (err) { console.error(err); }
    setLoadingLastMonth(false);
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

  async function loadPacing() {
    // Exclude ZAR-billed accounts from the pacing API call — their spend is
    // denominated in rand, not USD, so including them corrupts the USD totals
    // shown in the summary cards. ZAR accounts appear separately in the
    // Client Breakdown table with their own R-denominated total.
    const zarIds = new Set(
      accounts
        .filter(a => detectCurrency(a) === 'ZAR')
        .map(a => String(a.id))
    );
    const usdOnlyIds = selectedAccounts.filter(id => !zarIds.has(String(id)));
    if (usdOnlyIds.length === 0) return;
    setLoading(true);
    try {
      const body = { accountIds: usdOnlyIds, startDate, endDate };
      const res = await fetch(`${apiPrefix}/pacing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { setPacingData(await res.json()); setLastRefresh(new Date()); }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  // Load pacing once on initial mount when accounts are ready.
  // After that, only the Refresh button triggers a reload.
  const hasInitiallyLoaded = React.useRef(false);
  // Only load pacing ONCE on first account load — never on subsequent account changes.
  // User must click Refresh to reload data after changing accounts.
  useEffect(() => {
    if (selectedAccounts.length > 0 && !hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true;
      loadPacing();
    }
    // Intentionally NO selectedAccounts in deps after initial load —
    // account toggling should never trigger a data reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccounts.length > 0 ? 'ready' : 'waiting']);

  async function loadPrevPeriod(customStart, customEnd) {
    const zarIds = new Set(accounts.filter(a => detectCurrency(a) === 'ZAR').map(a => String(a.id)));
    const usdOnlyIds = selectedAccounts.filter(id => !zarIds.has(String(id)));
    if (usdOnlyIds.length === 0) return;
    setLoadingPrev(true);
    try {
      let psDate, peDate;
      if (customStart && customEnd) {
        // Use custom dates directly
        psDate = customStart;
        peDate = customEnd;
      } else {
        // Auto-calculate: same span as current period, immediately before it
        const start = new Date(startDate + 'T00:00:00');
        const end   = new Date(endDate   + 'T00:00:00');
        const spanDays = Math.round((end - start) / (1000*60*60*24));
        const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - spanDays);
        psDate = prevStart.toISOString().split('T')[0];
        peDate = prevEnd.toISOString().split('T')[0];
        // Store computed dates so inputs show them
        setCompareStart(psDate);
        setCompareEnd(peDate);
      }
      const body = { accountIds: usdOnlyIds, startDate: psDate, endDate: peDate };
      const res = await fetch(`${apiPrefix}/pacing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) setPrevPacingData(await res.json());
    } catch (err) { console.error(err); }
    setLoadingPrev(false);
  }

  function handleBudgetSave(newBudget) {
    setBudget(newBudget);
    saveBudget(budgetYear, budgetMonth, newBudget);
  }

  // Helpers
  function makeToggle(setter) {
    return (id) => setter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function makeSelectFiltered(setter, excludedIds) {
    return (filtered) => {
      const excl = excludedIds || excludedRef.current || [];
      setter(prev => [...new Set([...prev, ...filtered.map(i => i.id).filter(id => !excl.includes(id))])]);
    };
  }
  function makeDeselectFiltered(setter) {
    return (filtered) => { const toRemove = new Set(filtered.map(i => i.id)); setter(prev => prev.filter(id => !toRemove.has(id))); };
  }

  // Derived values — date range data
  // Wrapped in useMemo so numbers only change when pacingData actually changes,
  // not on every scroll/render cycle.
  const {
    totalSpend, todaySpend, yesterdaySpend, dayBeforeYesterdaySpend,
    totalDays, daysElapsed, totalImpressions, totalClicks, totalLeads
  } = React.useMemo(() => ({
    totalSpend:              pacingData?.summary?.totalSpend       || 0,
    todaySpend:              pacingData?.summary?.todaySpend       || 0,
    yesterdaySpend:          pacingData?.summary?.yesterdaySpend   || 0,
    dayBeforeYesterdaySpend: (() => {
      const d = new Date(); d.setDate(d.getDate() - 2);
      const dateStr = d.toISOString().split('T')[0];
      return (pacingData?.dailyData || []).find(d => d.date === dateStr)?.spend || 0;
    })(),
    totalDays:               pacingData?.summary?.totalDays        || 1,
    daysElapsed:             pacingData?.summary?.daysElapsed      || 1,
    totalImpressions:        pacingData?.summary?.totalImpressions || 0,
    totalClicks:             pacingData?.summary?.totalClicks      || 0,
    totalLeads:              pacingData?.summary?.totalLeads       || 0,
  }), [pacingData]);

  const prevTotalSpend       = prevPacingData?.summary?.totalSpend       || 0;
  const prevTotalImpressions = prevPacingData?.summary?.totalImpressions || 0;
  const prevTotalClicks      = prevPacingData?.summary?.totalClicks      || 0;

  const budgetUSD = parseFloat(budget.totalUSD) || 0;
  const budgetZAR = parseFloat(budget.totalZAR) || 0;

  // Budget is always scoped to the FULL calendar month (from budgetYear/budgetMonth)
  // so forecasting is always month-aware regardless of the selected date range
  const daysInBudgetMonth = new Date(budgetYear, budgetMonth, 0).getDate();
  const todayDate = now.getDate();
  const daysRemainingInMonth = Math.max(0, daysInBudgetMonth - todayDate);
  const isCurrentMonth = budgetYear === now.getFullYear() && budgetMonth === (now.getMonth() + 1);

  // Ideal daily is always budget / full month days
  const idealDailySpend = budgetUSD > 0 ? budgetUSD / daysInBudgetMonth : 0;

  // Ideal spend by today (day N of the month) — for pacing status
  const idealSpendToToday = idealDailySpend * todayDate;

  // Pacing compares total spend in selected range vs ideal for same period
  const idealSpendToDate = idealDailySpend * daysElapsed;

  // Remaining budget = full month budget minus all spend so far this month
  const remainingBudget = budgetUSD > 0 ? Math.max(0, budgetUSD - totalSpend) : 0;

  // Avg daily spend = spend up to yesterday ÷ days elapsed (excluding today)
  // Formula: (totalSpend - todaySpend) / (daysElapsed - 1)
  const spendToYesterday = Math.max(0, totalSpend - todaySpend);
  const daysToYesterday  = Math.max(1, daysElapsed - 1);
  const avgDailySpend    = spendToYesterday > 0 ? spendToYesterday / daysToYesterday : todaySpend;

  // Day-by-day pacing — always available, never depends on a target being set.
  const completedDays = (pacingData?.dailyData || []).filter(d => d.date < todayStr());
  const last5Days = completedDays.slice(-5);
  const dayPacingAvg = last5Days.length > 0
    ? last5Days.reduce((s, d) => s + d.spend, 0) / last5Days.length
    : avgDailySpend;
  const latestDaySpend = last5Days.length > 0 ? last5Days[last5Days.length - 1].spend : yesterdaySpend;
  const dayPacingDiff = latestDaySpend - dayPacingAvg;
  const dayPacingPct  = dayPacingAvg > 0 ? (latestDaySpend / dayPacingAvg) * 100 : 100;
  const dayPacingTrend = dayPacingPct >= 95 && dayPacingPct <= 105 ? 'Steady'
    : dayPacingPct > 105 ? 'Trending Up' : 'Trending Down';

  // Month-End Forecast = (spend up to yesterday / days passed) × total days in month
  // i.e. daily average × full month
  const projectedMonthTotal = isCurrentMonth
    ? avgDailySpend * daysInBudgetMonth
    : totalSpend;

  // Needed per day from today to hit the full month budget
  const neededDailyToHitBudget = daysRemainingInMonth > 0
    ? remainingBudget / daysRemainingInMonth
    : 0;

  const isCurrentPeriod = endDate === todayStr();

  const pacingStatus = getPacingStatus(totalSpend, idealSpendToDate);
  const todayDiffFromIdealPct = idealDailySpend > 0 ? ((todaySpend - idealDailySpend) / idealDailySpend * 100) : 0;
  const improvedToday = idealDailySpend > 0 ? Math.abs(todaySpend - idealDailySpend) <= Math.abs(yesterdaySpend - idealDailySpend) : todaySpend >= yesterdaySpend;
  const budgetUsedPct = budgetUSD > 0 ? Math.min((totalSpend / budgetUSD) * 100, 100) : 0;
  const pacingPct = idealSpendToDate > 0 ? (totalSpend / idealSpendToDate) * 100 : 0;

  const lastMonthTotal = lastMonthData?.summary?.totalSpend || 0;
  const lastMonthDays = lastMonthData ? (() => { const s = new Date(lastMonthData.summary?.startDate+'T00:00:00'); const e = new Date(lastMonthData.summary?.endDate+'T00:00:00'); return Math.round((e-s)/(1000*60*60*24))+1; })() : 30;
  const samePeriodLastMonth = (lastMonthTotal / lastMonthDays) * daysElapsed;
  const trendPct = samePeriodLastMonth > 0 ? (totalSpend / samePeriodLastMonth) * 100 : 0;
  const trendDiff = totalSpend - samePeriodLastMonth;
  const trendStatus = samePeriodLastMonth === 0 ? { label: 'No Prior Data', color: 'slate' }
    : trendPct >= 95 && trendPct <= 105 ? { label: 'On Par', color: 'emerald' }
    : trendPct > 105 ? { label: 'Ahead of Last Month', color: 'blue' }
    : { label: 'Behind Last Month', color: 'yellow' };
  const trendProjected = isCurrentMonth ? avgDailySpend * daysInBudgetMonth : totalSpend;
  const trendVsLastMonth = lastMonthTotal > 0 ? ((trendProjected - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  const activeAccountCount = selectedAccounts.length;
  const perAccountBudget = budgetUSD > 0 && activeAccountCount > 0 ? budgetUSD / activeAccountCount : 0;

  const forecastData = isCurrentMonth
    ? buildForecast(pacingData?.dailyData || [], budgetUSD, budgetMonth, budgetYear)
    : [];

  // ── Change 3: Ranked clients (top contributor first) ──────────────────────
  const clientRows = React.useMemo(() => accounts
    .filter(a => selectedAccounts.includes(a.id) && !excludedAccounts.includes(a.id))
    .map(a => {
      const totals = pacingData?.accountTotals?.find(t => t.accountId === a.id);
      const spend = totals?.totalSpend || 0;
      const imp   = totals?.totalImpressions || 0;
      const clk   = totals?.totalClicks || 0;
      const lastMonthTotals = lastMonthData?.accountTotals?.find(t => t.accountId === a.id);
      const lastMonthSpend = lastMonthTotals?.totalSpend || 0;
      return {
        ...a,
        currency: detectCurrency(a),
        totalSpend: spend,
        todaySpend: totals?.todaySpend || 0,
        yesterdaySpend: totals?.yesterdaySpend || 0,
        totalImpressions: imp,
        totalClicks: clk,
        totalLeads: totals?.totalLeads || 0,
        ctr: calcCTR(clk, imp),
        cpm: calcCPM(spend, imp),
        cpc: calcCPC(spend, clk),
        pct: perAccountBudget > 0 ? (spend / perAccountBudget) * 100 : 0,
        improved: (totals?.todaySpend || 0) >= (totals?.yesterdaySpend || 0),
        lastMonthSpend,
        isNewSpender: lastMonthData != null && spend > 0 && lastMonthSpend === 0,
      };
    })
    .filter(c => c.totalSpend > 0) // hide zero-spend accounts
    .sort((a, b) => b.totalSpend - a.totalSpend) // Top contributor first
  , [accounts, selectedAccounts, excludedAccounts, pacingData, lastMonthData, perAccountBudget]);

  // Split by billing currency — derived from memoised clientRows
  const zarClientRows = React.useMemo(() => clientRows.filter(c => c.currency === 'ZAR'), [clientRows]);
  const usdClientRows = React.useMemo(() => clientRows.filter(c => c.currency !== 'ZAR'), [clientRows]);

  const scMap = {
    emerald: { bg: 'bg-emerald-900/40', border: 'border-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-800 text-emerald-200', bar: 'bg-emerald-500' },
    yellow:  { bg: 'bg-yellow-900/30',  border: 'border-yellow-500',  text: 'text-yellow-400',  badge: 'bg-yellow-800 text-yellow-200',  bar: 'bg-yellow-500' },
    red:     { bg: 'bg-red-900/30',     border: 'border-red-500',     text: 'text-red-400',     badge: 'bg-red-800 text-red-200',        bar: 'bg-red-500' },
    slate:   { bg: 'bg-slate-800',      border: 'border-slate-600',   text: 'text-slate-400',   badge: 'bg-slate-700 text-slate-300',    bar: 'bg-slate-500' },
  };
  const sc = scMap[pacingStatus.color];
  const StatusIcon = pacingStatus.icon;

  const filterSummary = [];
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
TOTAL TARGET: ${budgetUSD > 0 ? '$' + budgetUSD.toFixed(2) + ' USD' : 'Not set'}${budgetZAR > 0 ? ' / R' + budgetZAR.toFixed(2) + ' ZAR' : ''}
TOTAL SPEND TO DATE: $${totalSpend.toFixed(2)}
TARGET USED: ${budgetUSD > 0 ? budgetUsedPct.toFixed(1) + '%' : 'N/A'}
PACING STATUS: ${pacingStatus.label}
PACING VS IDEAL: ${pacingPct > 0 ? pacingPct.toFixed(1) + '% of ideal pacing' : 'No budget set'}
TODAY'S SPEND: $${todaySpend.toFixed(2)}
YESTERDAY'S SPEND: $${yesterdaySpend.toFixed(2)}
IDEAL DAILY SPEND: ${idealDailySpend > 0 ? '$' + idealDailySpend.toFixed(2) : 'N/A'}
DAYS ELAPSED: ${daysElapsed} of ${totalDays}
REMAINING BUDGET: ${budgetUSD > 0 ? '$' + remainingBudget.toFixed(2) : 'N/A'}
PROJECTED END-OF-MONTH TOTAL: ${isCurrentMonth ? '$' + projectedMonthTotal.toFixed(2) : 'N/A (completed period)'}
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                <Target className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Pacing Tracker</h1>
                <p className="text-xs text-slate-400">
                  {platform === 'meta' ? 'Meta (Facebook + Instagram)' : 'LinkedIn'} Ad Spend — Daily Pacing
                </p>
              </div>
            </div>
            {/* Tab navigation */}
            <div className="flex items-center bg-slate-900 rounded-xl p-1 gap-1 ml-4">
              <button
                onClick={() => setActiveTab('pacing')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === 'pacing'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}>
                Pacing
              </button>
              {/* BOD / BOD2 / Kenya are LinkedIn-only — recon format is shaped
                  around LinkedIn IDs and the existing dedup sheets. Meta-equivalent
                  recon tabs ship in Stage 2. Hide the buttons on Meta to avoid
                  confusion. */}
              {platform === 'linkedin' && (
                <>
                  <button
                    onClick={() => setActiveTab('bod')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                      activeTab === 'bod'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}>
                    BOD Report
                  </button>
                  <button
                    onClick={() => setActiveTab('bod2')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                      activeTab === 'bod2'
                        ? 'bg-cyan-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}>
                    BOD 2
                  </button>
                  <button
                    onClick={() => setActiveTab('kenya')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                      activeTab === 'kenya'
                        ? 'bg-green-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}>
                    🇰🇪 Kenya
                  </button>
                </>
              )}

              {/* Meta-only — spend tracker with USD/ZAR split, DoD flag */}
              {platform === 'meta' && (
                <button
                  onClick={() => setActiveTab('meta')}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    activeTab === 'meta'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}>
                  Meta
                </button>
              )}

              {/* Visual separator between feature tabs and platform toggle */}
              <div className="w-px h-6 bg-slate-700 mx-1" />

              {/* Platform toggle — LinkedIn / Meta. Same visual language as
                  the tab buttons but distinct accent colours so it reads as a
                  "which data source" control rather than another feature tab. */}
              <button
                onClick={() => setPlatform('linkedin')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  platform === 'linkedin'
                    ? 'bg-sky-700 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}>
                LinkedIn
              </button>
              <button
                onClick={() => setPlatform('meta')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  platform === 'meta'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}>
                Meta
              </button>
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

      {/* ── Pacing Tab ── */}
      {activeTab === 'pacing' && (
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
                <label className="text-xs text-slate-500 block mb-1">Month (starts on the 1st)</label>
                <select
                  value={startDate.slice(0, 7)}
                  onChange={e => {
                    const [y, m] = e.target.value.split('-');
                    const firstDay = `${y}-${m}-01`;
                    setStartDate(firstDay);
                    const now = new Date();
                    const isCurrentMo = parseInt(y) === now.getFullYear() && parseInt(m) === now.getMonth() + 1;
                    setEndDate(isCurrentMo ? todayStr() : toDateInput(new Date(parseInt(y), parseInt(m), 0)));
                  }}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500">
                  {Array.from({ length: 12 }, (_, i) => {
                    const now = new Date();
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                    const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
                    return <option key={val} value={val}>{label}</option>;
                  })}
                </select>
                <div className="text-xs text-slate-500 mt-1">From: {startDate}</div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Start Date <span className="text-slate-600">(optional custom)</span></label>
                <input type="date" value={startDate}
                  max={endDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">End Date</label>
                <input type="date" value={endDate}
                  min={startDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            {/* Quick month buttons */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {Array.from({ length: 3 }, (_, offset) => {
                const now = new Date();
                const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
                const y = d.getFullYear(), mo = d.getMonth();
                const firstDay = `${y}-${String(mo+1).padStart(2,'0')}-01`;
                const lastDay = offset === 0 ? todayStr() : toDateInput(new Date(y, mo+1, 0));
                const label = offset === 0 ? 'This Month' : d.toLocaleString('default', { month: 'short' }) + ' ' + y;
                const isActive = startDate === firstDay;
                return (
                  <button key={firstDay} onClick={() => { setStartDate(firstDay); setEndDate(lastDay); }}
                    className={`px-2 py-1 rounded text-xs transition-colors ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-blue-700 text-slate-300 hover:text-white'}`}>
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Pacing Mode */}
            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" /> Pacing Mode
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => setPacingMode('target')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors text-center ${pacingMode === 'target' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                  <div>🎯 Target</div>
                  <div className="text-xs font-normal opacity-75 mt-0.5">vs set budget</div>
                </button>
                <button onClick={() => { setPacingMode('trend'); if (!lastMonthData && selectedAccounts.length > 0) loadLastMonth(); }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors text-center ${pacingMode === 'trend' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                  <div>📈 Trend</div>
                  <div className="text-xs font-normal opacity-75 mt-0.5">vs last month</div>
                </button>
              </div>
              {pacingMode === 'trend' && loadingLastMonth && (
                <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Loading last month…
                </div>
              )}
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
                <DollarSign className="w-3.5 h-3.5" /> Target
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
                  <div className="text-xs text-slate-400">USD Total Target</div>
                </div>
                {budgetZAR > 0 && (
                  <div>
                    <div className="text-lg font-bold text-yellow-400">{fmtR(budgetZAR)}</div>
                    <div className="text-xs text-slate-400">ZAR Total Target</div>
                  </div>
                )}
                <div className="pt-2 border-t border-slate-700 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Days in month</span>
                    <span className="text-white font-mono">{daysInBudgetMonth}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Ideal daily</span>
                    <span className="text-white font-mono">{fmtD(idealDailySpend)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Days left in month</span>
                    <span className="text-slate-300 font-mono">{daysRemainingInMonth}</span>
                  </div>
                  {isCurrentMonth && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Month-end forecast</span>
                      <span className={`font-mono font-bold ${projectedMonthTotal > budgetUSD * 1.05 ? 'text-red-400' : projectedMonthTotal < budgetUSD * 0.9 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {fmtD(projectedMonthTotal)}
                      </span>
                    </div>
                  )}
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
                + Set Target
              </button>
            )}
          </div>

          {/* Step 1 — Clients (with exclusion) */}
          <div className="flex items-center gap-2 px-1">
            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Clients</span>
            {exclusionSaving && <RefreshCw className="w-3 h-3 text-slate-500 animate-spin ml-auto" />}
          </div>

          <FilterSection
            title="Clients"
            icon={Users}
            items={accounts}
            selectedIds={selectedAccounts}
            onToggle={makeToggle(setSelectedAccounts)}
            loading={loadingAccounts}
            searchValue={clientSearch}
            onSearchChange={setClientSearch}
            onSelectFiltered={makeSelectFiltered(setSelectedAccounts, excludedAccounts)}
            onDeselectFiltered={makeDeselectFiltered(setSelectedAccounts)}
            excludedIds={excludedAccounts}
            onToggleExclude={toggleExcludeAccount}
            onUploadExclusion={handleExclusionFileUpload}
            onClearExclusion={clearUploadedExclusions}
            uploadingExcl={uploadingExcl}
            uploadedCount={uploadedExclusions.length}
            totalCount={accounts.length}
            accentColor="blue"
            emptyMessage="No accounts found"
            showExclude={true}
          />


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
              {/* Summary Cards — mode-aware */}
              <div className="grid grid-cols-5 gap-4">
                {pacingMode === 'target' ? (<>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Target</div>
                    <div className="text-2xl font-bold text-white mb-1">{budgetUSD > 0 ? fmtD(budgetUSD) : '-'}</div>
                    <button onClick={() => setShowBudgetModal(true)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                      <Edit3 className="w-3 h-3" /> {budgetUSD > 0 ? 'Edit target' : 'Set target'}
                    </button>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Spent to Date</div>
                    <div className="text-2xl font-bold text-white mb-1">{fmtD(totalSpend)}</div>
                    <div className="text-xs text-slate-400">{budgetUSD > 0 ? `${fmt(budgetUsedPct, 1)}% of target` : `Day ${daysElapsed} of ${totalDays}`}</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Remaining</div>
                    <div className={`text-2xl font-bold mb-1 ${budgetUSD > 0 && totalSpend > budgetUSD ? 'text-red-400' : 'text-white'}`}>
                      {budgetUSD > 0 ? fmtD(remainingBudget) : '-'}
                    </div>
                    <div className="text-xs text-slate-400">{budgetUSD > 0 ? `${daysRemainingInMonth} days left` : 'Set a target'}</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">{isCurrentMonth ? 'Month-End Forecast' : 'Final Spend'}</div>
                    <div className={`text-2xl font-bold mb-1 ${budgetUSD > 0 && projectedMonthTotal > budgetUSD * 1.05 ? 'text-red-400' : budgetUSD > 0 && projectedMonthTotal < budgetUSD * 0.9 ? 'text-yellow-400' : 'text-white'}`}>
                      {fmtD(isCurrentMonth ? projectedMonthTotal : totalSpend)}
                    </div>
                    <div className="text-xs text-slate-400">{isCurrentMonth ? `Avg ${fmtD(avgDailySpend)}/day` : 'Final spend'}</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Today's Spend</div>
                    <div className={`text-2xl font-bold mb-1 ${todaySpend >= (idealDailySpend > 0 ? idealDailySpend * 0.9 : 0) ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {fmtD(todaySpend)}
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <span>Yesterday: {fmtD(yesterdaySpend)}</span>
                      {yesterdaySpend > 0 && <span className={todaySpend >= yesterdaySpend ? 'text-emerald-400' : 'text-red-400'}>
                        {todaySpend >= yesterdaySpend ? '▲' : '▼'} {Math.abs(((todaySpend - yesterdaySpend) / yesterdaySpend) * 100).toFixed(1)}%
                      </span>}
                    </div>
                  </div>
                </>) : (<>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">This Month MTD</div>
                    <div className="text-2xl font-bold text-white mb-1">{fmtD(totalSpend)}</div>
                    <div className="text-xs text-slate-400">Day {daysElapsed} of month</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Last Month (Day 1–{daysElapsed})</div>
                    <div className="text-2xl font-bold text-white mb-1">{samePeriodLastMonth > 0 ? fmtD(samePeriodLastMonth) : loadingLastMonth ? '…' : '-'}</div>
                    <div className={`text-xs font-semibold mt-0.5 ${trendDiff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {samePeriodLastMonth > 0 ? `${trendDiff >= 0 ? '+' : ''}${fmtD(trendDiff)} (${trendPct.toFixed(1)}%)` : ''}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Last Month Total</div>
                    <div className="text-2xl font-bold text-white mb-1">{lastMonthTotal > 0 ? fmtD(lastMonthTotal) : loadingLastMonth ? '…' : '-'}</div>
                    <div className="text-xs text-slate-400">
                      {(() => {
                        const now = new Date();
                        const y = now.getFullYear(), m = now.getMonth();
                        const prevMonth = m === 0 ? 12 : m;
                        const prevYear  = m === 0 ? y - 1 : y;
                        const firstDay  = `${prevYear}-${String(prevMonth).padStart(2,'0')}-01`;
                        // Use local date to avoid UTC timezone shift cutting off last day
                        const lastDate  = new Date(prevYear, prevMonth, 0);
                        const lastDay   = `${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,'0')}-${String(lastDate.getDate()).padStart(2,'0')}`;
                        return lastMonthData ? `${firstDay} → ${lastDay}` : 'Prior month';
                      })()}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Month-End Forecast</div>
                    <div className={`text-2xl font-bold mb-1 ${trendVsLastMonth >= 0 ? 'text-emerald-400' : trendVsLastMonth < -5 ? 'text-yellow-400' : 'text-slate-300'}`}>
                      {fmtD(trendProjected)}
                    </div>
                    <div className="text-xs text-slate-400">{lastMonthTotal > 0 ? `${trendVsLastMonth >= 0 ? '+' : ''}${trendVsLastMonth.toFixed(1)}% vs last month` : `Avg ${fmtD(avgDailySpend)}/day`}</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Today's Spend</div>
                    <div className={`text-2xl font-bold mb-1 ${lastMonthTotal > 0 && todaySpend >= lastMonthTotal / lastMonthDays ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {fmtD(todaySpend)}
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <span>Yesterday: {fmtD(yesterdaySpend)}</span>
                      {yesterdaySpend > 0 && <span className={todaySpend >= yesterdaySpend ? 'text-emerald-400' : 'text-red-400'}>
                        {todaySpend >= yesterdaySpend ? '▲' : '▼'} {Math.abs(((todaySpend - yesterdaySpend) / yesterdaySpend) * 100).toFixed(1)}%
                      </span>}
                    </div>
                  </div>
                </>)}
              </div>

              {/* Pacing Status + Today vs Yesterday */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`rounded-xl p-6 border-2 ${
                  dayPacingTrend === 'Trending Up' ? 'bg-blue-900/20 border-blue-700' :
                  dayPacingTrend === 'Steady'      ? 'bg-emerald-900/20 border-emerald-700' :
                                                     'bg-yellow-900/20 border-yellow-700'
                }`}>
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Overall Pacing</h3>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 whitespace-nowrap flex-shrink-0">{startDate} → {endDate}</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    {dayPacingTrend === 'Trending Up'
                      ? <TrendingUp className="w-10 h-10 text-blue-400 flex-shrink-0" />
                      : dayPacingTrend === 'Steady'
                      ? <CheckCircle className="w-10 h-10 text-emerald-400 flex-shrink-0" />
                      : <TrendingDown className="w-10 h-10 text-yellow-400 flex-shrink-0" />
                    }
                    <div>
                      <div className={`text-2xl font-bold ${
                        dayPacingTrend === 'Trending Up' ? 'text-blue-400' :
                        dayPacingTrend === 'Steady'      ? 'text-emerald-400' : 'text-yellow-400'
                      }`}>{dayPacingTrend}</div>
                      <div className="text-xs text-slate-400 mt-0.5">vs {last5Days.length}-day avg · day {daysElapsed} of {totalDays}</div>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Latest day spend</span>
                      <span className="text-white font-mono font-bold">{fmtD(latestDaySpend)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{last5Days.length}-day avg</span>
                      <span className="text-slate-300 font-mono">{fmtD(dayPacingAvg)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Difference</span>
                      <span className={`font-mono font-bold ${dayPacingDiff >= 0 ? 'text-blue-400' : 'text-yellow-400'}`}>
                        {dayPacingDiff >= 0 ? '+' : ''}{fmtD(dayPacingDiff)}
                      </span>
                    </div>
                  </div>
                  {budgetUSD > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-700">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">Target used</span>
                        <span className="text-slate-300">{fmt(budgetUsedPct, 1)}% of {fmtD(budgetUSD)}</span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${sc.bar}`} style={{ width: `${Math.min(budgetUsedPct, 100)}%` }} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Yesterday vs Day Before</h3>
                  <div className={`flex items-center gap-3 mb-5 p-4 rounded-xl border ${
                    yesterdaySpend >= dayBeforeYesterdaySpend ? 'bg-emerald-900/30 border-emerald-600' : 'bg-red-900/20 border-red-700'
                  }`}>
                    {yesterdaySpend >= dayBeforeYesterdaySpend
                      ? <TrendingUp className="w-10 h-10 text-emerald-400 flex-shrink-0" />
                      : <TrendingDown className="w-10 h-10 text-red-400 flex-shrink-0" />
                    }
                    <div>
                      <div className={`text-xl font-bold ${yesterdaySpend >= dayBeforeYesterdaySpend ? 'text-emerald-400' : 'text-red-400'}`}>
                        {yesterdaySpend >= dayBeforeYesterdaySpend ? 'Spend Up' : 'Spend Down'}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {dayBeforeYesterdaySpend > 0
                          ? `${Math.abs(((yesterdaySpend - dayBeforeYesterdaySpend) / dayBeforeYesterdaySpend) * 100).toFixed(1)}% ${yesterdaySpend >= dayBeforeYesterdaySpend ? 'higher' : 'lower'} than day before`
                          : 'No data for day before yesterday'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-700/60 rounded-lg p-4">
                      <div className="text-xs text-slate-400 mb-2 font-medium leading-tight min-h-[2rem]">Yesterday</div>
                      <div className="text-xl font-bold text-white truncate">{fmtD(yesterdaySpend)}</div>
                    </div>
                    <div className="bg-slate-700/60 rounded-lg p-4">
                      <div className="text-xs text-slate-400 mb-2 font-medium leading-tight min-h-[2rem]">Day Before</div>
                      <div className="text-xl font-bold text-white truncate">{fmtD(dayBeforeYesterdaySpend)}</div>
                    </div>
                  </div>
                  {dayBeforeYesterdaySpend > 0 && (
                    <div className={`mt-3 text-xs font-medium flex items-center gap-1 ${yesterdaySpend >= dayBeforeYesterdaySpend ? 'text-emerald-400' : 'text-red-400'}`}>
                      {yesterdaySpend >= dayBeforeYesterdaySpend
                        ? <><ChevronUp className="w-3 h-3" /> +{fmtD(yesterdaySpend - dayBeforeYesterdaySpend)} vs day before</>
                        : <><ChevronDown className="w-3 h-3" /> -{fmtD(dayBeforeYesterdaySpend - yesterdaySpend)} vs day before</>}
                    </div>
                  )}
                </div>
              </div>

              {/* Metrics Bar — Impressions / Clicks / CTR / CPM / CPC */}
              {pacingData && (
                <MetricsBar
                  totalSpend={totalSpend}
                  totalImpressions={totalImpressions}
                  totalClicks={totalClicks}
                  prevData={showPeriodCompare ? { totalSpend: prevTotalSpend, totalImpressions: prevTotalImpressions, totalClicks: prevTotalClicks } : null}
                  showComparison={showPeriodCompare && !!prevPacingData}
                />
              )}

              {/* Period Comparison Controls */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const next = !showPeriodCompare;
                    setShowPeriodCompare(next);
                    if (next && !prevPacingData) loadPrevPeriod();
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    showPeriodCompare ? 'bg-blue-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}>
                  <Calendar className="w-3.5 h-3.5" />
                  {showPeriodCompare ? 'Hide Comparison' : 'Compare to Previous Period'}
                </button>
                {showPeriodCompare && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400">vs</span>
                    <input type="date" value={compareStart}
                      onChange={e => setCompareStart(e.target.value)}
                      className="px-2 py-1 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
                    <span className="text-xs text-slate-500">→</span>
                    <input type="date" value={compareEnd}
                      max={startDate}
                      onChange={e => setCompareEnd(e.target.value)}
                      className="px-2 py-1 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
                    <button
                      onClick={() => { if (compareStart && compareEnd) loadPrevPeriod(compareStart, compareEnd); }}
                      disabled={!compareStart || !compareEnd || loadingPrev}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs rounded-lg font-semibold transition-colors flex items-center gap-1">
                      {loadingPrev ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                      {loadingPrev ? 'Loading…' : 'Apply'}
                    </button>
                  </div>
                )}

                {/* Compare mode toggle + account picker */}
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => { setCompareMode(m => !m); setCompareSelected([]); setDrillAccount(null); }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      compareMode ? 'bg-purple-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}>
                    <Users className="w-3.5 h-3.5" />
                    {compareMode ? 'Exit Compare Mode' : 'Compare Accounts'}
                  </button>
                  {compareMode && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Account A picker */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-purple-300 font-semibold">A:</span>
                        <select
                          value={compareSelected[0] || ''}
                          onChange={e => {
                            const val = e.target.value;
                            setCompareSelected(prev => [val, prev[1] || ''].filter(Boolean));
                          }}
                          className="px-2 py-1 bg-slate-700 border border-purple-600 rounded-lg text-xs text-white focus:outline-none focus:border-purple-400 max-w-[200px]">
                          <option value="">Select account A…</option>
                          {clientRows.map(c => (
                            <option key={c.id} value={c.id} disabled={c.id === compareSelected[1]}>
                              {c.name.length > 30 ? c.name.slice(0,30)+'…' : c.name} ({c.id})
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Account B picker */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-purple-300 font-semibold">B:</span>
                        <select
                          value={compareSelected[1] || ''}
                          onChange={e => {
                            const val = e.target.value;
                            setCompareSelected(prev => [prev[0] || '', val].filter(Boolean));
                          }}
                          className="px-2 py-1 bg-slate-700 border border-purple-600 rounded-lg text-xs text-white focus:outline-none focus:border-purple-400 max-w-[200px]">
                          <option value="">Select account B…</option>
                          {clientRows.map(c => (
                            <option key={c.id} value={c.id} disabled={c.id === compareSelected[0]}>
                              {c.name.length > 30 ? c.name.slice(0,30)+'…' : c.name} ({c.id})
                            </option>
                          ))}
                        </select>
                      </div>
                      {compareSelected.length >= 2 && (
                        <span className="text-xs text-purple-300 bg-purple-900/40 px-2 py-1 rounded-lg">
                          {compareSelected.length} selected
                        </span>
                      )}
                      {compareSelected.length > 0 && (
                        <button onClick={() => setCompareSelected([])}
                          className="text-slate-500 hover:text-red-400 text-xs px-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Drill-down or Comparison or Default view */}
              {drillAccount ? (
                <AccountDrillDown
                  account={drillAccount}
                  totals={pacingData?.accountTotals?.find(t => t.accountId === drillAccount.id)}
                  onBack={() => setDrillAccount(null)}
                  idealDailySpend={idealDailySpend}
                  budgetUSD={budgetUSD}
                  budgetMonth={budgetMonth}
                  budgetYear={budgetYear}
                />
              ) : (
                <>
                  {/* Daily Chart */}
                  <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                        Daily Spend — {startDate} to {endDate}
                        {forecastData.length > 0 && <span className="ml-2 text-xs text-purple-300 font-normal normal-case">+ forecast to month end</span>}
                      </h3>
                      <div className="flex items-center gap-4 text-xs text-slate-400">
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500"></div>On Track</div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-yellow-500"></div>Under</div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-400"></div>Over</div>
                        <div className="flex items-center gap-1.5"><div className="w-6 border-t-2 border-dashed border-purple-300"></div>Forecast</div>
                        <div className="flex items-center gap-1.5"><div className="w-6 border-t-2 border-dashed border-blue-300"></div>Ideal</div>
                        <div className="flex items-center gap-1.5"><div className="w-6 border-t-2 border-dashed border-yellow-300"></div>Last Mo. Avg</div>
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
                        forecastData={forecastData}
                        budgetUSD={budgetUSD}
                        avgLastMonthDaily={lastMonthTotal > 0 && lastMonthDays > 0 ? lastMonthTotal / lastMonthDays : 0}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                        No spend data for this period
                      </div>
                    )}
                  </div>

                  {/* Client Breakdown — with compare mode + drill-down */}
                  <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        {compareMode ? 'Account Comparison' : 'Client Breakdown'}
                        <span className="text-slate-500 text-xs font-normal normal-case">{activeAccountCount} clients · ranked by spend</span>
                      </h3>
                      {compareMode && compareSelected.length >= 2 && (
                        <span className="text-xs text-purple-300 bg-purple-900/40 px-2 py-1 rounded-lg">
                          ▲ = best in column
                        </span>
                      )}
                    </div>

                    {compareMode && compareSelected.length >= 2 ? (
                      <ComparisonTable
                        accounts={accounts.filter(a => selectedAccounts.includes(a.id) && !excludedAccounts.includes(a.id))}
                        accountTotals={pacingData?.accountTotals}
                        selectedIds={compareSelected}
                      />
                    ) : (
                      clientRows.length === 0 ? (
                        <p className="text-slate-500 text-sm text-center py-6">No client data available</p>
                      ) : (
                        <div className="space-y-8">
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-xs font-bold text-yellow-400 uppercase tracking-wide px-2 py-1 rounded bg-yellow-900/30 border border-yellow-700">ZAR Accounts</span>
                              <span className="text-xs text-slate-500">{zarClientRows.length} client{zarClientRows.length !== 1 ? 's' : ''}</span>
                            </div>
                            <ClientTable rows={zarClientRows} currencySymbol="R" fmtCur={fmtR} calcCTR={calcCTR} calcCPC={calcCPC} onRowClick={setDrillAccount} daysElapsed={daysElapsed} lastMonthDays={lastMonthDays} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide px-2 py-1 rounded bg-emerald-900/30 border border-emerald-700">USD Accounts</span>
                              <span className="text-xs text-slate-500">{usdClientRows.length} client{usdClientRows.length !== 1 ? 's' : ''}</span>
                            </div>
                            <ClientTable rows={usdClientRows} currencySymbol="$" fmtCur={fmtD} calcCTR={calcCTR} calcCPC={calcCPC} onRowClick={setDrillAccount} daysElapsed={daysElapsed} lastMonthDays={lastMonthDays} />
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {/* Daily Spend Block */}
                  {pacingData?.dailyData?.length > 0 && (
                    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Daily Spend Breakdown</h3>
                        <span className="text-xs text-slate-400">{pacingData.dailyData.length} days</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-700">
                              <th className="text-left py-2 px-3 text-slate-400 font-semibold">Date</th>
                              <th className="text-right py-2 px-3 text-slate-400 font-semibold">Spend (USD)</th>
                              <th className="text-right py-2 px-3 text-slate-400 font-semibold">vs Last Mo. Avg</th>
                              <th className="text-right py-2 px-3 text-slate-400 font-semibold">Impressions</th>
                              <th className="text-right py-2 px-3 text-slate-400 font-semibold">Clicks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...pacingData.dailyData].reverse().map((d, i) => {
                              const avg = lastMonthTotal > 0 && lastMonthDays > 0 ? lastMonthTotal / lastMonthDays : 0;
                              const diff = avg > 0 ? d.spend - avg : null;
                              const isOver = diff !== null && diff > 0;
                              return (
                                <tr key={d.date} className={`border-b border-slate-700/50 ${i % 2 === 0 ? 'bg-slate-700/20' : ''}`}>
                                  <td className="py-2 px-3 text-slate-300 font-mono">{d.date}</td>
                                  <td className="py-2 px-3 text-right font-mono text-white font-semibold">{fmtD(d.spend)}</td>
                                  <td className={`py-2 px-3 text-right font-mono font-semibold ${diff === null ? 'text-slate-500' : isOver ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {diff === null ? '—' : `${isOver ? '+' : ''}${fmtD(diff)}`}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-slate-400">{(d.impressions || 0).toLocaleString()}</td>
                                  <td className="py-2 px-3 text-right font-mono text-slate-400">{(d.clicks || 0).toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-600">
                              <td className="py-2 px-3 text-slate-400 font-bold">Total</td>
                              <td className="py-2 px-3 text-right font-mono text-white font-bold">{fmtD(totalSpend)}</td>
                              <td className="py-2 px-3 text-right font-mono text-slate-500 font-bold">
                                {lastMonthTotal > 0 ? `Avg: ${fmtD(lastMonthTotal / lastMonthDays)}/day` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-400 font-bold">{(pacingData.dailyData.reduce((s,d) => s + (d.impressions||0), 0)).toLocaleString()}</td>
                              <td className="py-2 px-3 text-right font-mono text-slate-400 font-bold">{(pacingData.dailyData.reduce((s,d) => s + (d.clicks||0), 0)).toLocaleString()}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </>

              )}
            </>
          )}
        </div>
      </div>

      )} {/* end activeTab === 'pacing' */}

      {/* ── BOD Tab ── */}
      {activeTab === 'bod' && (
        <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
          <BODTab />
        </div>
      )}

      {/* ── BOD 2 Tab — Deduplication account spend ── */}
      {activeTab === 'bod2' && (
        <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
          <BOD2Tab />
        </div>
      )}

      {/* ── Kenya Publisher Data Tab ── */}
      {activeTab === 'kenya' && (
        <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
          <KenyaTab />
        </div>
      )}

      {/* ── Meta Tab — Facebook/Instagram spend with USD/ZAR currency split & DoD flag ── */}
      {activeTab === 'meta' && (
        <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
          <MetaTab />
        </div>
      )}

      <BudgetModal show={showBudgetModal} onClose={() => setShowBudgetModal(false)}
        budget={budget} onSave={handleBudgetSave} month={budgetMonth} year={budgetYear} />

      <AIReportModal show={showAIModal} onClose={() => setShowAIModal(false)}
        reportText={aiReport} loading={aiLoading} />
    </div>
  );
}