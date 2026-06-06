/* ============================================
   LeadForge AI — Auth Module
   Login/Register/Logout, token mgmt, redirects
   ============================================ */

const Auth = (() => {
  const LOGIN_PAGE = 'index.html';
  const DASHBOARD_PAGE = 'dashboard.html';
  const PROTECTED_PAGES = [
    'dashboard.html', 'campaigns.html', 'leads.html',
    'outreach.html', 'replies.html', 'pipeline.html',
    'analytics.html', 'settings.html',
  ];

  function getCurrentPage() {
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html';
    return page;
  }

  function isAuthenticated() {
    return !!API.getToken();
  }

  function getUser() {
    try {
      const user = localStorage.getItem('leadforge_user');
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  }

  function setUser(user) {
    localStorage.setItem('leadforge_user', JSON.stringify(user));
  }

  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = LOGIN_PAGE;
      return false;
    }
    return true;
  }

  function redirectIfLoggedIn() {
    if (isAuthenticated()) {
      window.location.href = DASHBOARD_PAGE;
    }
  }

  function initAuthPage() {
    redirectIfLoggedIn();

    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginTab && registerTab) {
      loginTab.addEventListener('click', () => {
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        clearErrors();
      });

      registerTab.addEventListener('click', () => {
        registerTab.classList.add('active');
        loginTab.classList.remove('active');
        registerForm.style.display = 'block';
        loginForm.style.display = 'none';
        clearErrors();
      });
    }

    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }
    if (registerForm) {
      registerForm.addEventListener('submit', handleRegister);
    }
  }

  function clearErrors() {
    document.querySelectorAll('.form-error').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
    const authError = document.getElementById('authError');
    if (authError) {
      authError.style.display = 'none';
      authError.textContent = '';
    }
  }

  function showAuthError(message) {
    const authError = document.getElementById('authError');
    if (authError) {
      authError.textContent = message;
      authError.style.display = 'block';
    }
  }

  function setButtonLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span> Please wait...';
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || 'Submit';
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    clearErrors();

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');

    if (!email || !password) {
      showAuthError('Please fill in all fields.');
      return;
    }

    setButtonLoading(btn, true);

    try {
      const result = await API.auth.login({ email, password });

      if (result.data && result.data.user) {
        setUser(result.data.user);
      } else {
        setUser({ email, name: email.split('@')[0] });
      }

      window.location.href = DASHBOARD_PAGE;
    } catch (err) {
      showAuthError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    clearErrors();

    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    const btn = document.getElementById('registerBtn');

    if (!name || !email || !password || !confirmPassword) {
      showAuthError('Please fill in all fields.');
      return;
    }

    if (password.length < 8) {
      showAuthError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      showAuthError('Passwords do not match.');
      return;
    }

    setButtonLoading(btn, true);

    try {
      const result = await API.auth.register({ name, email, password });

      if (result.data && result.data.user) {
        setUser(result.data.user);
      } else {
        setUser({ email, name });
      }

      window.location.href = DASHBOARD_PAGE;
    } catch (err) {
      showAuthError(err.message || 'Registration failed. Please try again.');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function logout() {
    API.auth.logout();
  }

  async function fetchCurrentUser() {
    try {
      const result = await API.auth.me();
      const user = result.data ? result.data.user : result;
      setUser(user);
      return user;
    } catch {
      return getUser();
    }
  }

  return {
    isAuthenticated,
    getUser,
    setUser,
    requireAuth,
    redirectIfLoggedIn,
    initAuthPage,
    logout,
    fetchCurrentUser,
  };
})();
