/* ============================================
   LeadForge AI — Pipeline Module
   Kanban drag-and-drop, stage mgmt, card render
   ============================================ */

const Pipeline = (() => {
  const STAGES = [
    { key: 'discovered', label: 'Discovered', icon: '🔍', color: '#94a3b8' },
    { key: 'analyzed', label: 'Analyzed', icon: '📊', color: '#059669' },
    { key: 'email_sent', label: 'Email Sent', icon: '✉️', color: '#16a34a' },
    { key: 'opened', label: 'Opened', icon: '👁', color: '#22c55e' },
    { key: 'replied', label: 'Replied', icon: '💬', color: '#3b82f6' },
    { key: 'interested', label: 'Interested', icon: '💚', color: '#10b981' },
    { key: 'meeting_scheduled', label: 'Meeting Scheduled', icon: '📅', color: '#14b8a6' },
    { key: 'proposal_sent', label: 'Proposal Sent', icon: '📄', color: '#f59e0b' },
    { key: 'won', label: 'Won', icon: '🏆', color: '#22c55e' },
    { key: 'lost', label: 'Lost', icon: '❌', color: '#ef4444' },
  ];

  let pipelineData = {};
  let draggedItem = null;

  async function init() {
    renderBoard();
    setupCampaignFilter();
    await loadPipeline();
  }

  function renderBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    board.innerHTML = STAGES.map(stage => `
      <div class="kanban-column" data-stage="${stage.key}">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <span>${stage.icon}</span>
            <span>${stage.label}</span>
          </div>
          <span class="kanban-column-count" id="count-${stage.key}">0</span>
        </div>
        <div class="kanban-column-body" id="stage-${stage.key}"
             ondragover="Pipeline.handleDragOver(event)"
             ondrop="Pipeline.handleDrop(event, '${stage.key}')"
             ondragleave="Pipeline.handleDragLeave(event)">
          <!-- Cards populated by JS -->
        </div>
      </div>
    `).join('');
  }

  async function loadPipeline() {
    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get('campaign_id') || document.getElementById('pipelineCampaignFilter')?.value;

    try {
      const result = await API.pipeline.list(campaignId || null);
      const data = result.data || result;
      pipelineData = data.pipeline || data;
      renderCards();
      updateTotalStats();
    } catch {
      pipelineData = {};
      renderCards();
      updateTotalStats();
    }
  }

  function renderCards() {
    STAGES.forEach(stage => {
      const container = document.getElementById(`stage-${stage.key}`);
      const countEl = document.getElementById(`count-${stage.key}`);
      if (!container) return;

      const items = Array.isArray(pipelineData[stage.key]) ? pipelineData[stage.key] : [];

      if (countEl) countEl.textContent = items.length;

      if (items.length === 0) {
        container.innerHTML = `<div style="padding:1rem;text-align:center;font-size:0.72rem;color:var(--text-muted);opacity:0.5;">No items</div>`;
        return;
      }

      container.innerHTML = items.map(item => {
        const score = item.lead_score || 0;
        const scoreColor = Utils.getScoreColor(score);
        return `
          <div class="kanban-card" draggable="true"
               data-item-id="${item.id}"
               ondragstart="Pipeline.handleDragStart(event, '${item.id}')"
               ondragend="Pipeline.handleDragEnd(event)">
            <div class="kanban-card-title">${Utils.escapeHtml(item.name || item.business_name || 'Unknown')}</div>
            <div class="kanban-card-meta">
              ${item.location ? `<span>📍 ${Utils.truncate(item.location, 20)}</span>` : ''}
              ${score > 0 ? `<span class="badge badge-${scoreColor}" style="font-size:0.6rem;">${score}</span>` : ''}
            </div>
            ${item.notes ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.35rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${Utils.escapeHtml(Utils.truncate(item.notes, 60))}</div>` : ''}
            <div style="display:flex;gap:0.35rem;margin-top:0.5rem;">
              <button class="btn btn-ghost btn-sm" style="padding:2px 5px;font-size:0.65rem;" onclick="Pipeline.editCard('${item.id}')" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm" style="padding:2px 5px;font-size:0.65rem;" onclick="Pipeline.viewLead('${item.id}')" title="View">👁</button>
            </div>
          </div>
        `;
      }).join('');
    });
  }

  function updateTotalStats() {
    const totalEl = document.getElementById('pipelineTotal');
    const activeEl = document.getElementById('pipelineActive');
    const wonEl = document.getElementById('pipelineWon');
    const lostEl = document.getElementById('pipelineLost');

    // Collect all items from pipelineData object
    const allItems = [];
    STAGES.forEach(stage => {
      const items = Array.isArray(pipelineData[stage.key]) ? pipelineData[stage.key] : [];
      allItems.push(...items);
    });

    if (totalEl) totalEl.textContent = allItems.length;
    if (activeEl) {
      const active = allItems.length - (pipelineData.won || []).length - (pipelineData.lost || []).length;
      activeEl.textContent = active;
    }
    if (wonEl) wonEl.textContent = (pipelineData.won || []).length;
    if (lostEl) lostEl.textContent = (pipelineData.lost || []).length;
  }

  function setupCampaignFilter() {
    const select = document.getElementById('pipelineCampaignFilter');
    if (!select) return;

    loadCampaignOptions(select);
    select.addEventListener('change', () => loadPipeline());
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

  // ---- Drag & Drop ----
  function handleDragStart(e, itemId) {
    draggedItem = itemId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
    setTimeout(() => {
      e.target.classList.add('dragging');
    }, 0);
  }

  function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedItem = null;
    document.querySelectorAll('.kanban-column-body').forEach(col => col.classList.remove('drag-over'));
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  async function handleDrop(e, newStage) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    const itemId = e.dataTransfer.getData('text/plain') || draggedItem;
    if (!itemId) return;

    const item = findItemInPipeline(itemId);
    if (!item) return;

    const oldStage = item.stage || item.pipeline_stage;
    if (oldStage === newStage) return;

    // Move item between stages in pipelineData
    if (Array.isArray(pipelineData[oldStage])) {
      pipelineData[oldStage] = pipelineData[oldStage].filter(i => (i.id !== item.id));
    }
    item.stage = newStage;
    item.pipeline_stage = newStage;
    if (!Array.isArray(pipelineData[newStage])) pipelineData[newStage] = [];
    pipelineData[newStage].push(item);

    renderCards();
    updateTotalStats();

    try {
      await API.pipeline.update(itemId, { stage: newStage });
      Toast.success(`Moved to ${newStage.replace(/_/g, ' ')}`);
    } catch (err) {
      // Revert: move item back
      if (Array.isArray(pipelineData[newStage])) {
        pipelineData[newStage] = pipelineData[newStage].filter(i => i.id !== item.id);
      }
      item.stage = oldStage;
      item.pipeline_stage = oldStage;
      if (!Array.isArray(pipelineData[oldStage])) pipelineData[oldStage] = [];
      pipelineData[oldStage].push(item);
      renderCards();
      Toast.error(err.message || 'Failed to update stage.');
    }
  }

  function findItemInPipeline(id) {
    for (const stage of STAGES) {
      const items = Array.isArray(pipelineData[stage.key]) ? pipelineData[stage.key] : [];
      const found = items.find(i => i.id === id || i.id === parseInt(id));
      if (found) return found;
    }
    return null;
  }

  function editCard(id) {
    const item = findItemInPipeline(id);
    if (!item) return;

    document.getElementById('editCardId').value = item.id;
    document.getElementById('editCardName').textContent = item.name || item.business_name || 'Unknown';
    document.getElementById('editCardStage').value = item.stage || item.pipeline_stage || 'discovered';
    document.getElementById('editCardNotes').value = item.notes || '';

    Modal.open('editCardModal');
  }

  function viewLead(id) {
    window.location.href = `leads.html?highlight=${id}`;
  }

  function setupEditForm() {
    const form = document.getElementById('editCardForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editCardId').value;
      const stage = document.getElementById('editCardStage').value;
      const notes = document.getElementById('editCardNotes').value.trim();

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving...';

      try {
        await API.pipeline.update(id, { stage, notes });
        Toast.success('Card updated!');
        Modal.close('editCardModal');
        await loadPipeline();
      } catch (err) {
        Toast.error(err.message || 'Failed to update card.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '💾 Save';
      }
    });
  }

  return {
    init,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    editCard,
    viewLead,
    loadPipeline,
    setupEditForm,
  };
})();
