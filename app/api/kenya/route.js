import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LI = (t) => ({ Authorization: `Bearer ${t}`, 'LinkedIn-Version': '202401' });

// Kenya LinkedIn campaign & placement master list
const KENYA_CAMPAIGNS = [
  { campaign: '26006368_POR AMOR_DOJUO_DONJUB_REG_KEN_EAST_AFRIC_USD_AWA_AO_07-18-2025_09-30-2025_4801522823',      placement: '26006368_DEGE_26Q1DOJUOB_DOJUO_DONJUB_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26174525_NU_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_REG_NU_RON' },
  { campaign: '26006371_Single Moment_THSG_THESIN_NAT_KEN_EAST_AFRIC_USD_AWA_AO_07-01-2025_09-30-2025_4801522825',  placement: '26006371_DEGE_26Q1THSGB_THSG_THESIN_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26174616_NU_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26006374_Whitecap Lager_WHICA_WHICAP_NAT_KEN_EAST_AFRIC_USD_AWA_AO_07-01-2025_10-20-2025_4801520041',placement: '26006374_DEGE_26Q1WHICALAGB_WHICA_WHICAP_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26174481_MIXED_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26006382_Stay Crisp_WHICA_WHICRI_NAT_KEN_EAST_AFRIC_USD_AWA_AO_07-02-2025_09-30-2025_4801520204',    placement: '26006382_DEGE_26Q1WHICACRISB_WHICA_WHICRI_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26174532_MIXED_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26006393_Keep Walking_JWLKR_JWBLAB_LOC_KEN_EAST_AFRIC_USD_AWA_AO_07-24-2025_10-17-2025_4801527504',  placement: '26006393_DEGE_26Q1JWLKRBLACKB_JWLKR_JWBLAB_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26175964_NU_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_LOC_NU_RON' },
  { campaign: '26006407_Showtime_TANQY_TANQUB_NAT_KEN_EAST_AFRIC_USD_AWA_AO_07-22-2025_09-30-2025_4801525080',      placement: '26006407_DEGE_26Q1TANQYSTB_TANQY_TANQUB_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26175366_MIXED_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26007504_Keep Walking_JWLKR_JWBLAB_LOC_KEN_EAST_AFRIC_USD_AWA_AO_10-13-2025_12-31-2025_4801581614',  placement: '26007504_DEGE_26Q2JWLKRBLKB_JWLKR_JWBLAB_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26195941_NU_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_LOC_NU_RON' },
  { campaign: '26007528_Stay Crisp_WHICA_WHICRI_NAT_KEN_EAST_AFRIC_USD_AWA_AO_10-09-2025_12-31-2025_4801581610',    placement: '26007528_DEGE_26Q2WHICACRISB_WHICA_WHICRI_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26196462_MIXED_ALNOG_A18+_CXD_EN_NU_DV_NAT_NU_RON' },
  { campaign: '26007540_POR AMOR_DOJUO_DONJUB_NAT_KEN_EAST_AFRIC_USD_AWA_AO_10-15-2025_12-31-2025_ 4801585107',     placement: '26007540_DEGE_26Q2DOJUOB_DOJUO_DONJUB_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26197222_NU_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26007614_Whitecap Lager_WHICA_WHICAP_NAT_KEN_EAST_AFRIC_USD_AWA_AO_10-23-2025_01-15-2026_4801589158',placement: '26007614_DEGE_26Q2WHICALAGB_WHICA_WHICAP_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26199156_MIXED_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26007619_Single Moment_THSG_THESIN_NAT_KEN_EAST_AFRIC_USD_AWA_AO_10-23-2025_12-31-2025_4801589064',  placement: '26007619_DEGE_26Q2THSGB_THSG_THESIN_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26199684_MIXED_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26008480_Whitecap Lager_WHICA_WHICAP_NAT_KEN_EAST_AFRIC_USD_AWA_AO_01-05-2026_03-31-2026_4801634798',placement: '26008480_DEGE_26Q3WHICALAGB_WHICA_WHICAP_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26235169_NU_ALNOG_A25+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26008504_Single Moment_THSG_THESIN_NAT_KEN_EAST_AFRIC_USD_AWA_AO_01-08-2026_03-31-2026_4801637218',  placement: '26008504_DEGE_26Q3THSGB_THSG_THESIN_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26235973_MIXED_ALNOG_A18+_CXD_EN_NU_DV_NAT_NU_RON' },
  { campaign: '26008518_Keep Walking_JWLKR_JWBLAB_NAT_KEN_EAST_AFRIC_USD_AWA_AO_01-09-2026_03-31-2026_4801638225',  placement: '26008518_DEGE_26Q3JWLKRBLCKB_JWLKR_JWBLAB_LIN_LKDN_KEN_AWA_PSOC_SOCAD_MIXD_CPM_NU_26236942_NU_ALNOG_A18+_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
  { campaign: '26008552_POR AMOR_DOJUO_DONJUB_NAT_KEN_EAST_AFRIC_USD_AWA_AO_01-16-2026_03-31-2026_4801640009',      placement: '26008552_DEGE_26Q3DOJUOB_DOJUO_DONJUB_LIN_LKDN_KEN_AWA_PSOC_SOCAD_VIDE_CPM_NU_26239386_NU_ALNOG_A21-55_CXD_EN_NU_AO_NU_NU_NAT_NU_RON' },
];

function extractCampaignId(name) {
  const m = name.trim().match(/^(\d+)_/);
  return m ? m[1] : null;
}

function pad2(n) { return String(n).padStart(2, '0'); }

async function liGet(url, token) {
  try {
    const res = await fetch(url, { headers: LI(token), signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function toMMDDYYYY(str) {
  const [y, m, d] = str.split('-');
  return `${m}/${d}/${y}`;
}

export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const { startDate, endDate } = await request.json();
  if (!startDate || !endDate) {
    return new Response(JSON.stringify({ error: 'startDate and endDate required' }), { status: 400 });
  }

  const start  = new Date(startDate);
  const end    = new Date(endDate);
  const clEnd  = end > new Date() ? new Date() : end;

  const dp = {
    'dateRange.start.year':  start.getFullYear(),
    'dateRange.start.month': start.getMonth() + 1,
    'dateRange.start.day':   start.getDate(),
    'dateRange.end.year':    clEnd.getFullYear(),
    'dateRange.end.month':   clEnd.getMonth() + 1,
    'dateRange.end.day':     clEnd.getDate(),
  };

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      try {
        const allRows = [];
        let processed = 0;

        send({ phase: 1, message: `Fetching daily data for ${KENYA_CAMPAIGNS.length} Kenya campaigns…`, total: KENYA_CAMPAIGNS.length });

        for (const kc of KENYA_CAMPAIGNS) {
          const campId = extractCampaignId(kc.campaign);

          if (campId) {
            const p = new URLSearchParams({
              q: 'analytics',
              pivot: 'CAMPAIGN',
              timeGranularity: 'DAILY',
              ...dp,
              fields: 'dateRange,costInLocalCurrency,impressions,clicks,videoViews,videoCompletions,videoStarts,totalEngagements,pivotValues',
            });
            p.append('campaigns[0]', `urn:li:sponsoredCampaign:${campId}`);

            const data = await liGet(
              `https://api.linkedin.com/v2/adAnalyticsV2?${p.toString()}`,
              token.accessToken
            );

            const elements = data?.elements || [];

            if (elements.length > 0) {
              for (const el of elements) {
                const dr      = el.dateRange?.start;
                const dateStr = dr ? `${pad2(dr.month)}/${pad2(dr.day)}/${dr.year}` : toMMDDYYYY(startDate);
                const spend   = parseFloat(el.costInLocalCurrency || 0);
                const imps    = parseInt(el.impressions || 0);
                const clks    = parseInt(el.clicks || 0);
                const views   = el.videoViews    != null ? parseInt(el.videoViews)    : null;
                const starts  = el.videoStarts   != null ? parseInt(el.videoStarts)   : null;
                const comps   = el.videoCompletions != null ? parseInt(el.videoCompletions) : null;
                const engs    = el.totalEngagements != null ? parseInt(el.totalEngagements) : null;
                const cpm     = imps > 0 ? parseFloat(((spend / imps) * 1000).toFixed(4)) : 0;

                allRows.push({
                  date: dateStr, currency: 'USD', siteName: 'LinkedIn',
                  campaignName: kc.campaign, placementName: kc.placement,
                  packageName: '', creativeName: '',
                  netSpend: spend, impressions: imps, clicks: clks,
                  engagements: engs, videoViews: views, videoStarts: starts,
                  video3sec: null, video25: null, video50: null, video75: null,
                  video100: comps, vcr: null, appDownloads: null,
                  custom1: null, custom2: null, cpm,
                });
              }
            } else {
              // No data for this period — one zero row so the campaign still appears
              allRows.push({
                date: toMMDDYYYY(startDate), currency: 'USD', siteName: 'LinkedIn',
                campaignName: kc.campaign, placementName: kc.placement,
                packageName: '', creativeName: '',
                netSpend: 0, impressions: 0, clicks: 0,
                engagements: null, videoViews: null, videoStarts: null,
                video3sec: null, video25: null, video50: null, video75: null,
                video100: null, vcr: null, appDownloads: null,
                custom1: null, custom2: null, cpm: 0,
              });
            }
          }

          processed++;
          send({ phase: 1, processed, total: KENYA_CAMPAIGNS.length, rowsSoFar: allRows.length });
        }

        // Sort by date → campaign name
        allRows.sort((a, b) => {
          const toD = s => { const [m,d,y] = s.split('/'); return new Date(`${y}-${m}-${d}`); };
          return toD(a.date) - toD(b.date) || a.campaignName.localeCompare(b.campaignName);
        });

        send({ done: true, rows: allRows, total: allRows.length });
      } catch (err) {
        send({ error: err.message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
      'Cache-Control': 'no-cache',
    },
  });
}