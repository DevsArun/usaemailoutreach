/* ============================================
   LeadForge AI — API Client
   Fetch wrapper with JWT auth & base URL config
   ============================================ */

const API = (() => {
  const BASE_URL = window.location.origin;

  const API_PREFIX = '/api';

  function getToken() {
    return localStorage.getItem('leadforge_token');
  }

  function setToken(token) {
    localStorage.setItem('leadforge_token', token);
  }

  function removeToken() {
    localStorage.removeItem('leadforge_token');
  }

  function getHeaders(isJson = true) {
    const headers = {};
    if (isJson) {
      headers['Content-Type'] = 'application/json';
    }
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async function request(method, endpoint, body = null, options = {}) {
    const url = `${BASE_URL}${API_PREFIX}${endpoint}`;
    const config = {
      method,
      headers: getHeaders(options.isFormData ? false : true),
      ...options,
    };

    if (body && !options.isFormData) {
      config.body = JSON.stringify(body);
    } else if (body && options.isFormData) {
      config.body = body;
      delete config.headers['Content-Type'];
    }

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        removeToken();
        if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
          window.location.href = 'index.html';
        }
        throw new ApiError('Session expired. Please log in again.', 401);
      }

      if (response.status === 204) {
        return { success: true };
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new ApiError(
          data.detail || data.message || `Request failed with status ${response.status}`,
          response.status,
          data
        );
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new ApiError('Unable to connect to server. Please check your connection.', 0);
      }
      throw new ApiError(error.message || 'An unexpected error occurred.', 0);
    }
  }

  class ApiError extends Error {
    constructor(message, status, data = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }

  return {
    BASE_URL,
    getToken,
    setToken,
    removeToken,
    ApiError,

    get: (endpoint) => request('GET', endpoint),
    post: (endpoint, body) => request('POST', endpoint, body),
    put: (endpoint, body) => request('PUT', endpoint, body),
    patch: (endpoint, body) => request('PATCH', endpoint, body),
    delete: (endpoint) => request('DELETE', endpoint),

    auth: {
      register: async (data) => {
        const result = await request('POST', '/auth/register', data);
        if (result.data && result.data.token) {
          setToken(result.data.token);
          localStorage.setItem('leadforge_user', JSON.stringify(result.data.user));
        }
        return result;
      },
      login: async (data) => {
        const result = await request('POST', '/auth/login', data);
        if (result.data && result.data.token) {
          setToken(result.data.token);
          localStorage.setItem('leadforge_user', JSON.stringify(result.data.user));
        }
        return result;
      },
      me: () => request('GET', '/auth/me'),
      logout: () => {
        removeToken();
        localStorage.removeItem('leadforge_user');
        window.location.href = 'index.html';
      },
    },

    // ---- Campaigns ----
    campaigns: {
      list: () => request('GET', '/campaigns'),
      get: (id) => request('GET', `/campaigns/${id}`),
      create: (data) => request('POST', '/campaigns', data),
      start: (id) => request('PUT', `/campaigns/${id}/start`),
      pause: (id) => request('PUT', `/campaigns/${id}/pause`),
      stop: (id) => request('PUT', `/campaigns/${id}/stop`),
      reset: (id) => request('PUT', `/campaigns/${id}/reset`),
      delete: (id) => request('DELETE', `/campaigns/${id}`),
    },

    // ---- Businesses / Leads ----
    businesses: {
      list: (campaignId) => request('GET', campaignId ? `/businesses?campaign_id=${campaignId}` : '/businesses'),
      get: (id) => request('GET', `/businesses/${id}`),
      updateStage: (id, stage) => request('PUT', `/businesses/${id}/stage`, { stage }),
    },

    // ---- Outreach ----
    outreach: {
      list: (campaignId) => request('GET', campaignId ? `/outreach?campaign_id=${campaignId}` : '/outreach'),
      approve: (id) => request('POST', `/outreach/${id}/approve`),
      reject: (id) => request('POST', `/outreach/${id}/reject`),
      update: (id, data) => request('PUT', `/outreach/${id}`, data),
      send: (id) => request('POST', `/outreach/${id}/send`),
    },

    // ---- Replies ----
    replies: {
      list: () => request('GET', '/replies'),
      respond: (id, body) => request('POST', `/replies/${id}/respond`, { body }),
      sync: () => request('POST', '/replies/sync'),
    },

    // ---- Pipeline ----
    pipeline: {
      list: (campaignId) => request('GET', campaignId ? `/pipeline?campaign_id=${campaignId}` : '/pipeline'),
      update: (id, data) => request('PUT', `/pipeline/${id}`, data),
    },

    // ---- Analytics ----
    analytics: {
      overview: () => request('GET', '/analytics/overview'),
      detailed: (campaignId) => request('GET', campaignId ? `/analytics?campaign_id=${campaignId}` : '/analytics'),
    },

    // ---- Settings ----
    settings: {
      get: () => request('GET', '/settings'),
      update: (data) => request('PUT', '/settings', data),
      smtp: {
        list: () => request('GET', '/settings/smtp'),
        add: (data) => request('POST', '/settings/smtp', data),
        update: (id, data) => request('PUT', `/settings/smtp/${id}`, data),
        delete: (id) => request('DELETE', `/settings/smtp/${id}`),
        test: (id) => request('POST', `/settings/smtp/${id}/test`),
      },
      groq: {
        list: () => request('GET', '/settings/groq'),
        add: (data) => request('POST', '/settings/groq', data),
        delete: (id) => request('DELETE', `/settings/groq/${id}`),
      },
      services: {
        list: () => request('GET', '/settings/services'),
      },
    },
  };
})();
