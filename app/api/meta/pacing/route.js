import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { accountIds, campaignGroupIds, campaignIds, adIds, currentRange, previousRange } = await request.json();

    const headers = {
      'Authorization': `Bearer ${token.accessToken}`,
      'Linkedin-Version': '202504',
      'X-RestLi-Protocol-Version': '2.0.0',
    };

    const currentData = await fetchPeriodData(accountIds, campaignGroupIds, campaignIds, adIds, currentRange, headers);
    const previousData = await fetchPeriodData(accountIds, campaignGroupIds, campaignIds, adIds, previousRange, headers);

    const current = calculateMetrics(currentData);
    const previous = calculateMetrics(previousData);
    const topCampaigns = getTopItems(currentData.campaignBreakdown, 5);
    const topAds = getTopItems(currentData.adBreakdown, 5);
    const topCampaignGroups = getTopItems(currentData.campaignGroupBreakdown, 5);
    const budgetPacing = calculateBudgetPacing(currentData, currentRange);

    return NextResponse.json({ current, previous, topCampaigns, topAds, topCampaignGroups, budgetPacing });

  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function fetchPeriodData(accountIds, campaignGroupIds, campaignIds, adIds, dateRange, headers) {
  const [sy, sm, sd] = dateRange.start.split('-');
  const [ey, em, ed] = dateRange.end.split('-');

  let allData = {
    impressions: 0, clicks: 0, spend: 0,
    leads: 0, likes: 0, comments: 0,
    shares: 0, follows: 0, otherEngagements: 0,
    landingPageClicks: 0, leadFormOpens: 0,
    videoViews: 0, videoStarts: 0, videoCompletions: 0,
    campaignBreakdown: [],
    adBreakdown: [],
    campaignGroupBreakdown: [],
  };

  const dateRangeParam = `dateRange=(start:(year:${parseInt(sy)},month:${parseInt(sm)},day:${parseInt(sd)}),end:(year:${parseInt(ey)},month:${parseInt(em)},day:${parseInt(ed)}))`;
  const fields = 'impressions,clicks,costInLocalCurrency,oneClickLeads,likes,comments,shares,follows,otherEngagements,landingPageClicks,leadGenerationMailContactInfoShares,videoViews,videoCompletions,videoStarts,pivotValues';

  if (adIds && adIds.length > 0) {
    const creativeUrns = adIds.map(id => encodeURIComponent(`urn:li:sponsoredCreative:${id}`)).join(',');
    const url = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CREATIVE&timeGranularity=ALL&${dateRangeParam}&creatives=List(${creativeUrns})&fields=${fields}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      aggregateData(allData, data.elements || [], 'ad');
    }

  } else if (campaignIds && campaignIds.length > 0) {
    const campaignUrns = campaignIds.map(id => encodeURIComponent(`urn:li:sponsoredCampaign:${id}`)).join(',');

    // Get campaign-level breakdown
    const campUrl = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&${dateRangeParam}&campaigns=List(${campaignUrns})&fields=${fields}`;
    const campRes = await fetch(campUrl, { headers });
    if (campRes.ok) {
      const data = await campRes.json();
      aggregateData(allData, data.elements || [], 'campaign');
    }

    // Also get ad-level breakdown
    const adUrl = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CREATIVE&timeGranularity=ALL&${dateRangeParam}&campaigns=List(${campaignUrns})&fields=${fields}`;
    const adRes = await fetch(adUrl, { headers });
    if (adRes.ok) {
      const data = await adRes.json();
      data.elements?.forEach(el => {
        const urn = el.pivotValues?.[0];
        if (urn) {
          allData.adBreakdown.push({
            id: urn.split(':').pop(),
            impressions: el.impressions || 0,
            clicks: el.clicks || 0,
            spent: parseFloat(el.costInLocalCurrency || 0),
            leads: el.oneClickLeads || 0,
          });
        }
      });
    }

  } else if (campaignGroupIds && campaignGroupIds.length > 0) {
    // Filter by campaign group — get campaigns in those groups then query by campaign
    for (const groupId of campaignGroupIds) {
      const groupUrn = encodeURIComponent(`urn:li:sponsoredCampaignGroup:${groupId}`);
      const url = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&${dateRangeParam}&campaignGroups=List(${groupUrn})&fields=${fields}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        aggregateData(allData, data.elements || [], 'campaign');
      }
    }

  } else {
    // Account level
    for (const accountId of accountIds) {
      const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);

      const campUrl = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&${dateRangeParam}&accounts=List(${accountUrn})&fields=${fields}`;
      const campRes = await fetch(campUrl, { headers });
      if (campRes.ok) {
        const data = await campRes.json();
        aggregateData(allData, data.elements || [], 'campaign');
      }

      // Campaign Group breakdown
      const groupUrl = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN_GROUP&timeGranularity=ALL&${dateRangeParam}&accounts=List(${accountUrn})&fields=${fields}`;
      const groupRes = await fetch(groupUrl, { headers });
      if (groupRes.ok) {
        const gdata = await groupRes.json();
        gdata.elements?.forEach(el => {
          const urn = el.pivotValues?.[0];
          if (urn) {
            allData.campaignGroupBreakdown.push({
              id: urn.split(':').pop(),
              impressions: el.impressions || 0,
              clicks: el.clicks || 0,
              spent: parseFloat(el.costInLocalCurrency || 0),
              leads: el.oneClickLeads || 0,
              ctr: el.impressions > 0 ? ((el.clicks / el.impressions) * 100).toFixed(2) : '0.00',
              landingPageClicks: el.landingPageClicks || 0,
            });
          }
        });
      }

      const adUrl = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CREATIVE&timeGranularity=ALL&${dateRangeParam}&accounts=List(${accountUrn})&fields=${fields}`;
      const adRes = await fetch(adUrl, { headers });
      if (adRes.ok) {
        const data = await adRes.json();
        data.elements?.forEach(el => {
          const urn = el.pivotValues?.[0];
          if (urn) {
            allData.adBreakdown.push({
              id: urn.split(':').pop(),
              impressions: el.impressions || 0,
              clicks: el.clicks || 0,
              spent: parseFloat(el.costInLocalCurrency || 0),
              leads: el.oneClickLeads || 0,
            });
          }
        });
      }
    }
  }

  return allData;
}

function aggregateData(allData, elements, type) {
  elements.forEach(el => {
    const urn = el.pivotValues?.[0];
    allData.impressions += el.impressions || 0;
    allData.clicks += el.clicks || 0;
    allData.spend += parseFloat(el.costInLocalCurrency || 0);
    allData.leads += el.oneClickLeads || 0;
    allData.likes += el.likes || 0;
    allData.comments += el.comments || 0;
    allData.shares += el.shares || 0;
    allData.follows += el.follows || 0;
    allData.otherEngagements += el.otherEngagements || 0;
    allData.landingPageClicks += el.landingPageClicks || 0;
    allData.leadFormOpens += el.leadGenerationMailContactInfoShares || 0;
    allData.videoViews += el.videoViews || 0;
    allData.videoStarts += el.videoStarts || 0;
    allData.videoCompletions += el.videoCompletions || 0;

    if (urn && type === 'campaign') {
      allData.campaignBreakdown.push({
        id: urn.split(':').pop(),
        impressions: el.impressions || 0,
        clicks: el.clicks || 0,
        spent: parseFloat(el.costInLocalCurrency || 0),
        leads: el.oneClickLeads || 0,
        ctr: el.impressions > 0 ? ((el.clicks / el.impressions) * 100).toFixed(2) : '0.00',
        landingPageClicks: el.landingPageClicks || 0,
      });
    }
  });
}

function calculateMetrics(data) {
  const { impressions, clicks, spend, leads, likes, comments, shares, follows,
    landingPageClicks, leadFormOpens, videoViews, videoCompletions } = data;
  const engagements = clicks + likes + comments + shares + follows;
  return {
    impressions, clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    spent: spend,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    websiteVisits: landingPageClicks,
    leads,
    cpl: leads > 0 ? spend / leads : 0,
    engagementRate: impressions > 0 ? (engagements / impressions) * 100 : 0,
    engagements,
    landingPageClicks,
    landingPageCTR: impressions > 0 ? (landingPageClicks / impressions) * 100 : 0,
    leadFormOpens,
    leadFormCompletionRate: leadFormOpens > 0 ? (leads / leadFormOpens) * 100 : 0,
    videoViews,
    videoViewRate: impressions > 0 ? (videoViews / impressions) * 100 : 0,
    cpv: videoViews > 0 ? spend / videoViews : 0,
    videoCompletionRate: videoViews > 0 ? (videoCompletions / videoViews) * 100 : 0,
  };
}

function getTopItems(items, count) {
  return [...items]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, count);
}

function calculateBudgetPacing(data, dateRange) {
  const startDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);
  const today = new Date();
  const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.min(Math.ceil((today - startDate) / (1000 * 60 * 60 * 24)), totalDays);
  return { budget: 0, spent: data.spend, daysTotal: totalDays, daysElapsed: elapsedDays };
}