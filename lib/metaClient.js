// lib/metaClient.js
//
// Fetches ad accounts from ALL Business Managers the token has access to.
// System User token: discovers all BMs via /me/businesses, fetches owned + client accounts from each.
// Per-user OAuth token: does the same BM discovery AND adds /me/adaccounts for anything
// the person can reach directly.
//
// Every account is tagged with the Business Manager it was found under (`bm`), and
// listAdAccounts() attaches a `.diagnostics` object to the returned array describing what
// each BM returned, so "why is account X missing?" can be answered without guessing.

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function resolveToken(sessionToken) {
  const systemToken   = process.env.META_SYSTEM_USER_TOKEN;
  // TEMP: set META_PREFER_SESSION_TOKEN=true in Vercel to pull data through
  // whoever is currently signed in with Facebook (e.g. Marius), instead of
  // the System User token. Turn back off (unset, or set to 'false') to
  // return to normal System User behavior for everyone.
  // NOTE: if nobody is signed in with Facebook, this silently falls back to
  // the System User token, which sees fewer accounts. The accounts route
  // reports which one was used (x-meta-token-type header).
  const preferSession = process.env.META_PREFER_SESSION_TOKEN === 'true';

  if (preferSession && sessionToken) return { token: sessionToken, isSystemUser: false };
  if (systemToken && systemToken.length > 20) return { token: systemToken, isSystemUser: true };
  if (sessionToken)                            return { token: sessionToken, isSystemUser: false };
  throw new Error('No Meta access token. Set META_SYSTEM_USER_TOKEN or sign in with Facebook.');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Meta rate-limit signals:
//   4, 17, 32, 613            app / user / page / custom-endpoint limits
//   80000 – 80014             Business Use Case limits (80000 = Ads Insights, 80004 = Ads Management, ...)
//   subcodes 2446079, 1487742 "too many calls" variants
function isRateLimit(status, code, subcode) {
  return status === 429
    || [4, 17, 32, 613].includes(code)
    || (code >= 80000 && code <= 80014)
    || [2446079, 1487742].includes(subcode);
}

// Errors worth trying again later: rate limits, Meta's own "temporary issue" codes (1, 2),
// 5xx responses and network failures. Permission / token / bad-parameter errors are not.
export function isRetryableError(err) {
  if (!err) return false;
  if (err.rateLimited) return true;
  if ([1, 2].includes(err.code)) return true;
  if (err.status >= 500) return true;
  if (err.status === undefined && err.code === undefined) return true; // fetch/network failure
  return false;
}

async function metaFetch(url, token, attempt = 0, deadline = null) {
  const sep      = url.includes('?') ? '&' : '?';
  const finalUrl = `${url}${sep}access_token=${encodeURIComponent(token)}`;
  const res      = await fetch(finalUrl, { headers: { Accept: 'application/json' } });
  let body;
  try { body = await res.json(); } catch { body = null; }
  const errCode    = body?.error?.code;
  const errSubcode = body?.error?.error_subcode;
  const isRate     = isRateLimit(res.status, errCode, errSubcode);
  if (isRate && attempt < 4) {
    const wait = Math.min(60_000, 2_000 * 2 ** attempt);
    // Don't sleep past the caller's deadline — fail fast as "rate limited" so the
    // caller can retry that account in a fresh request instead of timing out.
    if (!(deadline && Date.now() + wait > deadline)) {
      await sleep(wait);
      return metaFetch(url, token, attempt + 1, deadline);
    }
  }
  if (!res.ok || body?.error) {
    const e = new Error(`Meta API: ${body?.error?.message || `HTTP ${res.status}`}`);
    e.code = errCode; e.subcode = errSubcode; e.status = res.status; e.rateLimited = isRate;
    throw e;
  }
  return body;
}

async function metaPaged(initialUrl, token, maxPages = 100, deadline = null) {
  const out = [];
  let url = initialUrl, pages = 0;
  while (url && pages < maxPages) {
    const body = await metaFetch(url, token, 0, deadline);
    if (Array.isArray(body.data)) out.push(...body.data);
    url = body.paging?.next || null;
    if (url) url = url.replace(/([?&])access_token=[^&]*/g, '$1').replace(/[?&]$/, '');
    pages++;
  }
  return out;
}

function normaliseAccount(r) {
  return {
    id:        r.id,
    accountId: r.account_id || (r.id || '').replace('act_', ''),
    name:      r.name,
    currency:  r.currency,
    timezone:  r.timezone_name,
    status:    r.account_status,
  };
}

const EXCLUDED = new Set([2, 101, 202]); // DISABLED, CLOSED, ANY_CLOSED

async function fetchBMAccounts(bmId, token, fields) {
  const errors = [];
  // Try owned + client accounts (works when app is registered in the BM)
  const [owned, client] = await Promise.all([
    metaPaged(`${GRAPH_BASE}/${bmId}/owned_ad_accounts?fields=${fields}&limit=500`, token)
      .catch(e => { errors.push(`owned_ad_accounts: ${e.message}`); console.error(`[meta] BM ${bmId} owned:`, e.message); return []; }),
    metaPaged(`${GRAPH_BASE}/${bmId}/client_ad_accounts?fields=${fields}&limit=500`, token)
      .catch(e => { errors.push(`client_ad_accounts: ${e.message}`); console.error(`[meta] BM ${bmId} client:`, e.message); return []; }),
  ]);

  let rows = [...owned, ...client];
  let viaSystemUser = 0;

  // If owned/client both came back empty (app not registered in this BM),
  // fall back to querying system user's assigned assets directly
  if (owned.length === 0 && client.length === 0) {
    console.log(`[meta] BM ${bmId}: owned/client empty, trying system user assets`);
    try {
      const users = await metaPaged(
        `${GRAPH_BASE}/${bmId}/system_users?fields=id,name&limit=100`, token
      );
      for (const user of users) {
        const assets = await metaPaged(
          `${GRAPH_BASE}/${user.id}/assigned_ad_accounts?fields=${fields}&limit=500`, token
        ).catch(() => []);
        if (assets.length > 0) {
          console.log(`[meta] BM ${bmId}: found ${assets.length} accounts via system user ${user.id}`);
          rows = assets;
          viaSystemUser = assets.length;
          break;
        }
      }
    } catch (e) {
      errors.push(`system_users fallback: ${e.message}`);
      console.error(`[meta] BM ${bmId} system user assets fallback failed:`, e.message);
    }
  }

  return { rows, counts: { owned: owned.length, client: client.length, viaSystemUser }, errors };
}

export async function listAdAccounts(tokenInfo) {
  const { token, isSystemUser } = typeof tokenInfo === 'string'
    ? { token: tokenInfo, isSystemUser: false } : tokenInfo;

  const fields = 'id,account_id,name,currency,timezone_name,account_status';
  const seen = new Set();
  const all  = [];
  const addRows = (rows, bm) => {
    let added = 0;
    for (const r of rows) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      all.push({ ...normaliseAccount(r), bm });
      added++;
    }
    return added;
  };

  const diagnostics = {
    tokenType: isSystemUser ? 'system_user' : 'facebook_session',
    businesses: [],
    personalAccess: null,
    excluded: [],
  };

  // 1) Discover ALL Business Managers this token can see, then pull each one's accounts.
  console.log(`[meta] ${isSystemUser ? 'System User' : 'User session'} → discovering all BMs via /me/businesses`);
  let businesses = [];
  try {
    businesses = await metaPaged(`${GRAPH_BASE}/me/businesses?fields=id,name&limit=100`, token);
    console.log(`[meta] Found ${businesses.length} BMs: ${businesses.map(b => `${b.name}(${b.id})`).join(', ')}`);
  } catch (e) {
    diagnostics.businessesError = e.message;
    console.error('[meta] /me/businesses failed:', e.message);
  }

  // Add all BM IDs from environment variables
  const envBMs = [
    process.env.META_BUSINESS_ID,
    process.env.META_BUSINESS_ID_2,
    process.env.META_BUSINESS_ID_3,
    process.env.META_BUSINESS_ID_4,
    process.env.META_BUSINESS_ID_5,
  ].filter(Boolean);

  for (const envId of envBMs) {
    if (!businesses.find(b => b.id === envId)) {
      businesses.push({ id: envId, name: `BM-${envId}` });
    }
  }

  // Fetch accounts from all BMs (3 concurrent)
  for (let i = 0; i < businesses.length; i += 3) {
    const batch   = businesses.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(bm => fetchBMAccounts(bm.id, token, fields)
        .then(r => ({ bm, ...r }))
        .catch(e => {
          console.error(`[meta] BM ${bm.id} failed:`, e.message);
          return { bm, rows: [], counts: { owned: 0, client: 0, viaSystemUser: 0 }, errors: [e.message] };
        })
      )
    );
    for (const { bm, rows, counts, errors } of results) {
      const added = addRows(rows, bm.name);
      diagnostics.businesses.push({ id: bm.id, name: bm.name, ...counts, newAccounts: added, errors });
    }
    console.log(`[meta] After BM batch ${Math.floor(i/3)+1}: ${all.length} unique accounts`);
  }

  // 2) Per-user OAuth only: also pick up anything the person can reach directly that
  //    wasn't found through a Business Manager.
  if (!isSystemUser) {
    console.log('[meta] User session → /me/adaccounts');
    try {
      const rows  = await metaPaged(`${GRAPH_BASE}/me/adaccounts?fields=${fields}&limit=500`, token);
      const added = addRows(rows, 'Personal access (no Business Manager)');
      diagnostics.personalAccess = { total: rows.length, newAccounts: added };
      console.log(`[meta] /me/adaccounts: ${rows.length} accounts (${added} not already found via a BM)`);
    } catch (e) {
      diagnostics.personalAccess = { total: 0, newAccounts: 0, error: e.message };
      console.error('[meta] /me/adaccounts failed:', e.message);
    }
  }

  if (!businesses.length && !all.length) {
    throw new Error('No Business Managers found. Set META_BUSINESS_ID in Vercel environment variables.');
  }

  const usable = all.filter(a => !EXCLUDED.has(a.status));
  diagnostics.excluded = all.filter(a => EXCLUDED.has(a.status))
    .map(a => ({ id: a.accountId, name: a.name, status: a.status, bm: a.bm }));
  diagnostics.totals = { found: all.length, usable: usable.length, excluded: all.length - usable.length };
  console.log(`[meta] Total: ${all.length} | Usable: ${usable.length} | Excluded: ${all.length - usable.length}`);

  // Array props are ignored by JSON.stringify, so existing callers are unaffected.
  usable.diagnostics = diagnostics;
  return usable;
}

export async function listCampaigns(tokenInfo, accountId) {
  const { token } = typeof tokenInfo === 'string' ? { token: tokenInfo } : tokenInfo;
  const acct = String(accountId).startsWith('act_') ? String(accountId) : `act_${accountId}`;
  const rows = await metaPaged(
    `${GRAPH_BASE}/${acct}/campaigns?fields=id,name,status,effective_status,objective,start_time,stop_time&limit=200`, token
  );
  return rows.map(r => ({
    id: r.id, name: r.name, status: r.status, effectiveStatus: r.effective_status,
    objective: r.objective, startTime: r.start_time, stopTime: r.stop_time,
    accountId: acct.replace('act_', ''),
  }));
}

export async function listAdSets(tokenInfo, accountId, campaignIds = null) {
  const { token } = typeof tokenInfo === 'string' ? { token: tokenInfo } : tokenInfo;
  const acct = String(accountId).startsWith('act_') ? String(accountId) : `act_${accountId}`;
  let url = `${GRAPH_BASE}/${acct}/adsets?fields=id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time&limit=200`;
  if (campaignIds?.length) {
    url += `&filtering=${encodeURIComponent(JSON.stringify([{ field:'campaign.id', operator:'IN', value:campaignIds }]))}`;
  }
  const rows = await metaPaged(url, token);
  return rows.map(r => ({
    id: r.id, name: r.name, campaignId: r.campaign_id, status: r.status,
    effectiveStatus: r.effective_status,
    dailyBudget:    r.daily_budget    ? Number(r.daily_budget)    / 100 : null,
    lifetimeBudget: r.lifetime_budget ? Number(r.lifetime_budget) / 100 : null,
    startTime: r.start_time, endTime: r.end_time, accountId: acct.replace('act_', ''),
  }));
}

// level 'account' returns one row per day per account — far lighter than 'campaign' and
// avoids Meta's "reduce the amount of data" errors on big accounts. Use 'campaign' / 'adset'
// only when you actually need that breakdown (filters).
export async function getInsights(tokenInfo, accountId, {
  startDate, endDate, level = 'campaign', filterIds = null, filterField = null, deadline = null,
} = {}) {
  const { token } = typeof tokenInfo === 'string' ? { token: tokenInfo } : tokenInfo;
  const acct = String(accountId).startsWith('act_') ? String(accountId) : `act_${accountId}`;
  const fields = level === 'account'
    ? 'date_start,account_id,spend,impressions,clicks,actions'
    : 'date_start,account_id,campaign_id,adset_id,ad_id,spend,impressions,clicks,actions';
  const params = new URLSearchParams({
    level,
    fields,
    time_increment: '1',
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    limit: '500',
    use_unified_attribution_setting: 'true',
  });
  if (filterIds?.length && filterField) {
    params.set('filtering', JSON.stringify([{ field: filterField, operator: 'IN', value: filterIds }]));
  }
  const rows = await metaPaged(`${GRAPH_BASE}/${acct}/insights?${params}`, token, 100, deadline);
  const leadTypes = new Set(['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead']);
  return rows.map(r => {
    let leads = 0;
    if (Array.isArray(r.actions)) {
      for (const a of r.actions) { if (leadTypes.has(a.action_type)) leads += Number(a.value) || 0; }
    }
    return {
      date: r.date_start, accountId: r.account_id,
      campaignId: r.campaign_id || null, adsetId: r.adset_id || null, adId: r.ad_id || null,
      spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0, leads,
    };
  });
}
