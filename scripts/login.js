'use strict';

const LOGIN_HISTORY_KEY = 'login_history';
const MAX_HISTORY_DAYS = 60;
const MAX_HISTORY_MS = MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;

function pruneHistory(history) {
  if (!Array.isArray(history)) return [];
  const cutoff = Date.now() - MAX_HISTORY_MS;
  return history.filter(entry => {
    if (!entry || !entry.timestamp) return false;
    const time = new Date(entry.timestamp).getTime();
    return Number.isNaN(time) || time >= cutoff;
  });
}

function recordLoginHistory(entry) {
  try {
    const raw = localStorage.getItem(LOGIN_HISTORY_KEY);
    let history = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(history)) history = [];
    history.push(entry);
    const pruned = pruneHistory(history);
    localStorage.setItem(LOGIN_HISTORY_KEY, JSON.stringify(pruned));
  } catch (error) {
    console.warn('Unable to record login history:', error);
  }
}

function getReturnUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ret = params.get('return');
    if (ret) return decodeURIComponent(ret);
  } catch {}
  return 'menu.html';
}

function setCurrentUser(user) {
  const name = (user?.name || '').trim();
  const employeeId = (user?.employeeId || user?.username || '').trim();
  const displayName = name && employeeId ? `${name} (${employeeId})` : (name || employeeId);

  const payload = {
    name,
    employeeId,
    username: employeeId, // keep for backward compatibility
    displayName,
    at: new Date().toISOString(),
  };

  localStorage.setItem('current_user', JSON.stringify(payload));

  recordLoginHistory({
    name,
    employeeId,
    displayName,
    timestamp: payload.at,
  });
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('current_user')) || null;
  } catch {
    return null;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const nameInput = document.getElementById('name');
  const employeeIdInput = document.getElementById('employee-id');
  const error = document.getElementById('error');

  // If already logged in, go back to return URL
  const existing = getCurrentUser();
  if (existing && (existing.name || existing.username)) {
    window.location.href = getReturnUrl();
    return;
  }

  nameInput?.focus();

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (nameInput?.value || '').trim();
    const employeeId = (employeeIdInput?.value || '').trim();

    if (!name) {
      error.textContent = 'Please enter your full name.';
      error.classList.remove('hidden');
      nameInput?.focus();
      return;
    }
    if (!employeeId) {
      error.textContent = 'Please enter your employee ID.';
      error.classList.remove('hidden');
      employeeIdInput?.focus();
      return;
    }
    error.classList.add('hidden');

    setCurrentUser({ name, employeeId });
    window.location.href = getReturnUrl();
  });
});
