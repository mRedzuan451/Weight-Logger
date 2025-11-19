'use strict';

const LOGIN_HISTORY_KEY = 'login_history';
const RECORDS_PER_PAGE = 25;

const bodyEl = document.getElementById('login-records-body');
const paginationControls = document.getElementById('pagination-controls');
const prevBtn = document.getElementById('prev-page-btn');
const nextBtn = document.getElementById('next-page-btn');
const pageInfo = document.getElementById('page-info');

let allRecords = [];
let currentPage = 1;

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('current_user')) || null;
  } catch {
    return null;
  }
}

function ensureAdmin() {
  const user = getCurrentUser();
  if (!user) {
    redirectToLogin();
    return false;
  }
  const name = (user.name || '').trim().toLowerCase();
  const id = (user.employeeId || user.username || '').trim();
  if (name !== 'admin' || id !== '1234') {
    window.location.href = 'menu.html';
    return false;
  }
  return true;
}

function redirectToLogin() {
  window.location.href = 'login.html?return=login-records.html';
}

function readHistory() {
  try {
    const raw = localStorage.getItem(LOGIN_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
  } catch (error) {
    console.error('Unable to load login history:', error);
    return [];
  }
}

function showEmpty(message) {
  bodyEl.innerHTML = `
    <tr>
      <td colspan="4" class="py-6 text-center text-gray-500">${message}</td>
    </tr>`;
}

function renderPage() {
  if (!allRecords.length) {
    showEmpty('No login activity found.');
    paginationControls.style.display = 'none';
    pageInfo.textContent = 'Page 0 of 0';
    return;
  }

  const totalPages = Math.ceil(allRecords.length / RECORDS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * RECORDS_PER_PAGE;
  const slice = allRecords.slice(start, start + RECORDS_PER_PAGE);

  bodyEl.innerHTML = '';
  slice.forEach((record) => {
    const date = record.timestamp ? new Date(record.timestamp).toLocaleString() : '--';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${date}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.name || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.employeeId || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.displayName || '--'}</td>
    `;
    bodyEl.appendChild(tr);
  });

  paginationControls.style.display = totalPages > 1 ? 'flex' : 'none';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = currentPage === totalPages;
}

prevBtn?.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    renderPage();
  }
});

nextBtn?.addEventListener('click', () => {
  const totalPages = Math.ceil(allRecords.length / RECORDS_PER_PAGE);
  if (currentPage < totalPages) {
    currentPage += 1;
    renderPage();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  if (!ensureAdmin()) return;
  allRecords = readHistory();
  renderPage();
});
