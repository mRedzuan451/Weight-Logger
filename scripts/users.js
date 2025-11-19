'use strict';

const USER_ACCOUNTS_KEY = 'user_accounts';

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const name = (user.name || '').trim().toLowerCase();
  const id = (user.employeeId || user.username || '').trim();
  return name === 'admin' && id === '1234';
}

function redirectToLogin() {
  window.location.href = 'login.html?return=users.html';
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

function renderUsers() {
  const tbody = document.getElementById('users-body');
  const countEl = document.getElementById('user-count');
  if (!tbody) return;

  const users = loadUsers();
  if (countEl) countEl.textContent = `${users.length} user(s)`;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-gray-500">No users found.</td></tr>';
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
      <td class="px-4 py-2 whitespace-nowrap text-sm ${user.role === 'admin' ? 'text-red-700 font-semibold' : 'text-gray-700'}">${user.role || 'user'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm ${active ? 'text-green-700' : 'text-gray-400'}">${active ? 'Active' : 'Inactive'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700 space-x-2">
        <button data-action="reset" data-username="${user.username}" class="text-blue-600 hover:text-blue-800 font-semibold">Reset PW</button>
        ${user.username !== 'admin' ? `<button data-action="toggle" data-username="${user.username}" class="text-amber-600 hover:text-amber-800 font-semibold">${active ? 'Deactivate' : 'Activate'}</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function handleResetPassword(username) {
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
  user.passwordHash = makePasswordHash(username, trimmed);
  saveUsers(users);
  showStatus('Password updated.', false);
}

function handleToggleActive(username) {
  const users = loadUsers();
  const user = users.find(u => u && u.username === username);
  if (!user) {
    showStatus('User not found.', true);
    return;
  }
  if (user.username === 'admin') {
    showStatus('Cannot deactivate the default admin account.', true);
    return;
  }
  user.active = user.active === false ? true : false;
  saveUsers(users);
  renderUsers();
  showStatus(user.active !== false ? 'User activated.' : 'User deactivated.', false);
}

window.addEventListener('DOMContentLoaded', () => {
  const me = getCurrentUser();
  if (!me || !isAdmin(me)) {
    redirectToLogin();
    return;
  }

  renderUsers();

  const form = document.getElementById('user-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const usernameEl = document.getElementById('user-username');
    const displayEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-role');
    const pwdEl = document.getElementById('user-password');
    if (!usernameEl || !roleEl || !pwdEl) return;

    const username = usernameEl.value.trim();
    const displayName = (displayEl?.value || '').trim();
    const role = roleEl.value === 'admin' ? 'admin' : 'user';
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
      role,
      active: true,
      passwordHash: makePasswordHash(username, password),
    });
    saveUsers(users);
    renderUsers();

    usernameEl.value = '';
    if (displayEl) displayEl.value = '';
    pwdEl.value = '';
    roleEl.value = 'user';
    showStatus('User created.', false);
  });

  const tbody = document.getElementById('users-body');
  tbody?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute('data-action');
    const username = target.getAttribute('data-username');
    if (!action || !username) return;

    if (action === 'reset') {
      handleResetPassword(username);
      renderUsers();
    } else if (action === 'toggle') {
      handleToggleActive(username);
    }
  });
});
