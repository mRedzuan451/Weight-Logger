'use strict';

const USER_ACCOUNTS_KEY = 'user_accounts';
const GLOBAL_STOCK_TAKE_TOLERANCE_KEY = 'global_stock_take_tolerance_grams';
const GLOBAL_STOCK_TAKE_DIFF_LIMIT_KEY = 'global_stock_take_diff_limit_grams';
const SST_FEATURE_ENABLED_KEY = 'feature_sst_enabled';
const STOCK_TAKE_MANUAL_WEIGHT_ENABLED_KEY = 'feature_stock_take_manual_weight_enabled';
const ST_PRINT_LOA_SETTINGS_KEY = 'st_print_loa_settings';
const USERS_BACKUP_SCHEMA_VERSION = 1;
const USERS_BACKUP_KEYS = [
  'weight_records',
  'stock_out_records',
  'stock_take_history',
  'stock_take_state',
  'login_history',
  USER_ACCOUNTS_KEY,
];

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadGlobalStockTakeDiffLimit() {
  try {
    const raw = localStorage.getItem(GLOBAL_STOCK_TAKE_DIFF_LIMIT_KEY);
    if (raw === null || raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function saveGlobalStockTakeDiffLimit(value) {
  try {
    if (value === null) {
      localStorage.removeItem(GLOBAL_STOCK_TAKE_DIFF_LIMIT_KEY);
      return true;
    }
    localStorage.setItem(GLOBAL_STOCK_TAKE_DIFF_LIMIT_KEY, String(value));
    return true;
  } catch {
    return false;
  }
}

function isAdmin(user) {
  return !!user && user.role === 'admin';
}

function isSupervisor(user) {
  if (!user) return false;
  return user.role === 'supervisor';
}

function redirectToLogin() {
  window.location.href = 'login.html?return=users.html';
}

function getSstFeatureEnabled() {
  try {
    const raw = localStorage.getItem(SST_FEATURE_ENABLED_KEY);
    if (raw === null) return true;
    if (raw === '1') return true;
    if (raw === '0') return false;
    return raw === 'true';
  } catch {
    return true;
  }
}

function setSstFeatureEnabled(enabled) {
  try {
    localStorage.setItem(SST_FEATURE_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
  }
}

function getManualWeightEntryEnabled() {
  try {
    const raw = localStorage.getItem(STOCK_TAKE_MANUAL_WEIGHT_ENABLED_KEY);
    if (raw === null) return false;
    if (raw === '1') return true;
    if (raw === '0') return false;
    return raw === 'true';
  } catch {
    return false;
  }
}

function setManualWeightEntryEnabled(enabled) {
  try {
    localStorage.setItem(STOCK_TAKE_MANUAL_WEIGHT_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
  }
}

function updateManualWeightToggleBtn(btn) {
  if (!btn) return;
  const enabled = getManualWeightEntryEnabled();
  btn.textContent = enabled ? 'Manual Weight: Enabled' : 'Manual Weight: Disabled';
}

function updateSstToggleBtn(btn) {
  if (!btn) return;
  const enabled = getSstFeatureEnabled();
  btn.textContent = enabled ? 'SST: Enabled' : 'SST: Disabled';
}

function loadStPrintLoaSettings() {
  try {
    const raw = localStorage.getItem(ST_PRINT_LOA_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      approved1: typeof parsed.approved1 === 'string' ? parsed.approved1 : null,
      amount1: typeof parsed.amount1 === 'string' ? parsed.amount1 : null,
      approved2: typeof parsed.approved2 === 'string' ? parsed.approved2 : null,
      amount2: typeof parsed.amount2 === 'string' ? parsed.amount2 : null,
    };
  } catch {
    return null;
  }
}

function saveStPrintLoaSettings(settings) {
  try {
    localStorage.setItem(ST_PRINT_LOA_SETTINGS_KEY, JSON.stringify(settings || {}));
    return true;
  } catch {
    return false;
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

function getAuthApi() {
  return window.electronAuth || null;
}

async function hashPassword(username, password) {
  const authApi = getAuthApi();
  if (authApi?.hashPassword) {
    return authApi.hashPassword(username, password);
  }
  try {
    return btoa(`${username}:${password}`);
  } catch {
    return `${username}:${password}`;
  }
}

function showStatus(message, isError = false) {
  const box = document.getElementById('user-status');
  if (!box) return;
  if (!message) {
    box.className = 'hidden px-4 py-3 rounded-lg text-sm font-semibold';
    box.textContent = '';
    return;
  }
  box.textContent = message;
  box.className = 'px-4 py-3 rounded-lg text-sm font-semibold ' + (isError ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800');
}

function usersFormatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function usersGetApproxStorageUsageBytes() {
  let totalChars = 0;
  try {
    if (typeof localStorage === 'undefined') return 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key) || '';
      totalChars += key.length + value.length;
    }
  } catch {
    return 0;
  }
  return totalChars * 2;
}

function updateStorageUsageDisplay() {
  const el = document.getElementById('storage-usage');
  if (!el || typeof localStorage === 'undefined') return;
  const bytes = usersGetApproxStorageUsageBytes();
  el.textContent = `Approx. storage used: ${usersFormatBytes(bytes)} in ${localStorage.length} key(s).`;
}

function usersSafeParseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function usersBuildBackupObject() {
  const data = {};
  for (const key of USERS_BACKUP_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      data[key] = null;
    } else {
      data[key] = usersSafeParseJson(raw);
    }
  }
  return {
    app: 'WeightLogger',
    schemaVersion: USERS_BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    data,
  };
}

function usersBackupJson() {
  try {
    const backup = usersBuildBackupObject();
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `weightlogger-backup-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showStatus('Backup downloaded as JSON file.', false);
  } catch (error) {
    console.error('Error creating backup:', error);
    showStatus('Failed to create backup. Check console.', true);
  }
}

function usersRestoreFromBackupObject(backup) {
  if (!backup || backup.app !== 'WeightLogger' || typeof backup.data !== 'object' || backup.data === null) {
    showStatus('Invalid backup file format.', true);
    return;
  }
  if (typeof backup.schemaVersion === 'number' && backup.schemaVersion > USERS_BACKUP_SCHEMA_VERSION) {
    const proceed = window.confirm('This backup was created by a newer version of the app. Try to restore anyway?');
    if (!proceed) return;
  }

  const keys = Object.keys(backup.data);
  if (!keys.length) {
    showStatus('Backup file contains no data.', true);
    return;
  }

  const summary = keys.join(', ');
  const ok = window.confirm(`Restore data for these keys:\n${summary}\n\nThis will overwrite current data in this browser.`);
  if (!ok) return;

  try {
    for (const key of keys) {
      const value = backup.data[key];
      if (value === null || typeof value === 'undefined') {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    }

    renderUsers();
    showStatus('Backup restored successfully.', false);
    updateStorageUsageDisplay();
  } catch (error) {
    console.error('Error restoring backup:', error);
    showStatus('Failed to restore backup. Check console.', true);
  }
}

function usersHandleRestoreFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = reader.result;
      const backup = typeof text === 'string' ? JSON.parse(text) : null;
      if (!backup) {
        showStatus('Selected file is not a valid JSON backup.', true);
        return;
      }
      usersRestoreFromBackupObject(backup);
    } catch (error) {
      console.error('Error reading backup file:', error);
      showStatus('Selected file is not a valid JSON backup.', true);
    }
  };
  reader.onerror = () => {
    showStatus('Failed to read backup file.', true);
  };
  reader.readAsText(file);
}

function initSstToggleUI(currentUser) {
  const btn = document.getElementById('sst-toggle-btn');
  if (!btn) return;

  if (!isAdmin(currentUser)) {
    btn.classList.add('hidden');
    btn.style.display = 'none';
    return;
  }

  btn.classList.remove('hidden');
  btn.style.display = 'inline-block';
  updateSstToggleBtn(btn);

  btn.addEventListener('click', () => {
    const next = !getSstFeatureEnabled();
    setSstFeatureEnabled(next);
    updateSstToggleBtn(btn);
    showStatus(`SST is now ${next ? 'enabled' : 'disabled'}.`, false);
  });
}

function initManualWeightToggleUI(currentUser) {
  const btn = document.getElementById('manual-weight-toggle-btn');
  if (!btn) return;

  if (!isAdmin(currentUser)) {
    btn.classList.add('hidden');
    btn.style.display = 'none';
    return;
  }

  btn.classList.remove('hidden');
  btn.style.display = 'inline-block';
  updateManualWeightToggleBtn(btn);

  btn.addEventListener('click', () => {
    const next = !getManualWeightEntryEnabled();
    setManualWeightEntryEnabled(next);
    updateManualWeightToggleBtn(btn);
    showStatus(`Manual weight entry is now ${next ? 'enabled' : 'disabled'}.`, false);
  });
}

function renderUsers() {
  const tbody = document.getElementById('users-body');
  const countEl = document.getElementById('user-count');
  if (!tbody) return;

  const users = loadUsers();
  if (countEl) countEl.textContent = `${users.length} user(s)`;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-gray-500">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  for (const user of users) {
    if (!user) continue;
    const tr = document.createElement('tr');
    const active = user.active !== false;
    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700 font-mono">${user.username}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${user.displayName || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${user.employeeId || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm ${user.role === 'admin' ? 'text-red-700 font-semibold' : (user.role === 'supervisor' ? 'text-amber-700 font-semibold' : 'text-gray-700')}">${user.role || 'user'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm ${active ? 'text-green-700' : 'text-gray-400'}">${active ? 'Active' : 'Inactive'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700 space-x-2">
        <button data-action="reset" data-username="${user.username}" class="text-blue-600 hover:text-blue-800 font-semibold">Reset PW</button>
        <button data-action="toggle" data-username="${user.username}" class="text-amber-600 hover:text-amber-800 font-semibold">${active ? 'Deactivate' : 'Activate'}</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function handleResetPassword(username) {
  const pwd = prompt(`Enter new password for ${username}:`, '');
  if (pwd === null) return;
  const trimmed = pwd.trim();
  if (!trimmed) {
    showStatus('Password cannot be empty.', true);
    return;
  }
  const users = loadUsers();
  const user = users.find(u => u && u.username === username);
  if (!user) {
    showStatus('User not found.', true);
    return;
  }
  user.passwordHash = await hashPassword(username, trimmed);
  saveUsers(users);
  showStatus('Password updated.', false);
  updateStorageUsageDisplay();
}

function loadGlobalStockTakeTolerance() {
  try {
    const raw = localStorage.getItem(GLOBAL_STOCK_TAKE_TOLERANCE_KEY);
    if (raw === null || raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function saveGlobalStockTakeTolerance(value) {
  try {
    if (value === null) {
      localStorage.removeItem(GLOBAL_STOCK_TAKE_TOLERANCE_KEY);
      return true;
    }
    localStorage.setItem(GLOBAL_STOCK_TAKE_TOLERANCE_KEY, String(value));
    return true;
  } catch {
    return false;
  }
}

function handleToggleActive(username) {
  const users = loadUsers();
  const user = users.find(u => u && u.username === username);
  if (!user) {
    showStatus('User not found.', true);
    return;
  }
  const nextActive = user.active === false;
  if (!nextActive && user.role === 'admin') {
    const activeAdminCount = users.filter(u => u && u.role === 'admin' && u.active !== false).length;
    if (activeAdminCount <= 1) {
      showStatus('Cannot deactivate the last active admin account.', true);
      return;
    }
  }
  user.active = nextActive;
  saveUsers(users);
  renderUsers();
  showStatus(user.active !== false ? 'User activated.' : 'User deactivated.', false);
  updateStorageUsageDisplay();
}

window.addEventListener('DOMContentLoaded', () => {
  const me = getCurrentUser();
  if (!me || !isAdmin(me)) {
    redirectToLogin();
    return;
  }

  initSstToggleUI(me);
  initManualWeightToggleUI(me);

  const globalToleranceEl = document.getElementById('global-stocktake-tolerance');
  const globalDiffLimitEl = document.getElementById('global-stocktake-diff-limit');
  const globalToleranceSaveBtn = document.getElementById('global-stocktake-tolerance-save');
  const savedTolerance = loadGlobalStockTakeTolerance();
  const savedDiffLimit = loadGlobalStockTakeDiffLimit();
  if (globalToleranceEl && 'value' in globalToleranceEl) {
    globalToleranceEl.value = savedTolerance === null ? '' : String(savedTolerance);
  }
  if (globalDiffLimitEl && 'value' in globalDiffLimitEl) {
    globalDiffLimitEl.value = savedDiffLimit === null ? '' : String(savedDiffLimit);
  }
  globalToleranceSaveBtn?.addEventListener('click', () => {
    const raw = (globalToleranceEl && 'value' in globalToleranceEl) ? String(globalToleranceEl.value).trim() : '';
    const parsed = raw === '' ? null : Number(raw);
    const diffRaw = (globalDiffLimitEl && 'value' in globalDiffLimitEl) ? String(globalDiffLimitEl.value).trim() : '';
    const diffParsed = diffRaw === '' ? null : Number(diffRaw);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      showStatus('Allowable tolerance must be a number greater than or equal to 0.', true);
      return;
    }
    if (diffParsed !== null && (!Number.isFinite(diffParsed) || diffParsed < 0)) {
      showStatus('Allowable difference limit must be a number greater than or equal to 0.', true);
      return;
    }
    const okTolerance = saveGlobalStockTakeTolerance(parsed === null ? null : parsed);
    const okDiffLimit = saveGlobalStockTakeDiffLimit(diffParsed === null ? null : diffParsed);
    const ok = okTolerance && okDiffLimit;
    showStatus(ok ? 'Stock take settings saved.' : 'Failed to save stock take settings.', !ok);
    updateStorageUsageDisplay();
  });

  const stLoaApproved1El = document.getElementById('st-loa-approved-1');
  const stLoaAmount1El = document.getElementById('st-loa-amount-1');
  const stLoaApproved2El = document.getElementById('st-loa-approved-2');
  const stLoaAmount2El = document.getElementById('st-loa-amount-2');
  const stLoaSaveBtn = document.getElementById('st-loa-save');
  const stLoaSaved = loadStPrintLoaSettings();
  if (stLoaApproved1El && 'value' in stLoaApproved1El) {
    stLoaApproved1El.value = (stLoaSaved && typeof stLoaSaved.approved1 === 'string') ? stLoaSaved.approved1 : 'Dept Mgr/Snr Mgr/Div Mgr';
  }
  if (stLoaAmount1El && 'value' in stLoaAmount1El) {
    stLoaAmount1El.value = (stLoaSaved && typeof stLoaSaved.amount1 === 'string') ? stLoaSaved.amount1 : '<0.1 Mil Yen      <2.98 k RM';
  }
  if (stLoaApproved2El && 'value' in stLoaApproved2El) {
    stLoaApproved2El.value = (stLoaSaved && typeof stLoaSaved.approved2 === 'string') ? stLoaSaved.approved2 : 'Managing Director';
  }
  if (stLoaAmount2El && 'value' in stLoaAmount2El) {
    stLoaAmount2El.value = (stLoaSaved && typeof stLoaSaved.amount2 === 'string') ? stLoaSaved.amount2 : '<1.0 Mil Yen      <29.80 k RM';
  }

  stLoaSaveBtn?.addEventListener('click', () => {
    const approved1 = (stLoaApproved1El && 'value' in stLoaApproved1El) ? String(stLoaApproved1El.value || '').trim() : '';
    const amount1 = (stLoaAmount1El && 'value' in stLoaAmount1El) ? String(stLoaAmount1El.value || '').trim() : '';
    const approved2 = (stLoaApproved2El && 'value' in stLoaApproved2El) ? String(stLoaApproved2El.value || '').trim() : '';
    const amount2 = (stLoaAmount2El && 'value' in stLoaAmount2El) ? String(stLoaAmount2El.value || '').trim() : '';
    const ok = saveStPrintLoaSettings({ approved1, amount1, approved2, amount2 });
    showStatus(ok ? 'LOA table saved.' : 'Failed to save LOA table.', !ok);
    updateStorageUsageDisplay();
  });

  renderUsers();
  updateStorageUsageDisplay();

  const backupBtn = document.getElementById('users-backup-json');
  const restoreBtn = document.getElementById('users-restore-json');
  const restoreInput = document.getElementById('users-restore-file');

  backupBtn?.addEventListener('click', usersBackupJson);

  if (restoreBtn && restoreInput) {
    restoreBtn.addEventListener('click', () => {
      restoreInput.value = '';
      restoreInput.click();
    });
    restoreInput.addEventListener('change', (event) => {
      const target = event.target;
      const file = target.files && target.files[0];
      if (file) {
        usersHandleRestoreFile(file);
      }
      target.value = '';
    });
  }

  const form = document.getElementById('user-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameEl = document.getElementById('user-username');
    const displayEl = document.getElementById('user-display-name');
    const employeeIdEl = document.getElementById('user-employee-id');
    const roleEl = document.getElementById('user-role');
    const pwdEl = document.getElementById('user-password');
    if (!usernameEl || !roleEl || !pwdEl) return;

    const username = usernameEl.value.trim();
    const displayName = (displayEl?.value || '').trim();
    const employeeId = (employeeIdEl?.value || '').trim();
    const role = roleEl.value === 'admin'
      ? 'admin'
      : (roleEl.value === 'supervisor' ? 'supervisor' : 'user');
    const password = pwdEl.value;

    if (!username || !password) {
      showStatus('Username and password are required.', true);
      return;
    }

    const users = loadUsers();
    const existing = users.find(u => u && u.username === username);
    if (existing) {
      showStatus('A user with that username already exists.', true);
      return;
    }

    users.push({
      username,
      displayName: displayName || username,
      employeeId: employeeId || username,
      role,
      active: true,
      passwordHash: await hashPassword(username, password),
    });
    saveUsers(users);
    renderUsers();

    usernameEl.value = '';
    if (displayEl) displayEl.value = '';
    if (employeeIdEl) employeeIdEl.value = '';
    pwdEl.value = '';
    roleEl.value = 'user';
    showStatus('User created.', false);
    updateStorageUsageDisplay();
  });

  const tbody = document.getElementById('users-body');
  tbody?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute('data-action');
    const username = target.getAttribute('data-username');
    if (!action || !username) return;

    if (action === 'reset') {
      handleResetPassword(username).then(() => {
        renderUsers();
      });
    } else if (action === 'toggle') {
      handleToggleActive(username);
    }
  });
});
