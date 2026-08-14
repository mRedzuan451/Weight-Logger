'use strict';

const { runAsync, setButtonLoading, toast } = window.WeightLoggerUtils;

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
  if (!Array.isArray(users)) return false;
  try {
    localStorage.setItem(USER_ACCOUNTS_KEY, JSON.stringify(users));
    return true;
  } catch {
    return false;
  }
}

function getAuthApi() {
  return window.electronAuth || null;
}

async function hashPassword(username, password) {
  const authApi = getAuthApi();
  if (authApi?.hashPassword) {
    return authApi.hashPassword(username, password);
  }

  // Simple obfuscation, not real security, but better than plain text for this offline tool.
  try {
    return btoa(`${username}:${password}`);
  } catch {
    return `${username}:${password}`;
  }
}

async function verifyPassword(username, password, passwordHash) {
  const authApi = getAuthApi();
  if (authApi?.verifyPassword) {
    return authApi.verifyPassword(username, password, passwordHash);
  }
  const expected = await hashPassword(username, password);
  return !!expected && expected === passwordHash;
}

async function isLegacyPasswordHash(passwordHash) {
  const authApi = getAuthApi();
  if (authApi?.isLegacyPasswordHash) {
    return authApi.isLegacyPasswordHash(passwordHash);
  }
  return typeof passwordHash === 'string' && !passwordHash.startsWith('scrypt$');
}

async function ensureBootstrapAdmin() {
  const users = loadUsers();
  if (users.length) return { users, bootstrapApplied: false };

  const authApi = getAuthApi();
  if (!authApi?.getBootstrapAdmin) {
    return { users, bootstrapApplied: false };
  }

  const bootstrapUser = await authApi.getBootstrapAdmin();
  if (!bootstrapUser) {
    return { users, bootstrapApplied: false };
  }

  const nextUsers = [bootstrapUser];
  saveUsers(nextUsers);
  return { users: nextUsers, bootstrapApplied: true };
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

function toggleSetupMode(enabled) {
  const signInTitle = document.getElementById('login-title');
  const subtitle = document.getElementById('login-subtitle');
  const loginForm = document.getElementById('login-form');
  const setupPanel = document.getElementById('setup-form');
  if (signInTitle) signInTitle.textContent = enabled ? 'Set up administrator account' : 'Sign in';
  if (subtitle) {
    subtitle.textContent = enabled
      ? 'No users exist yet. Create the first administrator account to continue.'
      : 'Enter your username and password.';
  }
  if (loginForm) loginForm.classList.toggle('hidden', enabled);
  if (setupPanel) setupPanel.classList.toggle('hidden', !enabled);
}

function showMessage(element, message, isError) {
  if (!element) return;
  if (!message) {
    element.className = 'hidden text-sm rounded-md px-3 py-2';
    element.textContent = '';
    return;
  }
  element.textContent = message;
  element.className = `text-sm rounded-md px-3 py-2 ${isError ? 'text-red-700 bg-red-100' : 'text-green-700 bg-green-100'}`;
}

window.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('login-form');
  const setupForm = document.getElementById('setup-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const error = document.getElementById('error');
  const setupUsernameInput = document.getElementById('setup-username');
  const setupDisplayNameInput = document.getElementById('setup-display-name');
  const setupEmployeeIdInput = document.getElementById('setup-employee-id');
  const setupPasswordInput = document.getElementById('setup-password');
  const setupConfirmInput = document.getElementById('setup-password-confirm');
  const setupMessage = document.getElementById('setup-message');
  const loginSubmitBtn = loginForm?.querySelector('button[type="submit"]');
  const setupSubmitBtn = setupForm?.querySelector('button[type="submit"]');

  const { users, bootstrapApplied } = await runAsync(() => ensureBootstrapAdmin(), {
    loadingMessage: 'Preparing sign-in...',
    errorMessage: 'Failed to initialize login screen.',
  });
  const needsSetup = !users.length;
  toggleSetupMode(needsSetup);
  if (bootstrapApplied) {
    showMessage(error, 'Bootstrap admin account created from environment settings. Please sign in.', false);
  }
  if (!loginForm || !setupForm || !usernameInput || !passwordInput) return;

  function clearErrorState() {
    showMessage(error, '', true);
    usernameInput.classList.remove('border-red-500', 'ring-red-300');
    passwordInput.classList.remove('border-red-500', 'ring-red-300');
  }

  usernameInput.addEventListener('input', clearErrorState);
  passwordInput.addEventListener('input', clearErrorState);

  setupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!setupUsernameInput || !setupPasswordInput || !setupConfirmInput) return;

    const username = setupUsernameInput.value.trim();
    const displayName = (setupDisplayNameInput?.value || '').trim();
    const employeeId = (setupEmployeeIdInput?.value || '').trim();
    const password = setupPasswordInput.value;
    const confirmPassword = setupConfirmInput.value;

    showMessage(setupMessage, '', true);
    if (!username || !password) {
      showMessage(setupMessage, 'Username and password are required.', true);
      return;
    }
    if (password !== confirmPassword) {
      showMessage(setupMessage, 'Passwords do not match.', true);
      return;
    }
    if (loadUsers().length) {
      toggleSetupMode(false);
      showMessage(error, 'An administrator account already exists. Please sign in.', true);
      return;
    }

    try {
      await runAsync(async () => {
        const passwordHash = await hashPassword(username, password);
        if (!saveUsers([{
          username,
          displayName: displayName || username,
          employeeId: employeeId || username,
          role: 'admin',
          active: true,
          passwordHash,
        }])) {
          throw new Error('Failed to create administrator account.');
        }
      }, {
        loadingMessage: 'Creating administrator account...',
        button: setupSubmitBtn,
        buttonLoadingText: 'Creating...',
        successMessage: 'Administrator account created.',
        errorMessage: 'Failed to create administrator account.',
      });
    } catch {
      showMessage(setupMessage, 'Failed to create administrator account.', true);
      return;
    }

    setupForm.reset();
    toggleSetupMode(false);
    showMessage(error, 'Administrator account created. Please sign in.', false);
    usernameInput.value = username;
    usernameInput.focus();
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    clearErrorState();
    if (!username || !password) {
      showMessage(error, 'Please enter both username and password.', true);
      if (!username) {
        usernameInput.classList.add('border-red-500', 'ring-red-300');
      }
      if (!password) {
        passwordInput.classList.add('border-red-500', 'ring-red-300');
      }
      return;
    }

    try {
      await runAsync(async () => {
        const currentUsers = loadUsers();
        if (!currentUsers.length) {
          toggleSetupMode(true);
          showMessage(setupMessage, 'Create the first administrator account before signing in.', true);
          return;
        }

        const user = currentUsers.find(u => u && u.username === username && u.active !== false);
        if (!user) {
          showMessage(error, 'Invalid username or password.', true);
          usernameInput.classList.add('border-red-500', 'ring-red-300');
          passwordInput.classList.add('border-red-500', 'ring-red-300');
          return;
        }

        const expectedHash = user.passwordHash;
        const verified = await verifyPassword(username, password, expectedHash);
        if (!verified) {
          showMessage(error, 'Invalid username or password.', true);
          usernameInput.classList.add('border-red-500', 'ring-red-300');
          passwordInput.classList.add('border-red-500', 'ring-red-300');
          return;
        }

        if (await isLegacyPasswordHash(expectedHash)) {
          user.passwordHash = await hashPassword(username, password);
          saveUsers(currentUsers);
        }

        setCurrentUser({ username: user.username, displayName: user.displayName, employeeId: user.employeeId, role: user.role });
        toast('Signed in successfully.', { type: 'success' });
        window.location.href = getReturnUrl();
      }, {
        loadingMessage: 'Signing in...',
        button: loginSubmitBtn,
        buttonLoadingText: 'Signing in...',
        errorToast: false,
      });
    } catch {
      showMessage(error, 'Failed to sign in.', true);
    }
  });
});
