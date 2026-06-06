/* ============================================
   LeadForge AI — Dashboard Module
   Stats, count-up, activity feed, quick-start
   ============================================ */

const Dashboard = (() => {
  let pollInterval = null;

  async function init() {
    loadStats();
    loadActivityFeed();
    loadRecentCampaigns();
    setupQuickStart();
    pollInterval = setInterval(loadActivityFeed, 30000);
  }

  async function loadStats() {
    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    statsGrid.innerHTML = `
      <div class="stat-card animate-fade-in-up stagger-1">
        <div class="skeleton skeleton-text" style="width:40%;height:12px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:60%;height:28px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:30%;height:10px;"></div>
      </div>
      <div class="stat-card animate-fade-in-up stagger-2">
        <div class="skeleton skeleton-text" style="width:40%;height:12px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:60%;height:28px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:30%;height:10px;"></div>
      </div>
      <div class="stat-card animate-fade-in-up stagger-3">
        <div class="skeleton skeleton-text" style="width:40%;height:12px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:60%;height:28px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:30%;height:10px;"></div>
      </div>
      <div class="stat-card animate-fade-in-up stagger-4">
        <div class="skeleton skeleton-text" style="width:40%;height:12px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:60%;height:28px;margin-bottom:0.5rem;"></div>
        <div class="skeleton skeleton-text" style="width:30%;height:10px;"></div>
      </div>
    `;

    try {
      const result = await API.analytics.overview();
      const data = result.data || result;
      renderStats(data);
      populateQuickStats(data);
    } catch {
      renderStats({
        total_leads: 0,
        active_campaigns: 0,
        emails_sent: 0,
        reply_rate: 0,
        leads_change: 0,
        campaigns_change: 0,
        emails_change: 0,
        reply_change: 0,
      });
    }
  }

  function renderStats(data) {
    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    const stats = [
      {
        icon: '👥',
        iconBg: 'rgba(22,163,74,0.1)',
        label: 'Total Leads',
        value: data.totalBusinesses || data.total_leads || 0,
        change: data.leads_change || 0,
        up: true,
      },
      {
        icon: '🚀',
        iconBg: 'rgba(5,150,105,0.1)',
        label: 'Active Campaigns',
        value: data.totalCampaigns || data.active_campaigns || 0,
        change: data.campaigns_change || 0,
        up: (data.campaigns_change || 0) >= 0,
      },
      {
        icon: '✉️',
        iconBg: 'rgba(59,130,246,0.1)',
        label: 'Emails Sent',
        value: data.totalEmails || data.emails_sent || 0,
        change: data.emails_change || 0,
        up: (data.emails_change || 0) >= 0,
      },
      {
        icon: '💬',
        iconBg: 'rgba(245,158,11,0.1)',
        label: 'Reply Rate',
        value: data.reply_rate || 0,
        change: data.reply_change || 0,
        up: (data.reply_change || 0) >= 0,
        suffix: '%',
      },
    ];

    statsGrid.innerHTML = stats.map((s, i) => `
      <div class="stat-card animate-fade-in-up stagger-${i + 1}">
        <div class="stat-icon" style="background:${s.iconBg}">${s.icon}</div>
        <div class="stat-value" id="statValue${i}">0</div>
        <div class="stat-label">${s.label}</div>
        <span class="stat-change ${s.up ? 'up' : 'down'}">
          ${s.up ? '↑' : '↓'} ${Math.abs(s.change)}%
        </span>
      </div>
    `).join('');

    stats.forEach((s, i) => {
      const el = document.getElementById(`statValue${i}`);
      if (el) {
        if (s.suffix) {
          Utils.countUp(el, s.value, 1200);
          setTimeout(() => {
            el.textContent = Utils.formatNumber(s.value) + s.suffix;
          }, 1300);
        } else {
          Utils.countUp(el, s.value, 1200);
        }
      }
    });
  }

  async function loadActivityFeed() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    try {
      const result = await API.replies.list();
      const repliesData = result.data || result;
      const activities = (repliesData.replies || (Array.isArray(repliesData) ? repliesData : [])).slice(0, 8);

      if (activities.length === 0) {
        renderDefaultActivity(feed);
        return;
      }

      feed.innerHTML = activities.map((a) => {
        const type = a.classification || 'reply';
        const colors = {
          interested: 'rgba(22,163,74,0.1)',
          positive: 'rgba(22,163,74,0.1)',
          not_interested: 'rgba(239,68,68,0.1)',
          negative: 'rgba(239,68,68,0.1)',
          out_of_office: 'rgba(245,158,11,0.1)',
          question: 'rgba(59,130,246,0.1)',
        };
        const icons = {
          interested: '✓', positive: '✓',
          not_interested: '✕', negative: '✕',
          out_of_office: '⏱', question: '?',
        };
        return `
          <div class="activity-item">
            <div class="activity-dot" style="background:${colors[type] || 'rgba(22,163,74,0.1)'}">
              ${icons[type] || '💬'}
            </div>
            <div>
              <div class="activity-text">
                <strong>${Utils.escapeHtml(a.sender || a.from_email || 'Someone')}</strong> replied to your outreach
              </div>
              <div class="activity-time">${Utils.timeAgo(a.received_at || a.created_at)}</div>
            </div>
          </div>
        `;
      }).join('');

      const badge = document.getElementById('replyBadge');
      const unread = activities.filter(a => !a.read).length;
      if (badge && unread > 0) {
        badge.textContent = unread;
        badge.style.display = 'inline';
      }
    } catch {
      renderDefaultActivity(feed);
    }
  }

  function renderDefaultActivity(feed) {
    const defaultActivities = [
      { icon: '🚀', bg: 'rgba(22,163,74,0.1)', text: 'System initialized and ready to go', time: 'just now' },
      { icon: '⚙️', bg: 'rgba(5,150,105,0.1)', text: 'Configure your <strong>SMTP settings</strong> to start sending', time: '1m ago' },
      { icon: '🔑', bg: 'rgba(59,130,246,0.1)', text: 'Add your <strong>Groq API key</strong> for AI features', time: '2m ago' },
      { icon: '📋', bg: 'rgba(245,158,11,0.1)', text: 'Create your first <strong>campaign</strong> to discover leads', time: '5m ago' },
    ];

    feed.innerHTML = defaultActivities.map(a => `
      <div class="activity-item">
        <div class="activity-dot" style="background:${a.bg}">${a.icon}</div>
        <div>
          <div class="activity-text">${a.text}</div>
          <div class="activity-time">${a.time}</div>
        </div>
      </div>
    `).join('');
  }

  async function loadRecentCampaigns() {
    const container = document.getElementById('recentCampaigns');
    if (!container) return;

    try {
      const result = await API.campaigns.list();
      const campaignsData = result.data || result;
      const list = campaignsData.campaigns || (Array.isArray(campaignsData) ? campaignsData : []);

      if (list.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🚀</div>
            <h3>No campaigns yet</h3>
            <p>Create your first campaign to start discovering leads.</p>
            <a href="campaigns.html" class="btn btn-primary btn-sm" style="margin-top:1rem;">Create Campaign</a>
          </div>
        `;
        return;
      }

      container.innerHTML = list.slice(0, 5).map(c => {
        const statusColor = Utils.getStatusColor(c.status);
        const progress = c.progress || 0;
        return `
          <div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-bottom:1px solid #f3f4f6;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.85rem;font-weight:600;margin-bottom:0.2rem;">
                <a href="campaigns.html" style="color:var(--text-primary);">${Utils.escapeHtml(c.query || c.name || 'Campaign')}</a>
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span class="badge badge-${statusColor}">${c.status || 'draft'}</span>
                <span style="font-size:0.7rem;color:var(--text-muted);">${c.leads_count || 0} leads</span>
              </div>
            </div>
            <div style="width:100px;">
              <div class="progress-bar">
                <div class="progress-bar-fill" style="width:${progress}%"></div>
              </div>
              <div style="font-size:0.65rem;color:var(--text-muted);text-align:right;margin-top:0.2rem;">${progress}%</div>
            </div>
          </div>
        `;
      }).join('');
    } catch {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🚀</div>
          <h3>No campaigns yet</h3>
          <p>Create your first campaign to start discovering leads.</p>
          <a href="campaigns.html" class="btn btn-primary btn-sm" style="margin-top:1rem;">Create Campaign</a>
        </div>
      `;
    }
  }

  function setupQuickStart() {
    const form = document.getElementById('quickStartForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = document.getElementById('quickStartQuery').value.trim();
      const location = document.getElementById('quickStartLocation').value.trim();

      if (!query) {
        Toast.warning('Please enter a business type to search for.');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Creating...';

      try {
        await API.campaigns.create({
          query: query,
          settings: { location: location || 'United States' },
        });
        Toast.success('Campaign created successfully!');
        window.location.href = 'campaigns.html';
      } catch (err) {
        Toast.error(err.message || 'Failed to create campaign.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🚀 Launch Campaign';
      }
    });
  }

  function populateQuickStats(data) {
    const pendingEl = document.getElementById('pendingEmails');
    const unreadEl = document.getElementById('unreadReplies');
    const dealsEl = document.getElementById('pipelineDeals');

    if (pendingEl) pendingEl.textContent = data.pendingEmails || data.pending_emails || 0;
    if (unreadEl) unreadEl.textContent = data.unreadReplies || data.unread_replies || 0;
    if (dealsEl) dealsEl.textContent = data.pipelineDeals || data.pipeline_deals || 0;

    // Performance bars
    const openRate = data.open_rate || data.openRate || 0;
    const replyRate = data.reply_rate || data.replyRate || 0;
    const conversion = data.conversion_rate || data.conversionRate || 0;

    const setPerf = (id, barId, val) => {
      const el = document.getElementById(id);
      const bar = document.getElementById(barId);
      if (el) el.textContent = `${Math.round(val)}%`;
      if (bar) bar.style.width = `${Math.min(100, val)}%`;
    };

    setPerf('perfOpenRate', 'perfOpenRateBar', openRate);
    setPerf('perfReplyRate', 'perfReplyRateBar', replyRate);
    setPerf('perfConversion', 'perfConversionBar', conversion);
  }

  function destroy() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  return { init, destroy };
})();
