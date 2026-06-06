/* ============================================
   LeadForge AI — Campaigns Module
   CRUD, status management, progress display
   ============================================ */

const Campaigns = (() => {
  let campaigns = [];
  let autoRefreshInterval = null;

  async function init() {
    setupCreateForm();
    setupFilters();
    await loadCampaigns();
  }

  async function loadCampaigns() {
    const container = document.getElementById('campaignsList');
    if (!container) return;

    Skeleton.cards(container, 3);

    try {
      const result = await API.campaigns.list();
      const data = result.data || result;
      campaigns = data.campaigns || (Array.isArray(data) ? data : []);
      renderCampaigns(campaigns);
    } catch (err) {
      campaigns = [];
      renderCampaigns([]);
    }
  }

  function renderCampaigns(list) {
    const container = document.getElementById('campaignsList');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon">🚀</div>
          <h3>No campaigns found</h3>
          <p>Create your first campaign to start discovering and reaching out to potential leads.</p>
          <button class="btn btn-primary" style="margin-top:1rem;" onclick="Modal.open('createCampaignModal')">+ New Campaign</button>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(c => {
      const statusColor = Utils.getStatusColor(c.status);
      const progress = c.progress || 0;
      const createdAt = Utils.formatDate(c.created_at);
      const leadsCount = c.leads_count || c.businesses_count || 0;
      const emailsSent = c.emails_sent || 0;

      return `
        <div class="glass-card p-5 animate-fade-in-up" data-campaign-id="${c.id}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:0.75rem;">
            <div style="flex:1;min-width:0;">
              <h3 style="font-size:0.95rem;font-weight:700;margin-bottom:0.3rem;">${Utils.escapeHtml(c.query || c.name || 'Campaign')}</h3>
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                <span class="badge badge-${statusColor}" style="text-transform:capitalize;">${c.status || 'draft'}</span>
                <span style="font-size:0.7rem;color:var(--text-muted);">Created ${createdAt}</span>
              </div>
            </div>
            <div class="dropdown">
              <button class="btn btn-ghost btn-icon btn-sm" data-dropdown="campMenu${c.id}">⋮</button>
              <div class="dropdown-menu" id="campMenu${c.id}">
                <button class="dropdown-item" onclick="Campaigns.viewDetail('${c.id}')">👁 View Details</button>
                ${c.status !== 'running' && c.status !== 'active' ? `<button class="dropdown-item" onclick="Campaigns.start('${c.id}')">▶ Start</button>` : ''}
                ${c.status === 'running' || c.status === 'active' ? `<button class="dropdown-item" onclick="Campaigns.pause('${c.id}')">⏸ Pause</button>` : ''}
                ${c.status === 'running' || c.status === 'active' ? `<button class="dropdown-item" onclick="Campaigns.stop('${c.id}')">⏹ Stop</button>` : ''}
                ${c.status === 'running' || c.status === 'failed' ? `<button class="dropdown-item" onclick="Campaigns.reset('${c.id}')">🔄 Reset</button>` : ''}
                <div class="dropdown-divider"></div>
                <button class="dropdown-item" style="color:var(--danger-light);" onclick="Campaigns.deleteCampaign('${c.id}')">🗑 Delete</button>
              </div>
            </div>
          </div>

          <!-- Stats Row -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-bottom:0.85rem;">
            <div style="text-align:center;padding:0.5rem;background:#f9fafb;border-radius:0.5rem;">
              <div style="font-size:1rem;font-weight:700;">${leadsCount}</div>
              <div style="font-size:0.65rem;color:var(--text-muted);">Leads</div>
            </div>
            <div style="text-align:center;padding:0.5rem;background:#f9fafb;border-radius:0.5rem;">
              <div style="font-size:1rem;font-weight:700;">${emailsSent}</div>
              <div style="font-size:0.65rem;color:var(--text-muted);">Emails</div>
            </div>
            <div style="text-align:center;padding:0.5rem;background:#f9fafb;border-radius:0.5rem;">
              <div style="font-size:1rem;font-weight:700;">${c.reply_rate || 0}%</div>
              <div style="font-size:0.65rem;color:var(--text-muted);">Replies</div>
            </div>
          </div>

          <!-- Progress -->
          <div>
            <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-muted);margin-bottom:0.3rem;">
              <span>Progress</span>
              <span>${progress}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width:${progress}%"></div>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:0.5rem;margin-top:0.85rem;flex-wrap:wrap;">
            ${c.status !== 'running' && c.status !== 'active' ?
              `<button class="btn btn-primary btn-sm" id="actionBtn-start-${c.id}" onclick="Campaigns.start('${c.id}')">▶ Start</button>` :
              `<button class="btn btn-warning btn-sm" id="actionBtn-pause-${c.id}" onclick="Campaigns.pause('${c.id}')">⏸ Pause</button>`
            }
            ${c.status === 'running' || c.status === 'failed' ?
              `<button class="btn btn-secondary btn-sm" id="actionBtn-reset-${c.id}" onclick="Campaigns.reset('${c.id}')">🔄 Reset</button>` : ''
            }
            <a href="leads.html?campaign_id=${c.id}" class="btn btn-secondary btn-sm">👥 Leads</a>
            <a href="outreach.html?campaign_id=${c.id}" class="btn btn-secondary btn-sm">✉️ Emails</a>
          </div>
        </div>
      `;
    }).join('');

    // Auto-refresh: poll every 10s if any campaign is running
    manageAutoRefresh(list);
  }

  function manageAutoRefresh(list) {
    const hasRunning = list.some(c => c.status === 'running' || c.status === 'active');
    if (hasRunning && !autoRefreshInterval) {
      autoRefreshInterval = setInterval(() => loadCampaigns(), 10000);
    } else if (!hasRunning && autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  function setActionLoading(btnId, loadingText) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = true;
      btn._origHTML = btn.innerHTML;
      btn.innerHTML = `<span class="spinner"></span> ${loadingText}`;
    }
  }

  function clearActionLoading(btnId) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn._origHTML || btn.innerHTML;
    }
  }

  function setupCreateForm() {
    const form = document.getElementById('createCampaignForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = document.getElementById('campQuery').value.trim();
      const location = document.getElementById('campLocation').value.trim();
      const maxLeads = parseInt(document.getElementById('campMaxLeads').value) || 50;
      const autoEmail = document.getElementById('campAutoEmail')?.checked || false;

      if (!query) {
        Toast.warning('Please enter a search query.');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Creating...';

      try {
        await API.campaigns.create({
          query,
          settings: {
            location: location || 'United States',
            max_leads: maxLeads,
            auto_email: autoEmail,
          },
        });
        Toast.success('Campaign created successfully!');
        Modal.close('createCampaignModal');
        form.reset();
        await loadCampaigns();
      } catch (err) {
        Toast.error(err.message || 'Failed to create campaign.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🚀 Create Campaign';
      }
    });
  }

  function setupFilters() {
    const statusFilter = document.getElementById('campaignStatusFilter');
    const searchInput = document.getElementById('campaignSearch');

    if (statusFilter) {
      statusFilter.addEventListener('change', () => filterCampaigns());
    }
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce(() => filterCampaigns(), 300));
    }
  }

  function filterCampaigns() {
    const status = document.getElementById('campaignStatusFilter')?.value || '';
    const search = (document.getElementById('campaignSearch')?.value || '').toLowerCase();

    let filtered = [...campaigns];

    if (status) {
      filtered = filtered.filter(c => c.status === status);
    }

    if (search) {
      filtered = filtered.filter(c =>
        (c.query || c.name || '').toLowerCase().includes(search)
      );
    }

    renderCampaigns(filtered);
  }

  async function start(id) {
    const btnId = `actionBtn-start-${id}`;
    setActionLoading(btnId, 'Starting…');
    try {
      await API.campaigns.start(id);
      Toast.success('Campaign started!');
      await loadCampaigns();
    } catch (err) {
      Toast.error(err.message || 'Failed to start campaign.');
      clearActionLoading(btnId);
    }
  }

  async function pause(id) {
    const btnId = `actionBtn-pause-${id}`;
    setActionLoading(btnId, 'Pausing…');
    try {
      await API.campaigns.pause(id);
      Toast.info('Campaign paused.');
      await loadCampaigns();
    } catch (err) {
      Toast.error(err.message || 'Failed to pause campaign.');
      clearActionLoading(btnId);
    }
  }

  async function stop(id) {
    if (!confirm('Are you sure you want to stop this campaign?')) return;
    const btnId = `actionBtn-pause-${id}`;
    setActionLoading(btnId, 'Stopping…');
    try {
      await API.campaigns.stop(id);
      Toast.info('Campaign stopped.');
      await loadCampaigns();
    } catch (err) {
      Toast.error(err.message || 'Failed to stop campaign.');
      clearActionLoading(btnId);
    }
  }

  async function reset(id) {
    if (!confirm('Are you sure you want to reset this campaign? This will restart it from the beginning.')) return;
    const btnId = `actionBtn-reset-${id}`;
    setActionLoading(btnId, 'Resetting…');
    try {
      await API.campaigns.reset(id);
      Toast.success('Campaign reset successfully!');
      await loadCampaigns();
    } catch (err) {
      Toast.error(err.message || 'Failed to reset campaign.');
      clearActionLoading(btnId);
    }
  }

  async function deleteCampaign(id) {
    if (!confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) return;
    try {
      await API.campaigns.delete(id);
      Toast.success('Campaign deleted.');
      await loadCampaigns();
    } catch (err) {
      Toast.error(err.message || 'Failed to delete campaign.');
    }
  }

  async function viewDetail(id) {
    try {
      const result = await API.campaigns.get(id);
      const campaign = result.data?.campaign || result.data || result;
      const modal = document.getElementById('campaignDetailModal');
      const body = document.getElementById('campaignDetailBody');
      if (!modal || !body) return;

      body.innerHTML = `
        <div style="margin-bottom:1rem;">
          <h4 style="font-size:1rem;font-weight:700;margin-bottom:0.5rem;">${Utils.escapeHtml(campaign.query || campaign.name || 'Campaign')}</h4>
          <span class="badge badge-${Utils.getStatusColor(campaign.status)}" style="text-transform:capitalize;">${campaign.status || 'draft'}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div style="padding:0.75rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.15rem;">Created</div>
            <div style="font-size:0.85rem;font-weight:600;">${Utils.formatDate(campaign.created_at)}</div>
          </div>
          <div style="padding:0.75rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.15rem;">Leads Found</div>
            <div style="font-size:0.85rem;font-weight:600;">${campaign.leads_count || campaign.businesses_count || 0}</div>
          </div>
          <div style="padding:0.75rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.15rem;">Emails Sent</div>
            <div style="font-size:0.85rem;font-weight:600;">${campaign.emails_sent || 0}</div>
          </div>
          <div style="padding:0.75rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.15rem;">Reply Rate</div>
            <div style="font-size:0.85rem;font-weight:600;">${campaign.reply_rate || 0}%</div>
          </div>
        </div>
        ${campaign.settings ? `
        <div style="margin-top:1rem;">
          <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:0.5rem;">Settings</div>
          <div style="background:#f9fafb;border-radius:0.5rem;padding:0.75rem;font-size:0.8rem;">
            <div>Location: ${Utils.escapeHtml(campaign.settings.location || 'N/A')}</div>
            <div>Max Leads: ${campaign.settings.max_leads || 'N/A'}</div>
          </div>
        </div>` : ''}
      `;
      Modal.open('campaignDetailModal');
    } catch (err) {
      Toast.error(err.message || 'Failed to load campaign details.');
    }
  }

  return { init, start, pause, stop, reset, deleteCampaign, viewDetail, loadCampaigns };
})();
