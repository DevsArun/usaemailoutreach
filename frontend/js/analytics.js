/* ============================================
   LeadForge AI — Analytics Module
   Chart.js charts, date range, data refresh
   ============================================ */

const Analytics = (() => {
  let charts = {};

  async function init() {
    setupDateRange();
    await loadAnalytics();
  }

  async function loadAnalytics() {
    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get('campaign_id') || document.getElementById('analyticsCampaignFilter')?.value;

    try {
      const [overview, detailed] = await Promise.allSettled([
        API.analytics.overview(),
        API.analytics.detailed(campaignId || null),
      ]);

      const overviewData = overview.status === 'fulfilled' ? (overview.value.data || overview.value) : {};
      const detailedData = detailed.status === 'fulfilled' ? (detailed.value.data || detailed.value) : {};

      renderOverviewStats(overviewData);
      renderEmailsOverTimeChart(detailedData);
      renderOpenReplyRateChart(detailedData);
      renderLeadSourcesChart(detailedData);
      renderFunnelChart(detailedData);
      renderScoreDistributionChart(detailedData);
    } catch {
      renderOverviewStats({});
      renderEmailsOverTimeChart({});
      renderOpenReplyRateChart({});
      renderLeadSourcesChart({});
      renderFunnelChart({});
      renderScoreDistributionChart({});
    }
  }

  function renderOverviewStats(data) {
    const sent = data.totalEmailsSent ?? data.totalEmails ?? data.emails_sent ?? 0;
    const won = data.dealsWon ?? 0;
    const conversion = data.conversion_rate ?? (sent > 0 ? Math.round((won / sent) * 100) : 0);
    const stats = [
      { id: 'analyticLeads', value: data.totalBusinesses ?? data.total_leads ?? 0 },
      { id: 'analyticEmails', value: sent },
      { id: 'analyticOpenRate', value: data.openRate ?? data.open_rate ?? 0, suffix: '%' },
      { id: 'analyticReplyRate', value: data.replyRate ?? data.reply_rate ?? 0, suffix: '%' },
      { id: 'analyticConversion', value: conversion, suffix: '%' },
      { id: 'analyticMeetings', value: data.meetingsBooked ?? data.meetings_scheduled ?? 0 },
    ];

    stats.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) {
        Utils.countUp(el, s.value, 1000);
        if (s.suffix) {
          setTimeout(() => {
            el.textContent = s.value + s.suffix;
          }, 1100);
        }
      }
    });
  }

  function getChartColors() {
    return {
      primary: '#16a34a',
      primaryLight: '#22c55e',
      accent: '#059669',
      success: '#16a34a',
      warning: '#f59e0b',
      danger: '#ef4444',
      text: '#6b7280',
      grid: 'rgba(0,0,0,0.06)',
      bg1: 'rgba(22, 163, 74, 0.12)',
      bg2: 'rgba(5, 150, 105, 0.12)',
    };
  }

  function defaultScaleOptions() {
    const c = getChartColors();
    return {
      x: {
        ticks: { color: c.text, font: { family: 'Inter', size: 11 } },
        grid: { color: c.grid },
        border: { color: c.grid },
      },
      y: {
        ticks: { color: c.text, font: { family: 'Inter', size: 11 } },
        grid: { color: c.grid },
        border: { color: c.grid },
        beginAtZero: true,
      },
    };
  }

  function renderEmailsOverTimeChart(data) {
    const ctx = document.getElementById('emailsOverTimeChart');
    if (!ctx) return;
    if (charts.emailsOverTime) charts.emailsOverTime.destroy();

    const c = getChartColors();
    // Backend returns an array of { date, count }. Map it to chart shape.
    const rows = Array.isArray(data.emailsOverTime) ? data.emailsOverTime : [];
    const labels = rows.length
      ? rows.map(r => Utils.formatDate(r.date))
      : (data.emailsOverTime?.labels || []);
    const values = rows.length
      ? rows.map(r => parseInt(r.count) || 0)
      : (data.emailsOverTime?.values || []);

    charts.emailsOverTime = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Emails Sent',
          data: values,
          borderColor: c.primary,
          backgroundColor: c.bg1,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: c.primary,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#111827',
            bodyColor: '#4b5563',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            titleFont: { family: 'Inter', weight: '600' },
            bodyFont: { family: 'Inter' },
          },
        },
        scales: defaultScaleOptions(),
      },
    });
  }

  function renderOpenReplyRateChart(data) {
    const ctx = document.getElementById('openReplyRateChart');
    if (!ctx) return;
    if (charts.openReplyRate) charts.openReplyRate.destroy();

    const c = getChartColors();
    // Use real per-campaign data (Leads vs Replies) from topPerformingCampaigns.
    const camps = Array.isArray(data.topPerformingCampaigns) ? data.topPerformingCampaigns : [];
    const labels = camps.length
      ? camps.map(c2 => Utils.truncate(c2.query || `Campaign ${c2.id}`, 18))
      : [];
    const leadCounts = camps.map(c2 => parseInt(c2.business_count) || 0);
    const replyCounts = camps.map(c2 => parseInt(c2.reply_count) || 0);

    charts.openReplyRate = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Leads',
            data: leadCounts,
            backgroundColor: c.bg1,
            borderColor: c.primary,
            borderWidth: 1,
            borderRadius: 6,
          },
          {
            label: 'Replies',
            data: replyCounts,
            backgroundColor: c.bg2,
            borderColor: c.success,
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: c.text, font: { family: 'Inter', size: 11 }, boxWidth: 12, boxHeight: 12 },
            position: 'top',
          },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#111827',
            bodyColor: '#4b5563',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            cornerRadius: 8,
          },
        },
        scales: defaultScaleOptions(),
      },
    });
  }

  function renderLeadSourcesChart(data) {
    const ctx = document.getElementById('leadSourcesChart');
    if (!ctx) return;
    if (charts.leadSources) charts.leadSources.destroy();

    // Backend returns an array of { source, count }.
    const rows = Array.isArray(data.leadSourceDistribution) ? data.leadSourceDistribution : [];
    const labels = rows.length
      ? rows.map(r => (r.source || 'Unknown'))
      : (data.leadSourceDistribution?.labels || []);
    const values = rows.length
      ? rows.map(r => parseInt(r.count) || 0)
      : (data.leadSourceDistribution?.values || []);
    const colors = ['#16a34a', '#059669', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

    charts.leadSources = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors.map(c => c + '33'),
          borderColor: colors,
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#6b7280', font: { family: 'Inter', size: 11 }, boxWidth: 12, boxHeight: 12, padding: 12 },
          },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#111827',
            bodyColor: '#4b5563',
            cornerRadius: 8,
          },
        },
      },
    });
  }

  function renderFunnelChart(data) {
    const ctx = document.getElementById('funnelChart');
    if (!ctx) return;
    if (charts.funnel) charts.funnel.destroy();

    const stages = ['Discovered', 'Analyzed', 'Email Sent', 'Opened', 'Replied', 'Interested', 'Meeting', 'Proposal', 'Won'];
    const stageKeys = ['discovered', 'analyzed', 'email_sent', 'opened', 'replied', 'interested', 'meeting_scheduled', 'proposal_sent', 'won'];
    // Backend returns an array of { pipeline_stage, count }. Map to fixed order.
    const funnelRows = Array.isArray(data.pipelineFunnel) ? data.pipelineFunnel : [];
    let values;
    if (funnelRows.length) {
      const byStage = {};
      funnelRows.forEach(r => { byStage[r.pipeline_stage] = parseInt(r.count) || 0; });
      values = stageKeys.map(k => byStage[k] || 0);
    } else {
      values = data.pipelineFunnel?.values || data.funnel?.values || stageKeys.map(() => 0);
    }

    const gradient = values.map((_, i) => {
      const ratio = i / (stages.length - 1);
      const r = Math.round(22 + (5 - 22) * ratio);
      const g = Math.round(163 + (150 - 163) * ratio);
      const b = Math.round(74 + (105 - 74) * ratio);
      return `rgba(${r},${g},${b},0.6)`;
    });

    charts.funnel = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: stages,
        datasets: [{
          label: 'Leads',
          data: values,
          backgroundColor: gradient,
          borderColor: gradient.map(c => c.replace('0.6', '1')),
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#111827',
            bodyColor: '#4b5563',
            cornerRadius: 8,
          },
        },
        scales: {
          x: {
            ticks: { color: '#6b7280', font: { family: 'Inter', size: 11 } },
            grid: { color: 'rgba(0,0,0,0.06)' },
            beginAtZero: true,
          },
          y: {
            ticks: { color: '#6b7280', font: { family: 'Inter', size: 11 } },
            grid: { display: false },
          },
        },
      },
    });
  }

  function renderScoreDistributionChart(data) {
    const ctx = document.getElementById('scoreDistChart');
    if (!ctx) return;
    if (charts.scoreDist) charts.scoreDist.destroy();

    const c = getChartColors();
    const labels = data.scoreDistribution?.labels || data.score_distribution?.labels || ['0-20', '20-40', '40-60', '60-80', '80-100'];
    const values = data.scoreDistribution?.values || data.score_distribution?.values || [0, 0, 0, 0, 0];

    charts.scoreDist = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Leads',
          data: values,
          borderColor: c.accent,
          backgroundColor: 'rgba(5, 150, 105, 0.12)',
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: c.accent,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#111827',
            bodyColor: '#4b5563',
            cornerRadius: 8,
          },
        },
        scales: defaultScaleOptions(),
      },
    });
  }

  function setupDateRange() {
    const campaignFilter = document.getElementById('analyticsCampaignFilter');
    if (campaignFilter) {
      loadCampaignOptions(campaignFilter);
      campaignFilter.addEventListener('change', () => loadAnalytics());
    }

    const refreshBtn = document.getElementById('refreshAnalytics');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadAnalytics());
    }
  }

  async function loadCampaignOptions(select) {
    try {
      const result = await API.campaigns.list();
      const data = result.data || result;
      const campaigns = data.campaigns || (Array.isArray(data) ? data : []);
      campaigns.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = Utils.truncate(c.query || c.name || 'Campaign', 40);
        select.appendChild(option);
      });
    } catch {}
  }

  return { init, loadAnalytics };
})();
