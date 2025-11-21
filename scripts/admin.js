'use strict';

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const MAX_RECORD_AGE_DAYS = 60;
const MAX_RECORD_AGE_MS = MAX_RECORD_AGE_DAYS * 24 * 60 * 60 * 1000;
const STOCK_TAKE_HISTORY_KEY = 'stock_take_history';

let currentView = 'movement'; // 'movement' | 'stocktake'
let adminSort = { key: 'timestamp', direction: 'desc' };

function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // Legacy fallback for old records
  const name = (user.name || '').trim().toLowerCase();
  const id = (user.employeeId || user.username || '').trim();
  return name === 'admin' && id === '1234';
}

function redirectToLogin() {
  window.location.href = 'login.html?return=admin.html';
}

function redirectToMenu() {
  window.location.href = 'menu.html';
}

function handleLogout(e) {
  e?.preventDefault();
  localStorage.removeItem('current_user');
  redirectToLogin();
}

function pruneRecords(records) {
  if (!Array.isArray(records)) return [];
  const cutoff = Date.now() - MAX_RECORD_AGE_MS;
  return records.filter(record => {
    if (!record || !record.timestamp) return true;
    const time = new Date(record.timestamp).getTime();
    return Number.isNaN(time) || time >= cutoff;
  });
}

function readLocal(key) {
  try {
    const t = localStorage.getItem(key);
    const parsed = t ? JSON.parse(t) : [];
    const pruned = pruneRecords(parsed);
    if (pruned.length !== parsed.length) {
      localStorage.setItem(key, JSON.stringify(pruned));
    }
    return pruned;
  } catch {
    return [];
  }
}

let cachedRecords = [];

function loadCombinedRecords() {
  const ins = readLocal('weight_records');
  const outs = readLocal('stock_out_records');

  const mappedIn = ins.map(r => ({
    type: 'IN',
    timestamp: r.timestamp || '',
    labelId: r.labelId || '--',
    itemName: r.itemName || '--',
    quantity: r.quantity || '',
    weight: typeof r.measuredWeight === 'number' ? r.measuredWeight : null,
    unit: r.unit || '--',
    responsibleUser: r.responsibleUser || '--',
  }));

  const mappedOut = outs.map(r => ({
    type: 'OUT',
    timestamp: r.timestamp || '',
    labelId: r.labelId || '--',
    itemName: r.itemName || '--',
    quantity: r.quantity || '',
    weight: typeof r.outWeight === 'number' ? r.outWeight : null,
    unit: r.unit || '--',
    responsibleUser: r.responsibleUser || '--',
  }));

  const all = [...mappedIn, ...mappedOut];
  all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return all;
}

function loadStockTakeHistory() {
  try {
    const raw = localStorage.getItem(STOCK_TAKE_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const pruned = pruneRecords(parsed);
    if (pruned.length !== parsed.length) {
      localStorage.setItem(STOCK_TAKE_HISTORY_KEY, JSON.stringify(pruned));
    }
    return pruned;
  } catch {
    return [];
  }
}

function withinDateRange(ts, fromDate, toDate) {
  if (!ts) return false;
  const time = new Date(ts).getTime();
  if (isNaN(time)) return false;
  if (fromDate && time < fromDate) return false;
  if (toDate && time > toDate) return false;
  return true;
}

function parseDateOnly(d) {
  // Returns [startMillis, endMillis] for the date
  if (!d) return [null, null];
  const date = new Date(d + 'T00:00:00');
  if (isNaN(date.getTime())) return [null, null];
  const start = date.getTime();
  const end = start + 24 * 60 * 60 * 1000 - 1; // inclusive end of day
  return [start, end];
}

function setHeaderForMovement() {
  const headerRow = document.getElementById('admin-header-row');
  if (!headerRow) return;
  headerRow.innerHTML = `
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Date</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Label ID</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Item Name</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Quantity</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Weight</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Unit</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Responsible</th>
  `;
}

function setHeaderForStockTake() {
  const headerRow = document.getElementById('admin-header-row');
  if (!headerRow) return;
  headerRow.innerHTML = `
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Date</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Label ID</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Item Name</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Qty Before</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Weight Before</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Qty After</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Weight After</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Difference</th>
    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Responsible</th>
  `;
}

const movementSortKeys = ['timestamp', 'type', 'labelId', 'itemName', 'quantity', 'weight', 'unit', 'responsibleUser'];
const stockTakeSortKeysAdmin = ['timestamp', 'labelId', 'itemName', 'quantityBefore', 'weightBefore', 'quantityAfter', 'weightAfter', 'diff', 'responsibleUser'];

function getCurrentSortKeys() {
  return currentView === 'stocktake' ? stockTakeSortKeysAdmin : movementSortKeys;
}

function setAdminSort(key) {
  if (adminSort.key === key) {
    adminSort.direction = adminSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    adminSort = { key, direction: 'asc' };
  }
  const base = (cachedRecords && cachedRecords.length)
    ? cachedRecords
    : (currentView === 'stocktake' ? loadStockTakeHistory() : loadCombinedRecords());
  render(base);
}

function sortRecords(records) {
  if (!Array.isArray(records) || !records.length) return records;
  const { key, direction } = adminSort || {};
  if (!key) return records;

  const sorted = records.slice();
  sorted.sort((a, b) => {
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
  return sorted;
}

function updateAdminSortIndicators() {
  const headerRow = document.getElementById('admin-header-row');
  if (!headerRow) return;
  const ths = Array.from(headerRow.querySelectorAll('th'));
  const sortKeys = getCurrentSortKeys();
  ths.forEach((th, index) => {
    const key = sortKeys[index];
    if (!key) return;
    const baseLabel = th.dataset.baseLabel || th.textContent.replace(/[▲▼]/g, '').trim();
    th.dataset.baseLabel = baseLabel;

    if (key === adminSort.key) {
      const arrow = adminSort.direction === 'asc' ? '▲' : '▼';
      th.textContent = baseLabel + ' ' + arrow;
    } else {
      th.textContent = baseLabel;
    }
    th.classList.add('cursor-pointer', 'select-none');
  });
}

function setupAdminSortHeaders() {
  const headerRow = document.getElementById('admin-header-row');
  if (!headerRow) return;
  const ths = Array.from(headerRow.querySelectorAll('th'));
  const sortKeys = getCurrentSortKeys();
  ths.forEach((th, index) => {
    const key = sortKeys[index];
    if (!key) return;
    th.addEventListener('click', () => setAdminSort(key));
  });
  updateAdminSortIndicators();
}

function setView(view) {
  currentView = view === 'stocktake' ? 'stocktake' : 'movement';
  if (currentView === 'stocktake') {
    setHeaderForStockTake();
  } else {
    setHeaderForMovement();
  }

  setupAdminSortHeaders();

  const fromDateEl = document.getElementById('from-date');
  const toDateEl = document.getElementById('to-date');
  const searchEl = document.getElementById('admin-search');
  const hasSearch = !!(searchEl && searchEl.value && searchEl.value.trim());
  if ((fromDateEl && fromDateEl.value) || (toDateEl && toDateEl.value) || hasSearch) {
    applyFilter();
  } else {
    const records = currentView === 'stocktake' ? loadStockTakeHistory() : loadCombinedRecords();
    render(records);
  }
}

function render(records) {
  const tbody = document.getElementById('admin-records-body');
  statusMessage('');
  tbody.innerHTML = '';
  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="py-6 text-center text-gray-500">No records found.</td></tr>';
    return;
  }
  const sortedRecords = sortRecords(records);
  cachedRecords = sortedRecords;

  if (currentView === 'stocktake') {
    for (const r of sortedRecords) {
      const tr = document.createElement('tr');
      const date = r.timestamp ? new Date(r.timestamp).toLocaleString() : '--';
      const qtyBeforeText = typeof r.quantityBefore === 'number' && !Number.isNaN(r.quantityBefore)
        ? r.quantityBefore.toFixed(0)
        : '--';
      const qtyAfterText = typeof r.quantityAfter === 'number' && !Number.isNaN(r.quantityAfter)
        ? r.quantityAfter.toFixed(0)
        : '--';
      const beforeText = typeof r.weightBefore === 'number'
        ? `${r.weightBefore.toFixed(2)} ${r.unitBefore || 'g'}`
        : '--';
      const afterText = typeof r.weightAfter === 'number'
        ? `${r.weightAfter.toFixed(2)} ${r.unitAfter || 'g'}`
        : '--';
      const diff = (typeof r.weightBefore === 'number' && typeof r.weightAfter === 'number')
        ? (r.weightAfter - r.weightBefore)
        : null;
      const diffText = typeof diff === 'number' && !Number.isNaN(diff)
        ? `${diff.toFixed(2)} g`
        : '--';
      const diffClass = typeof diff === 'number' && !Number.isNaN(diff) && Math.abs(diff) > 5
        ? 'text-red-600'
        : 'text-gray-700';

      tr.innerHTML = `
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${date}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.labelId || '--'}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.itemName || '--'}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${qtyBeforeText}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${beforeText}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${qtyAfterText}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${afterText}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm ${diffClass}">${diffText}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.responsibleUser || '--'}</td>
      `;
      tbody.appendChild(tr);
    }
    return;
  }

  for (const r of sortedRecords) {
    const tr = document.createElement('tr');
    const date = r.timestamp ? new Date(r.timestamp).toLocaleString() : '--';
    const weight = typeof r.weight === 'number' ? r.weight.toFixed(2) : '--';
    const typeColor = r.type === 'IN' ? '#047857' : '#b91c1c'; // green vs red
    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${date}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold" style="color: ${typeColor};">${r.type}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.labelId}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.itemName}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.quantity || ''}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-blue-700">${weight}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.unit}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.responsibleUser}</td>
    `;
    tbody.appendChild(tr);
  }

  updateAdminSortIndicators();
}

function applyFilter() {
  const [fromStart] = parseDateOnly(document.getElementById('from-date').value);
  const [toStart, toEnd] = parseDateOnly(document.getElementById('to-date').value);
  const start = fromStart ?? null;
  const end = (toStart !== null) ? toEnd : null;
  const searchInput = document.getElementById('admin-search');
  const query = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();

  const all = currentView === 'stocktake' ? loadStockTakeHistory() : loadCombinedRecords();
  let filtered = all.filter(r => withinDateRange(r.timestamp, start, end));

  if (query) {
    filtered = filtered.filter(r => {
      const fields = [
        r.labelId,
        r.itemName,
        r.quantity,
        r.responsibleUser,
        r.type,
      ];
      return fields.some(f => String(f || '').toLowerCase().includes(query));
    });
  }

  render(filtered);
}

function exportCsv() {
  const base = currentView === 'stocktake' ? loadStockTakeHistory() : loadCombinedRecords();
  const records = cachedRecords && cachedRecords.length ? cachedRecords : base;
  if (!records.length) {
    alert('No records to export.');
    return;
  }

  let headers;
  let rows;
  if (currentView === 'stocktake') {
    headers = ['Date', 'Label ID', 'Item Name', 'Qty Before', 'Weight Before', 'Qty After', 'Weight After', 'Difference', 'Responsible'];
    rows = records.map(r => {
      const diff = (typeof r.weightBefore === 'number' && typeof r.weightAfter === 'number')
        ? (r.weightAfter - r.weightBefore)
        : null;
      return [
        r.timestamp ? new Date(r.timestamp).toISOString() : '',
        r.labelId || '',
        r.itemName || '',
        typeof r.quantityBefore === 'number' ? r.quantityBefore.toFixed(0) : '',
        typeof r.weightBefore === 'number' ? r.weightBefore.toFixed(2) : '',
        typeof r.quantityAfter === 'number' ? r.quantityAfter.toFixed(0) : '',
        typeof r.weightAfter === 'number' ? r.weightAfter.toFixed(2) : '',
        typeof diff === 'number' ? diff.toFixed(2) : '',
        r.responsibleUser || '',
      ];
    });
  } else {
    headers = ['Date', 'Type', 'Label ID', 'Item Name', 'Quantity', 'Weight', 'Unit', 'Responsible'];
    rows = records.map(r => [
      r.timestamp ? new Date(r.timestamp).toISOString() : '',
      r.type,
      r.labelId,
      r.itemName,
      r.quantity || '',
      typeof r.weight === 'number' ? r.weight.toFixed(2) : '',
      r.unit,
      r.responsibleUser
    ]);
  }

  const csv = [headers, ...rows]
    .map(row => row.map(escapeCsv).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `admin-history-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function statusMessage(message, isError = false) {
  const box = document.getElementById('admin-status');
  if (!box) return;
  if (!message) {
    box.style.display = 'none';
    box.textContent = '';
    box.className = 'status-message';
    return;
  }
  box.textContent = message;
  box.className = 'status-message ' + (isError ? 'status-error' : 'status-success');
  box.style.display = 'block';
  setTimeout(() => {
    box.style.display = 'none';
  }, 3000);
}

function clearAllData() {
  if (!confirm('This will remove ALL stock-in and stock-out records. Continue?')) return;
  try {
    localStorage.removeItem('weight_records');
    localStorage.removeItem('stock_out_records');
    cachedRecords = [];
    render([]);
    statusMessage('All records cleared.');
  } catch (error) {
    console.error('Failed to clear records:', error);
    statusMessage('Failed to clear records. Check console.', true);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();
  if (!user) {
    redirectToLogin();
    return;
  }
  if (!isAdmin(user)) {
    redirectToMenu();
    return;
  }

  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('apply-filter')?.addEventListener('click', applyFilter);
  document.getElementById('clear-filter')?.addEventListener('click', () => {
    document.getElementById('from-date').value = '';
    document.getElementById('to-date').value = '';
    render(loadCombinedRecords());
  });
  document.getElementById('export-csv')?.addEventListener('click', exportCsv);
  document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
  document.getElementById('view-movement-btn')?.addEventListener('click', () => setView('movement'));
  document.getElementById('view-stocktake-btn')?.addEventListener('click', () => setView('stocktake'));

  const searchInput = document.getElementById('admin-search');
  if (searchInput) {
    searchInput.addEventListener('input', applyFilter);
  }

  setHeaderForMovement();
  setupAdminSortHeaders();
  render(loadCombinedRecords());
});
