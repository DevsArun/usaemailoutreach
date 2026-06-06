/* ============================================
   LeadForge AI — App Module
   Sidebar, nav, user menu, notifications, toast
   ============================================ */

/* ---------- Toast System ---------- */
const Toast = (() => {
  let container = null;

  function ensureContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(type, title, message, duration = 4000) {
    const cont = ensureContainer();
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ'}</span>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-dismiss" onclick="this.closest('.toast').remove()">✕</button>
    `;
    cont.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    return toast;
  }

  return {
    success: (msg, title = 'Success') => show('success', title, msg),
    error: (msg, title = 'Error') => show('error', title, msg),
    warning: (msg, title = 'Warning') => show('warning', title, msg),
    info: (msg, title = 'Info') => show('info', title, msg),
  };
})();

/* ---------- Modal Utility ---------- */
const Modal = (() => {
  function open(id) {
    const overlay = document.getElementById(id);
    if (overlay) {
      overlay.classList.add('active');
      document.body.classList.add('no-scroll');
    }
  }

  function close(id) {
    const overlay = document.getElementById(id);
    if (overlay) {
      overlay.classList.remove('active');
      document.body.classList.remove('no-scroll');
    }
  }

  function init() {
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
        document.body.classList.remove('no-scroll');
      }
      if (e.target.classList.contains('modal-close') || e.target.closest('.modal-close')) {
        const overlay = e.target.closest('.modal-overlay');
        if (overlay) {
          overlay.classList.remove('active');
          document.body.classList.remove('no-scroll');
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach((overlay) => {
          overlay.classList.remove('active');
        });
        document.body.classList.remove('no-scroll');
      }
    });
  }

  return { open, close, init };
})();

/* ---------- Sidebar ---------- */
const Sidebar = (() => {
  let collapsed = false;

  function init() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (toggle) {
      toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        sidebar.classList.toggle('collapsed', collapsed);
        mainContent.classList.toggle('sidebar-collapsed', collapsed);
        toggle.innerHTML = collapsed ? '→' : '←';
        localStorage.setItem('sidebar_collapsed', collapsed);
      });

      const savedState = localStorage.getItem('sidebar_collapsed');
      if (savedState === 'true') {
        collapsed = true;
        sidebar.classList.add('collapsed');
        mainContent.classList.add('sidebar-collapsed');
        toggle.innerHTML = '→';
      }
    }

    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
        sidebarOverlay.classList.toggle('show');
      });
    }

    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        sidebarOverlay.classList.remove('show');
      });
    }

    highlightActiveNav();
    setupUserMenu();
  }

  function highlightActiveNav() {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.nav-item[data-page]').forEach((item) => {
      if (item.dataset.page === currentPage) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  function setupUserMenu() {
    const user = Auth.getUser();
    const userName = document.getElementById('sidebarUserName');
    const userEmail = document.getElementById('sidebarUserEmail');
    const userAvatar = document.getElementById('sidebarUserAvatar');

    if (user) {
      if (userName) userName.textContent = user.name || 'User';
      if (userEmail) userEmail.textContent = user.email || '';
      if (userAvatar) {
        const initials = (user.name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
        userAvatar.textContent = initials;
      }
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        Auth.logout();
      });
    }
  }

  return { init };
})();

/* ---------- Dropdown Handler ---------- */
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-dropdown]');
  if (trigger) {
    const menuId = trigger.dataset.dropdown;
    const menu = document.getElementById(menuId);
    if (menu) {
      document.querySelectorAll('.dropdown-menu.show').forEach(m => {
        if (m !== menu) m.classList.remove('show');
      });
      menu.classList.toggle('show');
    }
    e.stopPropagation();
    return;
  }
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
});

/* ---------- Skeleton Loader ---------- */
const Skeleton = {
  cards(container, count = 4) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="skeleton skeleton-card" style="height:120px;"></div>';
    }
    container.innerHTML = html;
  },
  rows(container, count = 6) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div style="display:flex;gap:1rem;padding:0.75rem 0;">
          <div class="skeleton skeleton-avatar"></div>
          <div style="flex:1">
            <div class="skeleton skeleton-text" style="width:${60 + Math.random() * 30}%"></div>
            <div class="skeleton skeleton-text short"></div>
          </div>
        </div>`;
    }
    container.innerHTML = html;
  },
  text(container, lines = 4) {
    let html = '';
    for (let i = 0; i < lines; i++) {
      const w = i === 0 ? 'width:40%' : `width:${50 + Math.random() * 40}%`;
      html += `<div class="skeleton skeleton-text" style="${w}"></div>`;
    }
    container.innerHTML = html;
  },
};

/* ---------- Utility Functions ---------- */
const Utils = {
  formatNumber(num) {
    if (num === null || num === undefined) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  },

  timeAgo(dateStr) {
    if (!dateStr) return '';
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return Utils.formatDate(dateStr);
  },

  truncate(str, len = 50) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '…' : str;
  },

  countUp(element, target, duration = 1200) {
    const start = 0;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(start + (target - start) * eased);
      element.textContent = Utils.formatNumber(current);
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = Utils.formatNumber(target);
      }
    }

    requestAnimationFrame(update);
  },

  debounce(func, wait = 300) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  },

  getStatusColor(status) {
    const map = {
      active: 'success', running: 'success', completed: 'success', won: 'success',
      approved: 'success', sent: 'success', opened: 'primary', interested: 'primary',
      paused: 'warning', pending: 'warning', draft: 'warning', scheduled: 'warning',
      stopped: 'danger', failed: 'danger', rejected: 'danger', lost: 'danger', bounced: 'danger',
      new: 'accent', discovered: 'accent', analyzed: 'accent',
    };
    return map[(status || '').toLowerCase()] || 'neutral';
  },

  getScoreColor(score) {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    return 'danger';
  },

  renderStars(rating, max = 5) {
    let html = '<span class="stars">';
    for (let i = 1; i <= max; i++) {
      html += `<span class="star ${i <= rating ? 'filled' : ''}">★</span>`;
    }
    html += '</span>';
    return html;
  },

  generateId() {
    return Math.random().toString(36).substring(2, 11);
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

/* ---------- App Init ---------- */
const App = {
  init() {
    if (!Auth.requireAuth()) return;
    Sidebar.init();
    Modal.init();
    Auth.fetchCurrentUser();
  },
};

/* ---------- Sidebar HTML Template ---------- */
function getSidebarHTML() {
  return `
    <button class="mobile-menu-btn" id="mobileMenuBtn">☰</button>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-toggle" id="sidebarToggle">←</div>
      <div class="sidebar-logo">
        <div class="logo-icon">⚡</div>
        <span class="logo-text">LeadForge AI</span>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section-title">Main</div>
        <a href="dashboard.html" class="nav-item" data-page="dashboard.html">
          <span class="nav-icon">📊</span>
          <span class="nav-label">Dashboard</span>
        </a>
        <a href="campaigns.html" class="nav-item" data-page="campaigns.html">
          <span class="nav-icon">🚀</span>
          <span class="nav-label">Campaigns</span>
        </a>
        <a href="leads.html" class="nav-item" data-page="leads.html">
          <span class="nav-icon">👥</span>
          <span class="nav-label">Leads</span>
        </a>

        <div class="nav-section-title">Engage</div>
        <a href="outreach.html" class="nav-item" data-page="outreach.html">
          <span class="nav-icon">✉️</span>
          <span class="nav-label">Outreach</span>
        </a>
        <a href="replies.html" class="nav-item" data-page="replies.html">
          <span class="nav-icon">💬</span>
          <span class="nav-label">Replies</span>
          <span class="nav-badge" id="replyBadge" style="display:none;">0</span>
        </a>
        <a href="pipeline.html" class="nav-item" data-page="pipeline.html">
          <span class="nav-icon">📈</span>
          <span class="nav-label">Pipeline</span>
        </a>

        <div class="nav-section-title">Insights</div>
        <a href="analytics.html" class="nav-item" data-page="analytics.html">
          <span class="nav-icon">📉</span>
          <span class="nav-label">Analytics</span>
        </a>
        <a href="settings.html" class="nav-item" data-page="settings.html">
          <span class="nav-icon">⚙️</span>
          <span class="nav-label">Settings</span>
        </a>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user" id="logoutBtn">
          <div class="user-avatar" id="sidebarUserAvatar">U</div>
          <div class="user-info">
            <div class="user-name" id="sidebarUserName">User</div>
            <div class="user-email" id="sidebarUserEmail">user@example.com</div>
          </div>
        </div>
      </div>
    </aside>`;
}
