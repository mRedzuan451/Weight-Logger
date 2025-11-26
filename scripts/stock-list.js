'use strict';

const bodyEl = document.getElementById('stocklist-body');
const statusBox = document.getElementById('stocklist-status');
const logoutBtn = document.getElementById('logout-btn');
const searchInput = document.getElementById('stocklist-search');
const printBtn = document.getElementById('stocklist-print-btn');
const exportBtn = document.getElementById('stocklist-export-btn');

let allRows = [];
let currentSort = { key: 'labelId', direction: 'asc' };
let headerCells = [];
const sortKeys = ['labelId', 'itemName', 'itemId', 'lotNo', 'manufacturingLot', 'quantity', 'expectedWeight'];

function formatNumber(value, decimals = 2) {
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getFilteredAndSortedRows() {
  const query = (searchInput?.value || '').trim().toLowerCase();

  let rows = allRows.slice();
  if (query) {
    rows = rows.filter(r => {
      return (
        String(r.labelId || '').toLowerCase().includes(query) ||
        String(r.itemName || '').toLowerCase().includes(query) ||
        String(r.itemId || '').toLowerCase().includes(query) ||
        String(r.lotNo || '').toLowerCase().includes(query) ||
        String(r.manufacturingLot || '').toLowerCase().includes(query)
      );
    });
  }

  const { key, direction } = currentSort;
  rows.sort((a, b) => {
    const av = a[key];
    const bv = b[key];

    if (av == null && bv == null) return 0;
    if (av == null) return direction === 'asc' ? -1 : 1;
    if (bv == null) return direction === 'asc' ? 1 : -1;

    if (typeof av === 'number' && typeof bv === 'number') {
      return direction === 'asc' ? av - bv : bv - av;
    }

    const as = String(av).toLowerCase();
    const bs = String(bv).toLowerCase();
    if (as < bs) return direction === 'asc' ? -1 : 1;
    if (as > bs) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  return rows;
}

function renderFilteredAndSorted() {
  if (!bodyEl) return;

  const rows = getFilteredAndSortedRows();

  bodyEl.innerHTML = '';
  if (!rows.length) {
    bodyEl.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-500">No current stock found.</td></tr>';
    return;
  }

  let totalQty = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const tr = document.createElement('tr');
    const expectedText = row.expectedWeight && !Number.isNaN(row.expectedWeight)
      ? `${formatNumber(row.expectedWeight, 2)} ${row.unit}`
      : '--';
    const qtyNum = parseFloat(row.quantity);
    const qtyText = !Number.isNaN(qtyNum)
      ? `${formatNumber(qtyNum, 0)} pcs`
      : row.quantity;
    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.labelId}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.itemName}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.itemId}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.lotNo}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.manufacturingLot}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${qtyText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${expectedText}</td>
    `;
    bodyEl.appendChild(tr);

    const q = parseFloat(row.quantity);
    if (!Number.isNaN(q)) {
      totalQty += q;
    }

    const w = parseFloat(row.expectedWeight);
    if (!Number.isNaN(w)) {
      totalWeight += w;
    }
  }

  const totalTr = document.createElement('tr');
  totalTr.className = 'bg-gray-50';
  totalTr.innerHTML = `
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-700" colspan="5">Total</td>
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-900">${formatNumber(totalQty, 0)} pcs</td>
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-900">${formatNumber(totalWeight, 2)} ${rows.length > 0 ? rows[0].unit : ''}</td>
  `;
  bodyEl.appendChild(totalTr);
}

function exportCurrentViewToCsv() {
  const rows = getFilteredAndSortedRows();
  if (!rows.length) {
    showStatus('No rows to export.', true);
    return;
  }

  const headers = ['Label ID', 'Item Name', 'Item ID', 'Lot No', 'Mfg Lot', 'Quantity', 'Expected Weight'];
  const lines = [headers.join(',')];

  for (const row of rows) {
    const qtyNum = parseFloat(row.quantity);
    const qtyText = !Number.isNaN(qtyNum) ? `${qtyNum}` : String(row.quantity || '');
    const weightNum = parseFloat(row.expectedWeight);
    const weightText = !Number.isNaN(weightNum) ? `${weightNum}` : String(row.expectedWeight || '');
    const unit = row.unit || '';

    const values = [
      row.labelId,
      row.itemName,
      row.itemId,
      row.lotNo,
      row.manufacturingLot,
      qtyText,
      weightText + (unit ? ` ${unit}` : ''),
    ].map(v => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    });

    lines.push(values.join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stock-list.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus('Exported current stock list to CSV.', false);
}

function setSort(key) {
  if (currentSort.key === key) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort = { key, direction: 'asc' };
  }
  updateSortIndicators();
  renderFilteredAndSorted();
}

function updateSortIndicators() {
  if (!headerCells || !headerCells.length) return;
  headerCells.forEach((th, index) => {
    const key = sortKeys[index];
    if (!key) return;
    const baseLabel = th.dataset.baseLabel || th.textContent.replace(/[▲▼]/g, '').trim();
    th.dataset.baseLabel = baseLabel;

    if (key === currentSort.key) {
      const arrow = currentSort.direction === 'asc' ? '▲' : '▼';
      th.textContent = baseLabel + ' ' + arrow;
    } else {
      th.textContent = baseLabel;
    }
    th.classList.add('cursor-pointer', 'select-none');
  });
}

function redirectToLogin() {
  window.location.href = 'login.html?return=stock-list.html';
}

function ensureLoggedIn() {
  const user = getCurrentUser();
  if (!user || !(user.name || user.username)) {
    redirectToLogin();
    return false;
  }
  return true;
}

function handleLogout(e) {
  e?.preventDefault();
  localStorage.removeItem('current_user');
  redirectToLogin();
}

function showStatus(message, isError = false) {
  if (!statusBox) return;
  if (!message) {
    statusBox.className = 'hidden px-4 py-3 rounded-lg text-sm font-semibold';
    statusBox.textContent = '';
    return;
  }
  statusBox.textContent = message;
  statusBox.className = 'px-4 py-3 rounded-lg text-sm font-semibold ' +
    (isError ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800');
}

function loadStockList() {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-gray-500">Loading current stock...</td></tr>';

  try {
    const insRaw = localStorage.getItem('weight_records');
    const outsRaw = localStorage.getItem('stock_out_records');
    const ins = insRaw ? JSON.parse(insRaw) : [];
    const outs = outsRaw ? JSON.parse(outsRaw) : [];

    const latestInByLabel = new Map();
    if (Array.isArray(ins)) {
      for (const r of ins) {
        if (!r || !r.labelId) continue;
        const existing = latestInByLabel.get(r.labelId);
        const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
        const existingT = existing && existing.timestamp ? new Date(existing.timestamp).getTime() : -1;
        if (!existing || t > existingT) {
          latestInByLabel.set(r.labelId, r);
        }
      }
    }

    const latestOutByLabel = new Map();
    if (Array.isArray(outs)) {
      for (const r of outs) {
        if (!r || !r.labelId) continue;
        const existing = latestOutByLabel.get(r.labelId);
        const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
        const existingT = existing && existing.timestamp ? new Date(existing.timestamp).getTime() : -1;
        if (!existing || t > existingT) {
          latestOutByLabel.set(r.labelId, r);
        }
      }
    }

    const rows = [];
    latestInByLabel.forEach((inRec, labelId) => {
      const outRec = latestOutByLabel.get(labelId);
      const inTime = inRec.timestamp ? new Date(inRec.timestamp).getTime() : 0;
      const outTime = outRec && outRec.timestamp ? new Date(outRec.timestamp).getTime() : -1;
      const status = outTime > inTime ? 'OUT' : 'IN';
      if (status !== 'IN') return; // only current stock

      const measured = typeof inRec.measuredWeight === 'number'
        ? inRec.measuredWeight
        : parseFloat(inRec.measuredWeight);
      const unit = inRec.unit || 'g';

      rows.push({
        labelId,
        itemName: inRec.itemName || '--',
        itemId: inRec.itemId || '--',
        lotNo: inRec.lotNo || '--',
        manufacturingLot: inRec.manufacturingLot || '--',
        quantity: inRec.quantity || '--',
        expectedWeight: measured,
        unit,
      });
    });

    allRows = rows;
    renderFilteredAndSorted();
    showStatus('Current stock loaded.', false);
  } catch (err) {
    console.error('Error loading stock list:', err);
    showStatus('Failed to load current stock. See console for details.', true);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  logoutBtn?.addEventListener('click', handleLogout);
  printBtn?.addEventListener('click', () => {
    window.print();
  });
  exportBtn?.addEventListener('click', () => {
    exportCurrentViewToCsv();
  });
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderFilteredAndSorted();
    });
  }

  headerCells = Array.from(document.querySelectorAll('thead tr th'));
  if (headerCells && headerCells.length) {
    headerCells.forEach((th, index) => {
      const key = sortKeys[index];
      if (!key) return;
      th.addEventListener('click', () => setSort(key));
    });
    updateSortIndicators();
  }

  loadStockList();
});
