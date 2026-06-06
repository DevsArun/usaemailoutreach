/* ============================================
   LeadForge AI — Replies Module
   Inbox, AI classification, quick reply, thread
   ============================================ */

const Replies = (() => {
  let replies = [];
  let selectedReply = null;
  let currentFilter = 'all';

  async function init() {
    setupFilters();
    setupReplyForm();
    await loadReplies();
  }

  async function loadReplies() {
    const listContainer = document.getElementById('repliesList');
    if (listContainer) Skeleton.rows(listContainer, 5);

    try {
      const result = await API.replies.list();
      const data = result.data || result;
      replies = data.replies || (Array.isArray(data) ? data : []);
      renderList(replies);
      updateStats(replies);
    } catch {
      replies = [];
      renderList([]);
      updateStats([]);
    }
  }

  function updateStats(list) {
    const totalEl = document.getElementById('totalReplies');
    const unreadEl = document.getElementById('unreadCount');
    const interestedEl = document.getElementById('interestedCount');
    const needsActionEl = document.getElementById('needsActionCount');

    if (totalEl) totalEl.textContent = list.length;
    if (unreadEl) unreadEl.textContent = list.filter(r => !r.read).length;
    if (interestedEl) interestedEl.textContent = list.filter(r => (r.classification || '').toLowerCase() === 'interested' || (r.classification || '').toLowerCase() === 'positive').length;
    if (needsActionEl) needsActionEl.textContent = list.filter(r => !r.responded).length;
  }

  function renderList(list) {
    const container = document.getElementById('repliesList');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <h3>No replies yet</h3>
          <p>When leads respond to your outreach emails, their replies will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(reply => {
      const classification = (reply.classification || 'unclassified').toLowerCase();
      const classColors = {
        interested: 'success', positive: 'success',
        not_interested: 'danger', negative: 'danger',
        out_of_office: 'warning', ooo: 'warning',
        question: 'primary',
        unsubscribe: 'danger',
        unclassified: 'neutral',
      };
      const color = classColors[classification] || 'neutral';
      const initials = (reply.sender || reply.from_email || 'U').substring(0, 2).toUpperCase();
      const isSelected = selectedReply && selectedReply.id === reply.id;

      return `
        <div class="reply-item ${reply.read ? '' : 'unread'} ${isSelected ? 'active' : ''}"
             onclick="Replies.selectReply('${reply.id}')"
             style="${isSelected ? 'background:rgba(22,163,74,0.06);' : ''}">
          <div class="reply-avatar">${initials}</div>
          <div class="reply-content">
            <div class="reply-header">
              <span class="reply-sender">${Utils.escapeHtml(reply.sender || reply.from_email || 'Unknown')}</span>
              <span class="reply-time">${Utils.timeAgo(reply.received_at || reply.created_at)}</span>
            </div>
            <div class="reply-subject">${Utils.escapeHtml(reply.subject || 'No Subject')}</div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem;">
              <span class="badge badge-${color}" style="text-transform:capitalize;">${classification.replace(/_/g, ' ')}</span>
              ${reply.responded ? '<span style="font-size:0.65rem;color:var(--success);">✓ Responded</span>' : ''}
            </div>
            <div class="reply-snippet">${Utils.escapeHtml(Utils.truncate(reply.body || reply.content || '', 80))}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function selectReply(id) {
    selectedReply = replies.find(r => r.id === id || r.id === parseInt(id));
    if (!selectedReply) return;

    renderList(currentFilter === 'all' ? replies : replies.filter(r => matchesFilter(r)));
    renderDetail(selectedReply);
  }

  function renderDetail(reply) {
    const detail = document.getElementById('replyDetail');
    if (!detail) return;

    const classification = (reply.classification || 'unclassified').toLowerCase();
    const classColors = {
      interested: 'success', positive: 'success',
      not_interested: 'danger', negative: 'danger',
      out_of_office: 'warning', ooo: 'warning',
      question: 'primary',
      unsubscribe: 'danger',
      unclassified: 'neutral',
    };
    const color = classColors[classification] || 'neutral';

    detail.innerHTML = `
      <div style="padding:1.25rem;border-bottom:1px solid var(--border-glass);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:0.5rem;">
          <div>
            <h3 style="font-size:1rem;font-weight:700;margin-bottom:0.25rem;">${Utils.escapeHtml(reply.subject || 'No Subject')}</h3>
            <div style="font-size:0.8rem;color:var(--text-muted);">
              From: <strong style="color:var(--text-secondary);">${Utils.escapeHtml(reply.sender || reply.from_email || 'Unknown')}</strong>
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.15rem;">
              ${Utils.formatDateTime(reply.received_at || reply.created_at)}
            </div>
          </div>
          <span class="badge badge-${color}" style="text-transform:capitalize;font-size:0.75rem;">${classification.replace(/_/g, ' ')}</span>
        </div>
      </div>

      <div style="padding:1.25rem;min-height:200px;">
        <div style="font-size:0.85rem;line-height:1.7;color:var(--text-secondary);white-space:pre-wrap;">${Utils.escapeHtml(reply.body || reply.content || 'No content')}</div>
      </div>

      ${reply.ai_summary ? `
      <div style="padding:0 1.25rem 1rem;">
        <div style="background:rgba(22,163,74,0.06);border:1px solid rgba(22,163,74,0.15);border-radius:0.75rem;padding:0.85rem;">
          <div style="font-size:0.72rem;font-weight:600;color:var(--primary-light);margin-bottom:0.25rem;">🤖 AI Analysis</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);">${Utils.escapeHtml(reply.ai_summary)}</div>
        </div>
      </div>` : ''}

      <div style="padding:1rem 1.25rem;border-top:1px solid var(--border-glass);">
        <div style="font-size:0.78rem;font-weight:600;margin-bottom:0.5rem;">Quick Reply</div>
        <form id="quickReplyForm" onsubmit="Replies.sendReply(event, '${reply.id}')">
          <textarea id="quickReplyBody" class="form-textarea" rows="4" placeholder="Type your reply..." style="margin-bottom:0.5rem;" required></textarea>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="Replies.insertTemplate('interested')">💚 Interested</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="Replies.insertTemplate('followup')">📋 Follow-up</button>
            <button type="submit" class="btn btn-primary btn-sm">📤 Send Reply</button>
          </div>
        </form>
      </div>
    `;

    detail.style.display = 'block';
  }

  async function sendReply(e, id) {
    e.preventDefault();
    const body = document.getElementById('quickReplyBody').value.trim();
    if (!body) {
      Toast.warning('Please type a reply.');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending...';

    try {
      await API.replies.respond(id, body);
      Toast.success('Reply sent!');
      document.getElementById('quickReplyBody').value = '';
      await loadReplies();
    } catch (err) {
      Toast.error(err.message || 'Failed to send reply.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '📤 Send Reply';
    }
  }

  function insertTemplate(type) {
    const textarea = document.getElementById('quickReplyBody');
    if (!textarea) return;

    const templates = {
      interested: `Thank you for your interest! I'd love to schedule a quick call to discuss how we can help your business. What time works best for you this week?`,
      followup: `Just following up on my previous message. I believe we can provide significant value to your business. Would you be open to a brief 15-minute call?`,
    };

    textarea.value = templates[type] || '';
    textarea.focus();
  }

  function setupFilters() {
    const tabs = document.querySelectorAll('#replyTabs .tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;

        let filtered = [...replies];
        if (currentFilter !== 'all') {
          filtered = filtered.filter(r => matchesFilter(r));
        }
        renderList(filtered);
      });
    });

    const searchInput = document.getElementById('replySearch');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        const q = e.target.value.toLowerCase();
        let filtered = [...replies];
        if (currentFilter !== 'all') {
          filtered = filtered.filter(r => matchesFilter(r));
        }
        if (q) {
          filtered = filtered.filter(r =>
            (r.sender || r.from_email || '').toLowerCase().includes(q) ||
            (r.subject || '').toLowerCase().includes(q) ||
            (r.body || r.content || '').toLowerCase().includes(q)
          );
        }
        renderList(filtered);
      }, 300));
    }
  }

  function matchesFilter(reply) {
    const c = (reply.classification || '').toLowerCase();
    if (currentFilter === 'interested') return c === 'interested' || c === 'positive';
    if (currentFilter === 'not_interested') return c === 'not_interested' || c === 'negative';
    if (currentFilter === 'question') return c === 'question';
    if (currentFilter === 'unread') return !reply.read;
    return true;
  }

  function setupReplyForm() {
    // Quick reply form is set up dynamically in renderDetail
  }

  return { init, selectReply, sendReply, insertTemplate, loadReplies };
})();
