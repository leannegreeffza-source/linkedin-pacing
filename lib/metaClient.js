// lib/metaClient.js
//
// Meta Marketing API wrapper for the LinkedIn pacing tracker project.
//
// Auth model
// ----------
// This project uses a Business Manager System User token (META_SYSTEM_USER_TOKEN).
// Important quirk: System User tokens do NOT have a user identity, so the common
// /me/adaccounts endpoint returns OAuthException code 2500. Instead, we query
// the business directly via:
//   - /{business_id}/owned_ad_accounts   (accounts owned by this BM)
//   - /{business_id}/client_ad_accounts  (accounts where this BM is the agency partner)
// and merge the two results. This is the correct pattern for agency setups.
//
// Per-user OAuth fallback
// -----------------------
// If META_SYSTEM_USER_TOKEN is not set, the client falls back to a per-user
// access token from the NextAuth session. In that case /me/adaccounts works
// fine and we use it.
//
// Docs:
//   https://developers.facebook.com/docs/marketing-api
//   https://developers.facebook.com/docs/marketing-api/business-asset-management/guides/business-ad-accounts

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;
// NB: read META_BUSINESS_ID lazily inside listAdAccounts, not at module load,
// so it picks up env values regardless of import timing.

// --- token resolution ------------------------------------------------------
export function resolveToken(sessionToken) {
  const systemToken = process.env.META_SYSTEM_USER_TOKEN;
  if (systemToken && systemToken.length > 20) return { token: systemToken, isSystemUser: true };
  if (sessionToken)                            return { token: sessionToken, isSystemUser: false };
  throw new Error('No Meta access token available. Set META_SYSTEM_USER_TOKEN or sign in with Facebook.');
}

// --- low-level fetch with retry on rate-limit -----------------------------
async function metaFetch(url, token, attempt = 0) {
  const sep      = url.includes('?') ? '&' : '?';
  const finalUrl = `${url}${sep}access_token=${encodeURIComponent(token)}`;
  const res      = await fetch(finalUrl, { headers: { 'Accept': 'application/json' } });

  let body;
  try { body = await res.json(); } catch { body = null; }

  const errCode    = body?.error?.code;
  const errSubcode = body?.error?.error_subcode;
  const isRateLimit =
    res.status === 429 ||
    [4, 17, 32, 613].includes(errCode) ||
    [2446079, 1487742].includes(errSubcode);

  if (isRateLimit && attempt < 4) {
    const waitMs = Math.min(60_000, 2_000 * Math.pow(2, attempt));
    await new Promise(r => setTimeout(r, waitMs));
    return metaFetch(url, token, attempt + 1);
  }

  if (!res.ok || body?.error) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const e = new Error(`Meta API error: ${msg}`);
    e.code     = errCode;
    e.subcode  = errSubcode;
    e.status   = res.status;
    e.url      = url.replace(/access_token=[^&]+/, 'access_token=REDACTED');
    throw e;
  }
  return body;
}

async function metaPaged(initialUrl, token, maxPages = 50) {
  const out = [];
  let url   = initialUrl;
  let pages = 0;
  while (url && pages < maxPages) {
    const body = await metaFetch(url, token);
    if (Array.isArray(body.data)) out.push(...body.data);
    url = body.paging?.next || null;
    if (url) url = url.replace(/([?&])access_token=[^&]*/g, '$1').replace(/[?&]$/, '');
    pages += 1;
  }
  return out;
}

// --- public API ------------------------------------------------------------

// Map a raw ad account row from Meta into our normalised shape.
function normaliseAccount(r) {
  return {
    id:        r.id,                      // 'act_123'
    accountId: r.account_id || (r.id || '').replace('act_', ''),
    name:      r.name,
    currency:  r.currency,
    timezone:  r.timezone_name,
    status:    r.account_status,
  };
}

// List ad accounts. Behaviour depends on token type:
//   - System User token: requires META_BUSINESS_ID in env. Pulls both
//     /owned_ad_accounts and /client_ad_accounts and merges them.
//   - Per-user token: uses /me/adaccounts as before.
export async function listAdAccounts(tokenInfo) {
  const { token, isSystemUser } = (typeof tokenInfo === 'string')
    ? { token: tokenInfo, isSystemUser: false }   // backwards compat if caller passes raw string
    : tokenInfo;

  const fields = 'id,account_id,name,currency,timezone_name,account_status';

  if (isSystemUser) {
    const businessId = process.env.META_BUSINESS_ID || null;
    if (!businessId) {
      throw new Error(
        'META_BUSINESS_ID is required when using a System User token. ' +
        'Find it at business.facebook.com/settings → Business info.'
      );
    }
    // Owned + client accounts. Run in parallel.
    const ownedUrl  = `${GRAPH_BASE}/${businessId}/owned_ad_accounts?fields=${fields}&limit=200`;
    const clientUrl = `${GRAPH_BASE}/${businessId}/client_ad_accounts?fields=${fields}&limit=200`;

    const [ownedRaw, clientRaw] = await Promise.all([
      metaPaged(ownedUrl,  token).catch(e => { console.error('[metaClient] owned_ad_accounts failed:',  e.message); return []; }),
      metaPaged(clientUrl, token).catch(e => { console.error('[metaClient] client_ad_accounts failed:', e.message); return []; }),
    ]);

    // Dedupe by id — an account can theoretically appear in both lists.
    const seen = new Set();
    const merged = [];
    for (const r of [...ownedRaw, ...clientRaw]) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(normaliseAccount(r));
    }
    return merged;
  }

  // Per-user OAuth token path
  const url  = `${GRAPH_BASE}/me/adaccounts?fields=${fields}&limit=200`;
  const rows = await metaPaged(url, token);
  return rows.map(normaliseAccount);
}

export async function listCampaigns(tokenInfo, accountId) {
  const { token } = (typeof tokenInfo === 'string') ? { token: tokenInfo } : tokenInfo;
  const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const fields = 'id,name,status,effective_status,objective,start_time,stop_time';
  const url    = `${GRAPH_BASE}/${acct}/campaigns?fields=${fields}&limit=200`;
  const rows   = await metaPaged(url, token);
  return rows.map(r => ({
    id:              r.id,
    name:            r.name,
    status:          r.status,
    effectiveStatus: r.effective_status,
    objective:       r.objective,
    startTime:       r.start_time,
    stopTime:        r.stop_time,
    accountId:       acct.replace('act_', ''),
  }));
}

export async function listAdSets(tokenInfo, accountId, campaignIds = null) {
  const { token } = (typeof tokenInfo === 'string') ? { token: tokenInfo } : tokenInfo;
  const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const fields = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time';
  let url = `${GRAPH_BASE}/${acct}/adsets?fields=${fields}&limit=200`;
  if (campaignIds && campaignIds.length > 0) {
    const filter = encodeURIComponent(JSON.stringify([
      { field: 'campaign.id', operator: 'IN', value: campaignIds },
    ]));
    url += `&filtering=${filter}`;
  }
  const rows = await metaPaged(url, token);
  return rows.map(r => ({
    id:              r.id,
    name:            r.name,
    campaignId:      r.campaign_id,
    status:          r.status,
    effectiveStatus: r.effective_status,
    dailyBudget:     r.daily_budget    ? Number(r.daily_budget)    / 100 : null,
    lifetimeBudget:  r.lifetime_budget ? Number(r.lifetime_budget) / 100 : null,
    startTime:       r.start_time,
    endTime:         r.end_time,
    accountId:       acct.replace('act_', ''),
  }));
}

export async function getInsights(tokenInfo, accountId, {
  startDate, endDate, level = 'campaign', filterIds = null, filterField = null,
} = {}) {
  const { token } = (typeof tokenInfo === 'string') ? { token: tokenInfo } : tokenInfo;
  const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const fields = 'date_start,date_stop,account_id,campaign_id,adset_id,ad_id,spend,impressions,clicks,actions';

  const params = new URLSearchParams({
    level,
    fields,
    time_increment: '1',
    time_range:     JSON.stringify({ since: startDate, until: endDate }),
    limit:          '500',
    use_unified_attribution_setting: 'true',
  });
  if (filterIds && filterIds.length > 0 && filterField) {
    params.set('filtering', JSON.stringify([
      { field: filterField, operator: 'IN', value: filterIds },
    ]));
  }

  const url  = `${GRAPH_BASE}/${acct}/insights?${params.toString()}`;
  const rows = await metaPaged(url, token);

  const leadTypes = new Set([
    'lead',
    'onsite_conversion.lead_grouped',
    'offsite_conversion.fb_pixel_lead',
  ]);

  return rows.map(r => {
    let leads = 0;
    if (Array.isArray(r.actions)) {
      for (const a of r.actions) {
        if (leadTypes.has(a.action_type)) leads += Number(a.value) || 0;
      }
    }
    return {
      date:        r.date_start,
      accountId:   r.account_id,
      campaignId:  r.campaign_id || null,
      adsetId:     r.adset_id    || null,
      adId:        r.ad_id       || null,
      spend:       Number(r.spend)       || 0,
      impressions: Number(r.impressions) || 0,
      clicks:      Number(r.clicks)      || 0,
      leads,
    };
  });
}