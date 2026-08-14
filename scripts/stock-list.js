'use strict';

const { ensureLoggedIn, formatNumber, redirectToLogin, safeParseArray } = window.WeightLoggerUtils;

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

function compareValues(a, b, direction) {
  if (a == null && b == null) return 0;
  if (a == null) return direction === 'asc' ? -1 : 1;
  if (b == null) return direction === 'asc' ? 1 : -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return direction === 'asc' ? a - b : b - a;
  }

  const as = String(a).toLowerCase();
  const bs = String(b).toLowerCase();
  if (as < bs) return direction === 'asc' ? -1 : 1;
  if (as > bs) return direction === 'asc' ? 1 : -1;
  return 0;
}

function buildLatestRecordMap(records) {
  const latestByLabel = new Map();
  if (!Array.isArray(records)) return latestByLabel;

  for (const record of records) {
    if (!record || !record.labelId) continue;
    const timestamp = record.timestamp ? new Date(record.timestamp).getTime() : 0;
    const existing = latestByLabel.get(record.labelId);
    const existingTimestamp = existing && existing.timestamp ? new Date(existing.timestamp).getTime() : -1;
    if (!existing || timestamp > existingTimestamp) {
      latestByLabel.set(record.labelId, record);
    }
  }

  return latestByLabel;
}

function isLabelInStock(inRec, outRec) {
  const inTime = inRec && inRec.timestamp ? new Date(inRec.timestamp).getTime() : 0;
  const outTime = outRec && outRec.timestamp ? new Date(outRec.timestamp).getTime() : -1;
  return outTime <= inTime;
}

function getFilteredAndSortedRows() {
  const rawQuery = (searchInput?.value || '').trim().toLowerCase();

  let rows = allRows.slice();
  if (rawQuery) {
    const terms = rawQuery.split(/\s+/).filter(Boolean);
    if (terms.length) {
      rows = rows.filter(r => {
        const fieldStrings = [
          r.labelId,
          r.itemName,
          r.itemId,
          r.lotNo,
          r.manufacturingLot,
        ].map(v => String(v || '').toLowerCase());

        return terms.every(term =>
          fieldStrings.some(value => value.includes(term))
        );
      });
    }
  }

  const { key, direction } = currentSort;
  rows.sort((a, b) => compareValues(a[key], b[key], direction));

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


function handleLogout(e) {
  e?.preventDefault();
  localStorage.removeItem('current_user');
  redirectToLogin('stock-list.html');
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
    const ins = safeParseArray(insRaw);
    const outs = safeParseArray(outsRaw);

    const latestInByLabel = buildLatestRecordMap(ins);
    const latestOutByLabel = buildLatestRecordMap(outs);

    const rows = [];
    latestInByLabel.forEach((inRec, labelId) => {
      const outRec = latestOutByLabel.get(labelId);
      if (!isLabelInStock(inRec, outRec)) return; // only current stock

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
  if (!ensureLoggedIn('stock-list.html')) return;
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
