'use strict';

const WeightLoggerUtils = {
  _uiReady: false,
  _overlayEl: null,
  _overlayMessageEl: null,
  _toastContainerEl: null,
  _errorBannerEl: null,
  _errorBannerMessageEl: null,
  _globalErrorHandlersInstalled: false,

  ensureUiShell() {
    if (WeightLoggerUtils._uiReady) return;
    const body = document.body;
    if (!body) return;

    const overlay = document.createElement('div');
    overlay.id = 'wl-global-loading';
    overlay.className = 'hidden fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm items-center justify-center px-4';
    overlay.innerHTML = '<div class="min-w-[220px] max-w-sm rounded-xl bg-white shadow-2xl px-5 py-4 flex items-center gap-3"><div class="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></div><p id="wl-global-loading-message" class="text-sm font-semibold text-gray-800">Loading...</p></div>';
    body.appendChild(overlay);

    const toastContainer = document.createElement('div');
    toastContainer.id = 'wl-toast-container';
    toastContainer.className = 'fixed top-4 right-4 z-[110] flex w-full max-w-sm flex-col gap-3 pointer-events-none';
    body.appendChild(toastContainer);

    const errorBanner = document.createElement('div');
    errorBanner.id = 'wl-error-banner';
    errorBanner.className = 'hidden fixed inset-x-4 top-4 z-[120] rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-lg';
    errorBanner.innerHTML = '<div class="flex items-start gap-3"><div class="mt-0.5 text-red-700 font-bold">!</div><div class="min-w-0 flex-1"><p class="text-sm font-semibold text-red-900">Unexpected error</p><p id="wl-error-banner-message" class="mt-1 text-sm text-red-800"></p></div><button id="wl-error-banner-dismiss" type="button" class="shrink-0 rounded-md bg-red-100 px-3 py-1 text-sm font-semibold text-red-800 hover:bg-red-200">Dismiss</button></div>';
    body.appendChild(errorBanner);

    WeightLoggerUtils._overlayEl = overlay;
    WeightLoggerUtils._overlayMessageEl = overlay.querySelector('#wl-global-loading-message');
    WeightLoggerUtils._toastContainerEl = toastContainer;
    WeightLoggerUtils._errorBannerEl = errorBanner;
    WeightLoggerUtils._errorBannerMessageEl = errorBanner.querySelector('#wl-error-banner-message');

    const dismissBtn = errorBanner.querySelector('#wl-error-banner-dismiss');
    dismissBtn?.addEventListener('click', () => WeightLoggerUtils.hideErrorBanner());

    WeightLoggerUtils._uiReady = true;
  },

  installGlobalErrorHandlers() {
    if (WeightLoggerUtils._globalErrorHandlersInstalled) return;
    WeightLoggerUtils._globalErrorHandlersInstalled = true;
    window.addEventListener('error', (event) => {
      const message = event?.error?.message || event?.message || 'Unexpected application error.';
      WeightLoggerUtils.hideLoading();
      WeightLoggerUtils.showErrorBanner(message);
      WeightLoggerUtils.toast(message, { type: 'error', duration: 6000 });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason;
      const message = reason?.message || (typeof reason === 'string' ? reason : 'Unexpected async error.');
      WeightLoggerUtils.hideLoading();
      WeightLoggerUtils.showErrorBanner(message);
      WeightLoggerUtils.toast(message, { type: 'error', duration: 6000 });
    });
  },

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
    const user = WeightLoggerUtils.getCurrentUser();
    if (!user || !(user.name || user.username)) {
      WeightLoggerUtils.redirectToLogin(returnPage);
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

  showLoading(message = 'Loading...') {
    WeightLoggerUtils.ensureUiShell();
    if (!WeightLoggerUtils._overlayEl || !WeightLoggerUtils._overlayMessageEl) return;
    WeightLoggerUtils._overlayMessageEl.textContent = message;
    WeightLoggerUtils._overlayEl.classList.remove('hidden');
    WeightLoggerUtils._overlayEl.classList.add('flex');
  },

  hideLoading() {
    if (!WeightLoggerUtils._overlayEl) return;
    WeightLoggerUtils._overlayEl.classList.add('hidden');
    WeightLoggerUtils._overlayEl.classList.remove('flex');
  },

  setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent || '';
      }
      button.disabled = true;
      button.textContent = loadingText || 'Loading...';
      button.classList.add('opacity-75', 'cursor-wait');
      return;
    }
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.classList.remove('opacity-75', 'cursor-wait');
  },

  toast(message, { type = 'info', duration = 3000 } = {}) {
    if (!message) return;
    WeightLoggerUtils.ensureUiShell();
    if (!WeightLoggerUtils._toastContainerEl) return;
    const toast = document.createElement('div');
    const styles = {
      success: 'border-green-200 bg-green-50 text-green-900',
      error: 'border-red-200 bg-red-50 text-red-900',
      info: 'border-blue-200 bg-blue-50 text-blue-900',
      loading: 'border-amber-200 bg-amber-50 text-amber-900',
    };
    toast.className = `pointer-events-auto overflow-hidden rounded-xl border px-4 py-3 shadow-lg transition-all ${styles[type] || styles.info}`;
    toast.innerHTML = `<p class="text-sm font-semibold">${message}</p>`;
    WeightLoggerUtils._toastContainerEl.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-x-2');
      window.setTimeout(() => toast.remove(), 180);
    }, Math.max(duration, 1200));
  },

  showErrorBanner(message) {
    WeightLoggerUtils.ensureUiShell();
    if (!WeightLoggerUtils._errorBannerEl || !WeightLoggerUtils._errorBannerMessageEl) return;
    WeightLoggerUtils._errorBannerMessageEl.textContent = message || 'Unexpected application error.';
    WeightLoggerUtils._errorBannerEl.classList.remove('hidden');
  },

  hideErrorBanner() {
    if (!WeightLoggerUtils._errorBannerEl) return;
    WeightLoggerUtils._errorBannerEl.classList.add('hidden');
  },

  async runAsync(task, options = {}) {
    const {
      loadingMessage,
      successMessage,
      errorMessage,
      errorToast = true,
      successToast = true,
      button,
      buttonLoadingText,
    } = options;

    if (button) WeightLoggerUtils.setButtonLoading(button, true, buttonLoadingText);
    if (loadingMessage) WeightLoggerUtils.showLoading(loadingMessage);
    try {
      const result = await task();
      if (successMessage && successToast) {
        WeightLoggerUtils.toast(successMessage, { type: 'success' });
      }
      return result;
    } catch (error) {
      const message = error?.message || errorMessage || 'Unexpected error.';
      if (errorToast) {
        WeightLoggerUtils.toast(errorMessage || message, { type: 'error', duration: 5000 });
      }
      throw error;
    } finally {
      if (loadingMessage) WeightLoggerUtils.hideLoading();
      if (button) WeightLoggerUtils.setButtonLoading(button, false);
    }
  },
};

window.WeightLoggerUtils = WeightLoggerUtils;
WeightLoggerUtils.ensureUiShell();
WeightLoggerUtils.installGlobalErrorHandlers();
