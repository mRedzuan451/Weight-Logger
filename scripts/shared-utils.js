'use strict';

window.WeightLoggerUtils = {
  getCurrentUser() {
    try {
      const raw = localStorage.getItem('current_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  redirectToLogin(returnPage) {
    const target = returnPage || (location.pathname.split('/').pop()) || 'menu.html';
    const ret = encodeURIComponent(target);
    window.location.href = `login.html?return=${ret}`;
  },

  ensureLoggedIn(returnPage) {
    const user = this.getCurrentUser();
    if (!user || !(user.name || user.username)) {
      this.redirectToLogin(returnPage);
      return false;
    }
    return true;
  },

  isAdmin(user) {
    return !!user && user.role === 'admin';
  },

  formatNumber(value, decimals = 2) {
    const n = Number(value);
    if (Number.isNaN(n)) return '';
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  safeParseArray(text) {
    try {
      const parsed = text ? JSON.parse(text) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
};
