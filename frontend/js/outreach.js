/* ============================================
   LeadForge AI — Outreach Module
   Email preview, approve/reject, edit, batch ops
   ============================================ */

const Outreach = (() => {
  let emails = [];
  let currentFilter = 'all';

  async function init() {
    setupFilters();
    setupEditForm();
    await loadEmails();
  }

  async function loadEmails() {
    const container = document.getElementById('emailsList');
    if (!container) return;

    Skeleton.rows(container, 4);

    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get('campaign_id');

    try {
      const result = await API.outreach.list(campaignId);
      const data = result.data || result;
      emails = data.outreach || (Array.isArray(data) ? data : []);
      renderEmails(emails);
      updateEmailStats(emails);
    } catch {
      emails = [];
      renderEmails([]);
      updateEmailStats([]);
    }
  }

  function updateEmailStats(list) {
    const totalEl = document.getElementById('totalEmails');
    const pendingEl = document.getElementById('pendingCount');
    const approvedEl = document.getElementById('approvedCount');
    const sentEl = document.getElementById('sentCount');

    if (totalEl) totalEl.textContent = list.length;
    if (pendingEl) pendingEl.textContent = list.filter(e => e.status === 'pending' || e.status === 'draft').length;
    if (approvedEl) approvedEl.textContent = list.filter(e => e.status === 'approved').length;
    if (sentEl) sentEl.textContent = list.filter(e => e.status === 'sent').length;
  }

  function renderEmails(list) {
    const container = document.getElementById('emailsList');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">✉️</div>
          <h3>No outreach emails</h3>
          <p>Run a campaign with auto-email enabled to generate AI-crafted outreach emails.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(email => {
      const statusColor = Utils.getStatusColor(email.status);
      return `
        <div class="email-card animate-fade-in-up" data-email-id="${email.id}" data-status="${email.status}">
          <div class="email-card-header">
            <div style="flex:1;min-width:0;">
              <div class="email-subject">${Utils.escapeHtml(email.subject || 'No Subject')}</div>
              <div class="email-recipient">
                To: ${Utils.escapeHtml(email.to_email || email.recipient || 'Unknown')}
                ${email.business_name ? ` — ${Utils.escapeHtml(email.business_name)}` : ''}
              </div>
            </div>
            <span class="badge badge-${statusColor}" style="text-transform:capitalize;flex-shrink:0;">${email.status || 'draft'}</span>
          </div>

          <div class="email-body-preview">
            ${Utils.escapeHtml(email.body || email.content || 'No content')}
          </div>

          <div class="email-actions">
            ${email.status === 'draft' ? `
              <button class="btn btn-success btn-sm" onclick="Outreach.approve('${email.id}')">✓ Approve</button>
            ` : ''}
            ${email.status === 'draft' || email.status === 'pending' ? `
              <button class="btn btn-danger btn-sm" onclick="Outreach.reject('${email.id}')">✕ Reject</button>
            ` : ''}
            ${email.status === 'approved' ? `
              <button class="btn btn-primary btn-sm" onclick="Outreach.send('${email.id}')">📤 Send Now</button>
            ` : ''}
            ${email.status === 'draft' || email.status === 'rejected' ? `
              <button class="btn btn-secondary btn-sm" onclick="Outreach.edit('${email.id}')">✏️ Edit</button>
            ` : ''}
            <button class="btn btn-ghost btn-sm" onclick="Outreach.preview('${email.id}')">👁 Preview</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function setupFilters() {
    const tabs = document.querySelectorAll('#emailTabs .tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        filterEmails();
      });
    });

    const campaignFilter = document.getElementById('outreachCampaignFilter');
    if (campaignFilter) {
      loadCampaignOptions(campaignFilter);
      campaignFilter.addEventListener('change', async () => {
        const cid = campaignFilter.value;
        try {
          const result = await API.outreach.list(cid || null);
          const data = result.data || result;
          emails = data.outreach || (Array.isArray(data) ? data : []);
          filterEmails();
          updateEmailStats(emails);
        } catch {
          emails = [];
          filterEmails();
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

  function filterEmails() {
    let filtered = [...emails];
    if (currentFilter !== 'all') {
      filtered = filtered.filter(e => e.status === currentFilter);
    }
    renderEmails(filtered);
  }

  async function approve(id) {
    try {
      await API.outreach.approve(id);
      Toast.success('Email approved!');
      await loadEmails();
    } catch (err) {
      Toast.error(err.message || 'Failed to approve email.');
    }
  }

  async function reject(id) {
    try {
      await API.outreach.reject(id);
      Toast.info('Email rejected.');
      await loadEmails();
    } catch (err) {
      Toast.error(err.message || 'Failed to reject email.');
    }
  }

  async function send(id) {
    try {
      await API.outreach.send(id);
      Toast.success('Email sent successfully!');
      await loadEmails();
    } catch (err) {
      Toast.error(err.message || 'Failed to send email.');
    }
  }

  function edit(id) {
    const email = emails.find(e => e.id === id || e.id === parseInt(id));
    if (!email) return;

    document.getElementById('editEmailId').value = email.id;
    document.getElementById('editEmailSubject').value = email.subject || '';
    document.getElementById('editEmailBody').value = email.body || email.content || '';
    document.getElementById('editEmailTo').textContent = email.to_email || email.recipient || '';
    Modal.open('editEmailModal');
  }

  function setupEditForm() {
    const form = document.getElementById('editEmailForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editEmailId').value;
      const subject = document.getElementById('editEmailSubject').value.trim();
      const body = document.getElementById('editEmailBody').value.trim();

      if (!subject || !body) {
        Toast.warning('Subject and body are required.');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving...';

      try {
        await API.outreach.update(id, { subject, body });
        Toast.success('Email updated!');
        Modal.close('editEmailModal');
        await loadEmails();
      } catch (err) {
        Toast.error(err.message || 'Failed to update email.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '💾 Save Changes';
      }
    });
  }

  function preview(id) {
    const email = emails.find(e => e.id === id || e.id === parseInt(id));
    if (!email) return;

    const body = document.getElementById('previewEmailBody');
    if (!body) return;

    body.innerHTML = `
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.15rem;">To</div>
        <div style="font-size:0.85rem;">${Utils.escapeHtml(email.to_email || email.recipient || '')}</div>
      </div>
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.15rem;">Subject</div>
        <div style="font-size:0.95rem;font-weight:600;">${Utils.escapeHtml(email.subject || '')}</div>
      </div>
      <div style="border-top:1px solid var(--border-glass);padding-top:1rem;">
        <div style="font-size:0.85rem;line-height:1.7;color:var(--text-secondary);white-space:pre-wrap;">${Utils.escapeHtml(email.body || email.content || '')}</div>
      </div>
    `;
    Modal.open('previewEmailModal');
  }

  async function approveAll() {
    const pending = emails.filter(e => e.status === 'pending' || e.status === 'draft');
    if (pending.length === 0) {
      Toast.info('No pending emails to approve.');
      return;
    }
    if (!confirm(`Approve all ${pending.length} pending emails?`)) return;

    let count = 0;
    for (const email of pending) {
      try {
        await API.outreach.approve(email.id);
        count++;
      } catch {}
    }
    Toast.success(`${count} emails approved!`);
    await loadEmails();
  }

  async function sendAll() {
    const approved = emails.filter(e => e.status === 'approved');
    if (approved.length === 0) {
      Toast.info('No approved emails to send.');
      return;
    }
    if (!confirm(`Send all ${approved.length} approved emails?`)) return;

    let count = 0;
    for (const email of approved) {
      try {
        await API.outreach.send(email.id);
        count++;
      } catch {}
    }
    Toast.success(`${count} emails sent!`);
    await loadEmails();
  }

  return { init, approve, reject, send, edit, preview, approveAll, sendAll, loadEmails };
})();
