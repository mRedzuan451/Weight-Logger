'use strict';

const LOGIN_HISTORY_KEY = 'login_history';
const USER_ACCOUNTS_KEY = 'user_accounts';
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

function loadUsers() {
  try {
    const raw = localStorage.getItem(USER_ACCOUNTS_KEY);
    const users = raw ? JSON.parse(raw) : [];
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  if (!Array.isArray(users)) return;
  localStorage.setItem(USER_ACCOUNTS_KEY, JSON.stringify(users));
}

function makePasswordHash(username, password) {
  // Simple obfuscation, not real security, but better than plain text for this offline tool.
  try {
    return btoa(`${username}:${password}`);
  } catch {
    return `${username}:${password}`;
  }
}

function ensureDefaultAdmin() {
  let users = loadUsers();
  const hasAdmin = users.some(u => u && u.username === 'admin');
  if (!hasAdmin) {
    users.push({
      username: 'admin',
      displayName: 'Administrator',
      role: 'admin',
      active: true,
      passwordHash: makePasswordHash('admin', 'admin123'),
    });
    saveUsers(users);
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
  const username = (user?.username || '').trim();
  const displayName = (user?.displayName || username || '').trim();
  const role = user?.role || 'user';
  const employeeId = (user?.employeeId || username || '').trim();

  const payload = {
    username,
    displayName,
    role,
    // keep legacy fields so older pages using name/employeeId still work
    name: username,
    employeeId,
    at: new Date().toISOString(),
  };

  localStorage.setItem('current_user', JSON.stringify(payload));

  recordLoginHistory({
    username,
    displayName,
    employeeId,
    role,
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
  ensureDefaultAdmin();

  const form = document.getElementById('login-form');
  if (!form) return;

  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const error = document.getElementById('error');

  function clearErrorState() {
    if (error) {
      error.classList.add('hidden');
      error.textContent = '';
    }
    if (usernameInput) {
      usernameInput.classList.remove('border-red-500', 'ring-red-300');
    }
    if (passwordInput) {
      passwordInput.classList.remove('border-red-500', 'ring-red-300');
    }
  }

  if (usernameInput) {
    usernameInput.addEventListener('input', clearErrorState);
  }
  if (passwordInput) {
    passwordInput.addEventListener('input', clearErrorState);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    const error = document.getElementById('error');
    if (error) {
      error.classList.add('hidden');
      error.textContent = '';
    }
    usernameInput.classList.remove('border-red-500', 'ring-red-300');
    passwordInput.classList.remove('border-red-500', 'ring-red-300');

    if (!username || !password) {
      if (error) {
        error.textContent = 'Please enter both username and password.';
        error.classList.remove('hidden');
      } else {
        alert('Please enter both username and password.');
      }
      if (!username) {
        usernameInput.classList.add('border-red-500', 'ring-red-300');
      }
      if (!password) {
        passwordInput.classList.add('border-red-500', 'ring-red-300');
      }
      return;
    }

    const users = loadUsers();
    const user = users.find(u => u && u.username === username && u.active !== false);
    if (!user) {
      if (error) {
        error.textContent = 'Invalid username or password.';
        error.classList.remove('hidden');
      } else {
        alert('Invalid username or password.');
      }
      usernameInput.classList.add('border-red-500', 'ring-red-300');
      passwordInput.classList.add('border-red-500', 'ring-red-300');
      return;
    }

    const expectedHash = user.passwordHash;
    const actualHash = makePasswordHash(username, password);
    if (!expectedHash || expectedHash !== actualHash) {
      if (error) {
        error.textContent = 'Invalid username or password.';
        error.classList.remove('hidden');
      } else {
        alert('Invalid username or password.');
      }
      usernameInput.classList.add('border-red-500', 'ring-red-300');
      passwordInput.classList.add('border-red-500', 'ring-red-300');
      return;
    }

    setCurrentUser({ username: user.username, displayName: user.displayName, employeeId: user.employeeId, role: user.role });
    window.location.href = getReturnUrl();
  });
});
