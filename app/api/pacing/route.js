import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { accountIds, month, year } = await request.json();
    if (!accountIds || accountIds.length === 0) {
      return NextResponse.json({ error: 'No accounts provided' }, { status: 400 });
    }

    const now = new Date();
    const targetYear = year || now.getFullYear();
    const targetMonth = month || now.getMonth() + 1;
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const isCurrentMonth = targetYear === now.getFullYear() && targetMonth === (now.getMonth() + 1);
    const lastDay = isCurrentMonth ? now.getDate() : daysInMonth;

    // Fetch daily analytics per account
    const accountResults = await Promise.all(
      accountIds.map(async (accountId) => {
        try {
          const params = new URLSearchParams({
            q: 'analytics',
            pivot: 'ACCOUNT',
            timeGranularity: 'DAILY',
            'dateRange.start.year': targetYear,
            'dateRange.start.month': targetMonth,
            'dateRange.start.day': 1,
            'dateRange.end.year': targetYear,
            'dateRange.end.month': targetMonth,
            'dateRange.end.day': lastDay,
            'accounts[0]': `urn:li:sponsoredAccount:${accountId}`,
            fields: 'dateRange,costInLocalCurrency,impressions,clicks,totalEngagements,oneClickLeads',
          });

          const res = await fetch(
            `https://api.linkedin.com/v2/adAnalyticsV2?${params.toString()}`,
            {
              headers: {
                Authorization: `Bearer ${token.accessToken}`,
                'LinkedIn-Version': '202401',
              },
            }
          );

          if (!res.ok) {
            console.error(`Failed for account ${accountId}:`, await res.text());
            return { accountId, dailyData: [], error: true };
          }

          const data = await res.json();
          const dailyData = (data.elements || []).map(el => {
            const dr = el.dateRange?.start || el.dateRange;
            return {
              date: `${dr.year}-${String(dr.month).padStart(2, '0')}-${String(dr.day).padStart(2, '0')}`,
              day: dr.day,
              month: dr.month,
              year: dr.year,
              spend: parseFloat(el.costInLocalCurrency || 0),
              impressions: parseInt(el.impressions || 0),
              clicks: parseInt(el.clicks || 0),
              leads: parseInt(el.oneClickLeads || 0),
            };
          }).sort((a, b) => a.date.localeCompare(b.date));

          return { accountId, dailyData };
        } catch (err) {
          console.error(`Error for account ${accountId}:`, err);
          return { accountId, dailyData: [], error: true };
        }
      })
    );

    // Merge daily data across all accounts by date
    const dateMap = {};
    for (const result of accountResults) {
      for (const day of result.dailyData) {
        if (!dateMap[day.date]) {
          dateMap[day.date] = { date: day.date, day: day.day, month: day.month, year: day.year, spend: 0, impressions: 0, clicks: 0, leads: 0 };
        }
        dateMap[day.date].spend += day.spend;
        dateMap[day.date].impressions += day.impressions;
        dateMap[day.date].clicks += day.clicks;
        dateMap[day.date].leads += day.leads;
      }
    }

    const mergedDailyData = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    // Per-account totals
    const accountTotals = accountResults.map(r => ({
      accountId: r.accountId,
      totalSpend: r.dailyData.reduce((s, d) => s + d.spend, 0),
      todaySpend: r.dailyData.find(d => d.day === now.getDate() && d.month === now.getMonth() + 1)?.spend || 0,
      yesterdaySpend: r.dailyData.find(d => {
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        return d.day === yesterday.getDate() && d.month === yesterday.getMonth() + 1;
      })?.spend || 0,
      error: r.error,
    }));

    const todayStr = now.toISOString().split('T')[0];
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const todayData = dateMap[todayStr];
    const yesterdayData = dateMap[yesterdayStr];

    const totalSpend = mergedDailyData.reduce((s, d) => s + d.spend, 0);
    const todaySpend = todayData?.spend || 0;
    const yesterdaySpend = yesterdayData?.spend || 0;

    return NextResponse.json({
      dailyData: mergedDailyData,
      accountTotals,
      summary: {
        totalSpend,
        todaySpend,
        yesterdaySpend,
        currentDay: now.getDate(),
        daysInMonth,
        targetMonth,
        targetYear,
        lastDay,
      },
    });
  } catch (error) {
    console.error('Pacing API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
