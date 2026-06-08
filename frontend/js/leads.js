/* ============================================
   LeadForge AI — Leads Module
   AG Grid setup, columns, detail, CSV export
   ============================================ */

const Leads = (() => {
  let gridApi = null;
  let allLeads = [];

  async function init() {
    setupFilters();
    await loadLeads();
  }

  async function loadLeads() {
    const gridContainer = document.getElementById('leadsGrid');
    if (!gridContainer) return;

    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get('campaign_id');

    try {
      const result = await API.businesses.list(campaignId);
      const data = result.data || result;
      allLeads = data.businesses || (Array.isArray(data) ? data : []);
      initGrid(allLeads);
      updateLeadStats(allLeads);
    } catch (err) {
      allLeads = [];
      initGrid([]);
      updateLeadStats([]);
    }
  }

  function updateLeadStats(leads) {
    const total = document.getElementById('totalLeads');
    const withEmail = document.getElementById('leadsWithEmail');
    const avgScore = document.getElementById('avgLeadScore');
    const highScore = document.getElementById('highScoreLeads');

    if (total) total.textContent = leads.length;
    if (withEmail) withEmail.textContent = leads.filter(l => (Array.isArray(l.emails) && l.emails.length > 0) || l.email || l.email_status === 'found' || l.email_status === 'valid').length;
    if (avgScore) {
      const scores = leads.filter(l => l.lead_score != null).map(l => l.lead_score);
      avgScore.textContent = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    }
    if (highScore) highScore.textContent = leads.filter(l => (l.lead_score || 0) >= 80).length;
  }

  function initGrid(data) {
    const gridContainer = document.getElementById('leadsGrid');
    if (!gridContainer) return;

    if (gridApi) {
      gridApi.destroy();
    }

    const columnDefs = [
      {
        headerCheckboxSelection: true,
        checkboxSelection: true,
        headerCheckboxSelectionFilteredOnly: true,
        width: 50,
        pinned: 'left',
        suppressMenu: true,
        resizable: false,
      },
      {
        headerName: 'Business Name',
        field: 'name',
        minWidth: 200,
        flex: 1.5,
        cellRenderer: (params) => {
          const name = params.value || 'Unknown';
          return `<span style="font-weight:600;color:#111827;cursor:pointer;" onclick="Leads.viewDetail('${params.data.id}')">${Utils.escapeHtml(name)}</span>`;
        },
      },
      {
        headerName: 'Location',
        field: 'location',
        minWidth: 150,
        flex: 1,
        valueGetter: (params) => params.data.location || params.data.address || '',
        valueFormatter: (params) => params.value || '—',
      },
      {
        headerName: 'Phone',
        field: 'phone',
        minWidth: 130,
        valueFormatter: (params) => params.value || '—',
      },
      {
        headerName: 'Website',
        field: 'website',
        minWidth: 160,
        cellRenderer: (params) => {
          if (!params.value) return '—';
          const url = params.value.startsWith('http') ? params.value : `https://${params.value}`;
          return `<a href="${url}" target="_blank" rel="noopener" style="color:#16a34a;font-size:0.8rem;">${Utils.truncate(params.value, 30)}</a>`;
        },
      },
      {
        headerName: 'Rating',
        field: 'rating',
        width: 120,
        cellRenderer: (params) => {
          const rating = params.value || 0;
          return Utils.renderStars(Math.round(rating)) + ` <span style="font-size:0.7rem;color:#94a3b8;margin-left:4px;">${rating}</span>`;
        },
        comparator: (a, b) => (a || 0) - (b || 0),
      },
      {
        headerName: 'Reviews',
        field: 'reviews_count',
        width: 100,
        valueFormatter: (params) => Utils.formatNumber(params.value || 0),
        comparator: (a, b) => (a || 0) - (b || 0),
      },
      {
        headerName: 'Lead Score',
        field: 'lead_score',
        width: 115,
        cellRenderer: (params) => {
          const score = params.value || 0;
          const color = Utils.getScoreColor(score);
          return `<span class="badge badge-${color}" style="font-size:0.75rem;font-weight:700;">${score}</span>`;
        },
        comparator: (a, b) => (a || 0) - (b || 0),
      },
      {
        headerName: 'Email Status',
        field: 'email_status',
        width: 120,
        valueGetter: (params) => {
          const emails = params.data.emails;
          if (Array.isArray(emails) && emails.length) {
            if (emails.some(e => e.verification_status === 'valid')) return 'valid';
            return 'found';
          }
          return params.data.email_status || 'pending';
        },
        cellRenderer: (params) => {
          const status = params.value || 'pending';
          const color = Utils.getStatusColor(status);
          return `<span class="badge badge-${color}" style="text-transform:capitalize;">${status}</span>`;
        },
      },
      {
        headerName: 'Stage',
        field: 'pipeline_stage',
        width: 130,
        cellRenderer: (params) => {
          const stage = params.value || 'discovered';
          return `<span class="badge badge-neutral" style="text-transform:capitalize;">${stage.replace(/_/g, ' ')}</span>`;
        },
      },
      {
        headerName: 'Actions',
        width: 135,
        pinned: 'right',
        suppressMenu: true,
        sortable: false,
        cellRenderer: (params) => {
          return `
            <div style="display:flex;gap:4px;align-items:center;height:100%;">
              <button class="btn btn-ghost btn-sm" style="padding:4px 6px;font-size:0.75rem;" onclick="Leads.viewDetail('${params.data.id}')" title="View">👁</button>
              <button class="btn btn-ghost btn-sm" style="padding:4px 6px;font-size:0.75rem;" onclick="Leads.sendEmail('${params.data.id}')" title="Email">✉️</button>
              <button class="btn btn-ghost btn-sm" style="padding:4px 6px;font-size:0.75rem;color:var(--danger-light,#ef4444);" onclick="Leads.deleteLead('${params.data.id}')" title="Delete">🗑</button>
            </div>
          `;
        },
      },
    ];

    const gridOptions = {
      columnDefs,
      rowData: data,
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
        suppressMovable: false,
      },
      rowSelection: 'multiple',
      animateRows: true,
      pagination: true,
      paginationPageSize: 25,
      paginationPageSizeSelector: [10, 25, 50, 100],
      suppressRowClickSelection: true,
      domLayout: 'autoHeight',
      getRowId: (params) => params.data.id?.toString(),
      overlayNoRowsTemplate: `
        <div class="empty-state" style="padding:2rem;">
          <div class="empty-state-icon">👥</div>
          <h3>No leads found</h3>
          <p>Run a campaign to discover new leads.</p>
        </div>
      `,
      onSelectionChanged: () => {
        const selected = gridApi.getSelectedRows();
        const bulkActions = document.getElementById('bulkActions');
        const selectedCount = document.getElementById('selectedCount');
        if (bulkActions) bulkActions.style.display = selected.length > 0 ? 'flex' : 'none';
        if (selectedCount) selectedCount.textContent = selected.length;
      },
    };

    gridApi = agGrid.createGrid(gridContainer, gridOptions);
  }

  function setupFilters() {
    const searchInput = document.getElementById('leadSearch');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        if (gridApi) {
          gridApi.setGridOption('quickFilterText', e.target.value);
        }
      }, 300));
    }

    const campaignFilter = document.getElementById('leadCampaignFilter');
    if (campaignFilter) {
      loadCampaignOptions(campaignFilter);
      campaignFilter.addEventListener('change', async () => {
        const cid = campaignFilter.value;
        try {
          const result = await API.businesses.list(cid || null);
          const data = result.data || result;
          allLeads = data.businesses || (Array.isArray(data) ? data : []);
          if (gridApi) {
            gridApi.setGridOption('rowData', allLeads);
          }
          updateLeadStats(allLeads);
        } catch {
          if (gridApi) gridApi.setGridOption('rowData', []);
        }
      });
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

  async function viewDetail(id) {
    try {
      const result = await API.businesses.get(id);
      const lead = result.data?.business || result.data || result;
      const body = document.getElementById('leadDetailBody');
      if (!body) return;

      body.innerHTML = `
        <div style="margin-bottom:1.25rem;">
          <h4 style="font-size:1.1rem;font-weight:700;margin-bottom:0.25rem;">${Utils.escapeHtml(lead.name || 'Unknown')}</h4>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            ${lead.lead_score != null ? `<span class="badge badge-${Utils.getScoreColor(lead.lead_score)}">Score: ${lead.lead_score}</span>` : ''}
            ${lead.pipeline_stage ? `<span class="badge badge-neutral" style="text-transform:capitalize;">${lead.pipeline_stage.replace(/_/g, ' ')}</span>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1.25rem;">
          <div style="padding:0.65rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.1rem;">Location</div>
            <div style="font-size:0.82rem;">${Utils.escapeHtml(lead.location || lead.address || '—')}</div>
          </div>
          <div style="padding:0.65rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.1rem;">Phone</div>
            <div style="font-size:0.82rem;">${lead.phone || '—'}</div>
          </div>
          <div style="padding:0.65rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.1rem;">Email</div>
            <div style="font-size:0.82rem;">${(Array.isArray(lead.emails) && lead.emails.length ? Utils.escapeHtml(lead.emails[0].email) : (lead.email ? Utils.escapeHtml(lead.email) : '—'))}</div>
          </div>
          <div style="padding:0.65rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.1rem;">Website</div>
            <div style="font-size:0.82rem;">${lead.website ? `<a href="${lead.website}" target="_blank" style="color:#16a34a;">${Utils.truncate(lead.website, 25)}</a>` : '—'}</div>
          </div>
          <div style="padding:0.65rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.1rem;">Rating</div>
            <div>${Utils.renderStars(Math.round(lead.rating || 0))} <span style="font-size:0.75rem;color:#94a3b8;">${lead.rating || 0}</span></div>
          </div>
          <div style="padding:0.65rem;background:#f9fafb;border-radius:0.5rem;">
            <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.1rem;">Reviews</div>
            <div style="font-size:0.82rem;">${Utils.formatNumber(lead.reviews_count || 0)}</div>
          </div>
        </div>

        ${lead.description ? `
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:0.35rem;">Description</div>
          <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.5;">${Utils.escapeHtml(lead.description)}</div>
        </div>` : ''}

        <div style="display:flex;gap:0.5rem;margin-top:1rem;">
          <button class="btn btn-primary btn-sm" onclick="Leads.sendEmail('${lead.id}')">✉️ Send Email</button>
          <select class="form-select" style="width:auto;padding:0.35rem 1.5rem 0.35rem 0.5rem;font-size:0.78rem;" onchange="Leads.updateStage('${lead.id}', this.value)">
            <option value="">Change Stage...</option>
            <option value="discovered">Discovered</option>
            <option value="analyzed">Analyzed</option>
            <option value="email_sent">Email Sent</option>
            <option value="opened">Opened</option>
            <option value="replied">Replied</option>
            <option value="interested">Interested</option>
            <option value="meeting_scheduled">Meeting Scheduled</option>
            <option value="proposal_sent">Proposal Sent</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </div>
      `;
      Modal.open('leadDetailModal');
    } catch (err) {
      Toast.error(err.message || 'Failed to load lead details.');
    }
  }

  async function updateStage(id, stage) {
    if (!stage) return;
    try {
      await API.businesses.updateStage(id, stage);
      Toast.success(`Stage updated to ${stage.replace(/_/g, ' ')}`);
      await loadLeads();
    } catch (err) {
      Toast.error(err.message || 'Failed to update stage.');
    }
  }

  function sendEmail(id) {
    window.location.href = `outreach.html?business_id=${id}`;
  }

  async function deleteLead(id) {
    if (!confirm('Delete this lead? This also removes its reviews, emails and outreach. This cannot be undone.')) return;
    try {
      await API.businesses.delete(id);
      Toast.success('Lead deleted.');
      await loadLeads();
    } catch (err) {
      Toast.error(err.message || 'Failed to delete lead.');
    }
  }

  async function deleteSelected() {
    const selected = getSelectedLeads();
    if (!selected.length) {
      Toast.info('Select at least one lead to delete.');
      return;
    }
    if (!confirm(`Delete ${selected.length} selected lead(s)? This also removes their reviews, emails and outreach. This cannot be undone.`)) return;
    try {
      const ids = selected.map(r => r.id);
      const result = await API.businesses.bulkDelete(ids);
      Toast.success(result.message || `${ids.length} lead(s) deleted.`);
      const bulkActions = document.getElementById('bulkActions');
      if (bulkActions) bulkActions.style.display = 'none';
      await loadLeads();
    } catch (err) {
      Toast.error(err.message || 'Failed to delete leads.');
    }
  }

  // Re-verify all pending/risky emails, then auto-generate AI outreach for any
  // valid lead that doesn't have a draft yet. Runs in the background on the server.
  async function verifyAndGenerate() {
    if (!confirm('Re-verify all pending emails and auto-generate AI outreach for valid leads?\n\n(Make sure a Groq API key is added in Settings — outreach needs it.)')) return;
    const campaignFilter = document.getElementById('leadCampaignFilter');
    const params = new URLSearchParams(window.location.search);
    const cid = (campaignFilter && campaignFilter.value) || params.get('campaign_id') || null;
    try {
      const result = await API.businesses.verifyEmails(cid);
      Toast.success(result.message || 'Verification started.', 'Verifying', 7000);
      // Refresh leads after a short delay so newly-valid emails appear.
      setTimeout(() => loadLeads(), 8000);
    } catch (err) {
      Toast.error(err.message || 'Failed to start verification.');
    }
  }

  function exportCSV() {
    if (gridApi) {
      gridApi.exportDataAsCsv({
        fileName: 'leadforge_leads.csv',
        columnKeys: ['name', 'location', 'phone', 'website', 'rating', 'reviews_count', 'lead_score', 'email_status', 'pipeline_stage'],
      });
      Toast.success('CSV exported successfully!');
    }
  }

  function getSelectedLeads() {
    return gridApi ? gridApi.getSelectedRows() : [];
  }

  return { init, viewDetail, sendEmail, updateStage, deleteLead, deleteSelected, verifyAndGenerate, exportCSV, getSelectedLeads, loadLeads };
})();
