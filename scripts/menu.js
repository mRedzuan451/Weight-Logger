'use strict';

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function redirectToLogin() {
  window.location.href = 'login.html?return=menu.html';
}

function handleLogout() {
  localStorage.removeItem('current_user');
  redirectToLogin();
}

function isAdmin(user) {
  if (!user) return false;
  const name = (user.name || '').trim().toLowerCase();
  const id = (user.employeeId || user.username || '').trim();
  return name === 'admin' && id === '1234';
}

window.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();
  if (!user || !(user.name || user.username)) {
    redirectToLogin();
    return;
  }

  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    handleLogout();
  });

  const adminBtn = document.getElementById('admin-btn');
  if (isAdmin(user)) {
    adminBtn?.classList.remove('hidden');
  }
});
