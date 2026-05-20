// lib/metaClient.js
//
// Fetches ad accounts from ALL Business Managers the token has access to.
// System User token: discovers all BMs via /me/businesses, fetches owned + client accounts from each.
// Per-user OAuth token: uses /me/adaccounts (returns everything in one call).

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function resolveToken(sessionToken) {
  const systemToken = process.env.META_SYSTEM_USER_TOKEN;
  if (systemToken && systemToken.length > 20) return { token: systemToken, isSystemUser: true };
  if (sessionToken)                            return { token: sessionToken, isSystemUser: false };
  throw new Error('No Meta access token. Set META_SYSTEM_USER_TOKEN or sign in with Facebook.');
}

async function metaFetch(url, token, attempt = 0) {
  const sep      = url.includes('?') ? '&' : '?';
  const finalUrl = `${url}${sep}access_token=${encodeURIComponent(token)}`;
  const res      = await fetch(finalUrl, { headers: { Accept: 'application/json' } });
  let body;
  try { body = await res.json(); } catch { body = null; }
  const errCode    = body?.error?.code;
  const errSubcode = body?.error?.error_subcode;
  const isRate     = res.status === 429 || [4,17,32,613].includes(errCode) || [2446079,1487742].includes(errSubcode);
  if (isRate && attempt < 4) {
    await new Promise(r => setTimeout(r, Math.min(60_000, 2_000 * 2 ** attempt)));
    return metaFetch(url, token, attempt + 1);
  }
  if (!res.ok || body?.error) {
    const e = new Error(`Meta API: ${body?.error?.message || `HTTP ${res.status}`}`);
    e.code = errCode; e.subcode = errSubcode; e.status = res.status;
    throw e;
  }
  return body;
}

async function metaPaged(initialUrl, token, maxPages = 100) {
  const out = [];
  let url = initialUrl, pages = 0;
  while (url && pages < maxPages) {
    const body = await metaFetch(url, token);
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
  const [owned, client] = await Promise.all([
    metaPaged(`${GRAPH_BASE}/${bmId}/owned_ad_accounts?fields=${fields}&limit=500`, token)
      .catch(e => { console.error(`[meta] BM ${bmId} owned:`, e.message); return []; }),
    metaPaged(`${GRAPH_BASE}/${bmId}/client_ad_accounts?fields=${fields}&limit=500`, token)
      .catch(e => { console.error(`[meta] BM ${bmId} client:`, e.message); return []; }),
  ]);
  return [...owned, ...client];
}

export async function listAdAccounts(tokenInfo) {
  const { token, isSystemUser } = typeof tokenInfo === 'string'
    ? { token: tokenInfo, isSystemUser: false } : tokenInfo;

  const fields = 'id,account_id,name,currency,timezone_name,account_status';

  // Per-user OAuth — gets everything in one call
  if (!isSystemUser) {
    console.log('[meta] Per-user token → /me/adaccounts');
    const rows = await metaPaged(`${GRAPH_BASE}/me/adaccounts?fields=${fields}&limit=500`, token);
    console.log(`[meta] /me/adaccounts: ${rows.length} accounts`);
    return rows.map(normaliseAccount).filter(a => !EXCLUDED.has(a.status));
  }

  // System User — discover ALL Business Managers first
  console.log('[meta] System User → discovering all BMs via /me/businesses');
  let businesses = [];
  try {
    businesses = await metaPaged(`${GRAPH_BASE}/me/businesses?fields=id,name&limit=100`, token);
    console.log(`[meta] Found ${businesses.length} BMs: ${businesses.map(b => `${b.name}(${b.id})`).join(', ')}`);
  } catch (e) {
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

  if (!businesses.length) {
    throw new Error('No Business Managers found. Set META_BUSINESS_ID in Vercel environment variables.');
  }

  // Fetch accounts from all BMs (3 concurrent)
  const seen = new Set();
  const all  = [];
  for (let i = 0; i < businesses.length; i += 3) {
    const batch   = businesses.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(bm => fetchBMAccounts(bm.id, token, fields)
        .catch(e => { console.error(`[meta] BM ${bm.id} failed:`, e.message); return []; })
      )
    );
    for (const rows of results) {
      for (const r of rows) {
        if (!r?.id || seen.has(r.id)) continue;
        seen.add(r.id);
        all.push(normaliseAccount(r));
      }
    }
    console.log(`[meta] After BM batch ${Math.floor(i/3)+1}: ${all.length} unique accounts`);
  }

  const usable = all.filter(a => !EXCLUDED.has(a.status));
  console.log(`[meta] Total: ${all.length} | Usable: ${usable.length} | Excluded: ${all.length - usable.length}`);
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

export async function getInsights(tokenInfo, accountId, {
  startDate, endDate, level = 'campaign', filterIds = null, filterField = null,
} = {}) {
  const { token } = typeof tokenInfo === 'string' ? { token: tokenInfo } : tokenInfo;
  const acct = String(accountId).startsWith('act_') ? String(accountId) : `act_${accountId}`;
  const params = new URLSearchParams({
    level,
    fields: 'date_start,account_id,campaign_id,adset_id,ad_id,spend,impressions,clicks,actions',
    time_increment: '1',
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    limit: '500',
    use_unified_attribution_setting: 'true',
  });
  if (filterIds?.length && filterField) {
    params.set('filtering', JSON.stringify([{ field: filterField, operator: 'IN', value: filterIds }]));
  }
  const rows = await metaPaged(`${GRAPH_BASE}/${acct}/insights?${params}`, token);
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