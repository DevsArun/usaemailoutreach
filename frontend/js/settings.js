/* ============================================
   LeadForge AI — Settings Module
   SMTP, Groq keys, services, proxy settings
   ============================================ */

const Settings = (() => {
  let smtpAccounts = [];
  let groqKeys = [];

  async function init() {
    setupTabs();
    setupSmtpForm();
    setupGroqForm();
    setupGeneralForm();
    await loadAllSettings();
  }

  function setupTabs() {
    const tabs = document.querySelectorAll('#settingsTabs .tab');
    const panels = document.querySelectorAll('.settings-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.style.display = 'none');
        tab.classList.add('active');
        const panel = document.getElementById(tab.dataset.panel);
        if (panel) panel.style.display = 'block';
      });
    });
  }

  async function loadAllSettings() {
    await Promise.allSettled([
      loadSmtpAccounts(),
      loadGroqKeys(),
      loadGeneralSettings(),
    ]);
  }

  // ---- SMTP ----
  async function loadSmtpAccounts() {
    const container = document.getElementById('smtpList');
    if (!container) return;

    try {
      const result = await API.settings.smtp.list();
      const data = result.data || result;
      smtpAccounts = data.accounts || (Array.isArray(data) ? data : []);
      renderSmtpAccounts();
    } catch {
      smtpAccounts = [];
      renderSmtpAccounts();
    }
  }

  function renderSmtpAccounts() {
    const container = document.getElementById('smtpList');
    if (!container) return;

    if (smtpAccounts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📧</div>
          <h3>No SMTP accounts</h3>
          <p>Add an SMTP account to start sending outreach emails.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = smtpAccounts.map(account => `
      <div class="glass-card-static p-4 mb-3" data-smtp-id="${account.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
              <span style="font-size:0.9rem;font-weight:600;">${Utils.escapeHtml(account.email || account.username || 'Account')}</span>
              ${account.is_default ? '<span class="badge badge-primary">Default</span>' : ''}
              ${account.verified ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-warning">Unverified</span>'}
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);">
              ${Utils.escapeHtml(account.host || 'smtp.example.com')}:${account.port || 587}
              ${account.from_name ? ` · ${Utils.escapeHtml(account.from_name)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn btn-secondary btn-sm" onclick="Settings.testSmtp('${account.id}')">🧪 Test</button>
            <button class="btn btn-ghost btn-sm" onclick="Settings.editSmtp('${account.id}')">✏️</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger-light);" onclick="Settings.deleteSmtp('${account.id}')">🗑</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function setupSmtpForm() {
    const form = document.getElementById('smtpForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const providerEl = document.getElementById('smtpProvider');
      const email = document.getElementById('smtpEmail').value.trim();
      const password = document.getElementById('smtpPassword').value;
      const host = document.getElementById('smtpHost').value.trim();
      const port = parseInt(document.getElementById('smtpPort').value) || 587;

      // Use provider dropdown if present, otherwise infer from email domain
      let provider = providerEl ? providerEl.value : 'other';
      if (provider === 'custom' || !providerEl) {
        if (email.includes('@gmail.com')) provider = 'gmail';
        else if (email.includes('@outlook.com') || email.includes('@hotmail.com') || email.includes('@live.com')) provider = 'outlook';
        else provider = 'custom';
      }

      const data = {
        provider,
        email,
        password,
      };
      if (provider === 'custom' && host) data.host = host;
      if (provider === 'custom' && port) data.port = port;

      const dailyLimitEl = document.getElementById('smtpDailyLimit');
      if (dailyLimitEl && dailyLimitEl.value) {
        data.daily_limit = parseInt(dailyLimitEl.value);
      }

      if (!email || !password) {
        Toast.warning('Please fill in all required fields.');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const editId = document.getElementById('smtpEditId').value;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving...';

      try {
        if (editId) {
          await API.settings.smtp.update(editId, data);
          Toast.success('SMTP account updated!');
        } else {
          await API.settings.smtp.add(data);
          Toast.success('SMTP account added!');
        }
        form.reset();
        document.getElementById('smtpEditId').value = '';
        Modal.close('smtpModal');
        await loadSmtpAccounts();
      } catch (err) {
        Toast.error(err.message || 'Failed to save SMTP account.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '💾 Save Account';
      }
    });
  }

  function editSmtp(id) {
    const account = smtpAccounts.find(a => a.id === id || a.id === parseInt(id));
    if (!account) return;

    document.getElementById('smtpEditId').value = account.id;
    const providerEl = document.getElementById('smtpProvider');
    if (providerEl) providerEl.value = account.provider || 'custom';
    document.getElementById('smtpEmail').value = account.email || '';
    document.getElementById('smtpPassword').value = '';
    document.getElementById('smtpHost').value = account.host || '';
    document.getElementById('smtpPort').value = account.port || 587;
    const dailyLimitEl = document.getElementById('smtpDailyLimit');
    if (dailyLimitEl) dailyLimitEl.value = account.daily_limit || 500;
    // Toggle custom fields visibility
    const customFields = document.getElementById('smtpCustomFields');
    if (customFields) customFields.style.display = (account.provider === 'custom') ? 'block' : 'none';
    document.getElementById('smtpModalTitle').textContent = '✏️ Edit SMTP Account';

    Modal.open('smtpModal');
  }

  function openAddSmtp() {
    document.getElementById('smtpForm').reset();
    document.getElementById('smtpEditId').value = '';
    document.getElementById('smtpModalTitle').textContent = '📧 Add SMTP Account';
    Modal.open('smtpModal');
  }

  async function testSmtp(id) {
    Toast.info('Testing SMTP connection...');
    try {
      await API.settings.smtp.test(id);
      Toast.success('SMTP connection successful!');
    } catch (err) {
      Toast.error(err.message || 'SMTP test failed.');
    }
  }

  async function deleteSmtp(id) {
    if (!confirm('Delete this SMTP account?')) return;
    try {
      await API.settings.smtp.delete(id);
      Toast.success('SMTP account deleted.');
      await loadSmtpAccounts();
    } catch (err) {
      Toast.error(err.message || 'Failed to delete SMTP account.');
    }
  }

  // ---- Groq Keys ----
  async function loadGroqKeys() {
    const container = document.getElementById('groqKeysList');
    if (!container) return;

    try {
      const result = await API.settings.groq.list();
      const data = result.data || result;
      groqKeys = data.keys || (Array.isArray(data) ? data : []);
      renderGroqKeys();
    } catch {
      groqKeys = [];
      renderGroqKeys();
    }
  }

  function renderGroqKeys() {
    const container = document.getElementById('groqKeysList');
    if (!container) return;

    if (groqKeys.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔑</div>
          <h3>No API keys</h3>
          <p>Add a Groq API key to enable AI-powered email generation and lead analysis.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = groqKeys.map(key => `
      <div class="glass-card-static p-4 mb-3" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:0.15rem;">
            ${Utils.escapeHtml(key.name || key.label || 'API Key')}
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted);font-family:monospace;">
            ${key.key_preview || (key.api_key ? key.api_key.substring(0, 8) + '••••••••' : 'gsk_••••••••')}
          </div>
          <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.15rem;">
            Added ${Utils.formatDate(key.created_at)}
            ${key.is_active ? ' · <span style="color:var(--success);">Active</span>' : ' · <span style="color:var(--danger);">Inactive</span>'}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger-light);" onclick="Settings.deleteGroqKey('${key.id}')">🗑</button>
      </div>
    `).join('');
  }

  function setupGroqForm() {
    const form = document.getElementById('groqForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('groqKeyName').value.trim();
      const key = document.getElementById('groqKeyValue').value.trim();

      if (!key) {
        Toast.warning('Please enter an API key.');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Adding...';

      try {
        await API.settings.groq.add({ label: name || 'Default', api_key: key });
        Toast.success('Groq API key added!');
        form.reset();
        Modal.close('groqModal');
        await loadGroqKeys();
      } catch (err) {
        Toast.error(err.message || 'Failed to add API key.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔑 Add Key';
      }
    });
  }

  async function deleteGroqKey(id) {
    if (!confirm('Delete this API key?')) return;
    try {
      await API.settings.groq.delete(id);
      Toast.success('API key deleted.');
      await loadGroqKeys();
    } catch (err) {
      Toast.error(err.message || 'Failed to delete key.');
    }
  }

  // ---- General Settings ----
  async function loadGeneralSettings() {
    try {
      const result = await API.settings.get();
      const data = result.data || result;
      if (data) {
        const el = (id) => document.getElementById(id);
        if (el('settingProxyEnabled')) el('settingProxyEnabled').checked = data.proxy_enabled || false;
        if (el('settingProxyUrl')) el('settingProxyUrl').value = data.proxy_url || '';
        if (el('settingDailyLimit')) el('settingDailyLimit').value = data.daily_email_limit || 50;
        if (el('settingDelay')) el('settingDelay').value = data.email_delay_seconds || 30;
        if (el('settingFollowUp')) el('settingFollowUp').checked = data.auto_follow_up || false;
        if (el('settingFollowUpDays')) el('settingFollowUpDays').value = data.follow_up_days || 3;
        if (el('settingTimezone')) el('settingTimezone').value = data.timezone || 'UTC';

        if (data.services) {
          if (el('serviceGoogleMaps')) el('serviceGoogleMaps').checked = data.services.google_maps !== false;
          if (el('serviceWebScraper')) el('serviceWebScraper').checked = data.services.web_scraper !== false;
          if (el('serviceEmailFinder')) el('serviceEmailFinder').checked = data.services.email_finder !== false;
          if (el('serviceAIWriter')) el('serviceAIWriter').checked = data.services.ai_writer !== false;
        }
      }
    } catch {}
  }

  function setupGeneralForm() {
    const form = document.getElementById('generalSettingsForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const data = {
        proxy_enabled: document.getElementById('settingProxyEnabled')?.checked || false,
        proxy_url: document.getElementById('settingProxyUrl')?.value.trim() || '',
        daily_email_limit: parseInt(document.getElementById('settingDailyLimit')?.value) || 50,
        email_delay_seconds: parseInt(document.getElementById('settingDelay')?.value) || 30,
        auto_follow_up: document.getElementById('settingFollowUp')?.checked || false,
        follow_up_days: parseInt(document.getElementById('settingFollowUpDays')?.value) || 3,
        timezone: document.getElementById('settingTimezone')?.value || 'UTC',
        services: {
          google_maps: document.getElementById('serviceGoogleMaps')?.checked ?? true,
          web_scraper: document.getElementById('serviceWebScraper')?.checked ?? true,
          email_finder: document.getElementById('serviceEmailFinder')?.checked ?? true,
          ai_writer: document.getElementById('serviceAIWriter')?.checked ?? true,
        },
      };

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving...';

      try {
        await API.settings.update(data);
        Toast.success('Settings saved!');
      } catch (err) {
        Toast.error(err.message || 'Failed to save settings.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '💾 Save Settings';
      }
    });
  }

  return {
    init,
    testSmtp,
    editSmtp,
    deleteSmtp,
    openAddSmtp,
    deleteGroqKey,
  };
})();
