'use strict';

const recordsBody = document.getElementById('records-body');
const paginationControls = document.getElementById('pagination-controls');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const pageInfo = document.getElementById('page-info');
const exportCsvBtn = document.getElementById('export-csv-btn');

const RECORDS_KEY = 'stock_out_records';
const RECORDS_PER_PAGE = 20;
let currentPage = 1;
let allRecords = [];

function getCurrentUser() {
  try {
    const u = localStorage.getItem('current_user');
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

function ensureLoggedIn() {
  const user = getCurrentUser();
  if (!user || !(user.name || user.username)) {
    const ret = encodeURIComponent((location.pathname.split('/').pop()) || 'stock-out-records.html');
    window.location.href = `login.html?return=${ret}`;
    return false;
  }
  return true;
}

function showEmpty(message) {
  recordsBody.innerHTML = `
    <tr>
      <td colspan="9" class="py-6 text-center text-gray-500">${message}</td>
    </tr>`;
}

function loadRecords() {
  try {
    const stored = localStorage.getItem(RECORDS_KEY);
    allRecords = stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error reading stock out records:', error);
    allRecords = [];
  }

  if (!Array.isArray(allRecords) || allRecords.length === 0) {
    paginationControls.style.display = 'none';
    pageInfo.textContent = 'Page 0 of 0';
    showEmpty('No stock-out records found.');
    return;
  }

  allRecords.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  const totalPages = Math.ceil(allRecords.length / RECORDS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  renderPage();
}

function renderPage() {
  if (!allRecords.length) {
    showEmpty('No stock-out records found.');
    paginationControls.style.display = 'none';
    pageInfo.textContent = 'Page 0 of 0';
    return;
  }

  const totalPages = Math.ceil(allRecords.length / RECORDS_PER_PAGE);
  const startIndex = (currentPage - 1) * RECORDS_PER_PAGE;
  const endIndex = startIndex + RECORDS_PER_PAGE;
  const pageRecords = allRecords.slice(startIndex, endIndex);

  recordsBody.innerHTML = '';
  pageRecords.forEach(record => {
    const row = document.createElement('tr');
    const date = record.timestamp ? new Date(record.timestamp).toLocaleString() : '--';
    row.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${date}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.labelId || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.itemName || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.itemId || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.lotNo || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.manufacturingLot || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.responsibleUser || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-blue-700">${formatWeight(record.outWeight)}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record.unit || '--'}</td>
    `;
    recordsBody.appendChild(row);
  });

  paginationControls.style.display = 'flex';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;
}

function formatWeight(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value.toFixed(2);
  }
  return '--';
}

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    renderPage();
  }
});

nextPageBtn.addEventListener('click', () => {
  const totalPages = Math.ceil(allRecords.length / RECORDS_PER_PAGE);
  if (currentPage < totalPages) {
    currentPage += 1;
    renderPage();
  }
});

exportCsvBtn.addEventListener('click', () => {
  if (!Array.isArray(allRecords) || allRecords.length === 0) {
    alert('No stock-out records to export.');
    return;
  }

  const headers = ['Date', 'Label ID', 'Item Name', 'Item ID', 'Lot No', 'Manufacturing Lot', 'Responsible', 'Out Weight', 'Unit'];
  const rows = allRecords.map(record => [
    record.timestamp ? new Date(record.timestamp).toISOString() : '',
    record.labelId || '',
    record.itemName || '',
    record.itemId || '',
    record.lotNo || '',
    record.manufacturingLot || '',
    record.responsibleUser || '',
    typeof record.outWeight === 'number' ? record.outWeight.toFixed(2) : '',
    record.unit || ''
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(escapeCsv).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `stock-out-records-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
});

function escapeCsv(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  loadRecords();
});
