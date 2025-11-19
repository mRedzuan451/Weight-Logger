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
    itemId: r.itemId || '--',
    lotNo: r.lotNo || '--',
    manufacturingLot: r.manufacturingLot || '--',
    weight: typeof r.measuredWeight === 'number' ? r.measuredWeight : null,
    unit: r.unit || '--',
    responsibleUser: r.responsibleUser || '--',
  }));

  const mappedOut = outs.map(r => ({
    type: 'OUT',
    timestamp: r.timestamp || '',
    labelId: r.labelId || '--',
    itemName: r.itemName || '--',
    itemId: r.itemId || '--',
    lotNo: r.lotNo || '--',
    manufacturingLot: r.manufacturingLot || '--',
    weight: typeof r.outWeight === 'number' ? r.outWeight : null,
    unit: r.unit || '--',
    responsibleUser: r.responsibleUser || '--',
  }));

  const all = [...mappedIn, ...mappedOut];
  all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return all;
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

function render(records) {
  const tbody = document.getElementById('admin-records-body');
  statusMessage('');
  tbody.innerHTML = '';
  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="py-6 text-center text-gray-500">No records found.</td></tr>';
    return;
  }
  cachedRecords = records;
  for (const r of records) {
    const tr = document.createElement('tr');
    const date = r.timestamp ? new Date(r.timestamp).toLocaleString() : '--';
    const weight = typeof r.weight === 'number' ? r.weight.toFixed(2) : '--';
    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${date}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold ${r.type === 'IN' ? 'text-green-700' : 'text-red-700'}">${r.type}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.labelId}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.itemName}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.itemId}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.lotNo}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.manufacturingLot}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-blue-700">${weight}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.unit}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${r.responsibleUser}</td>
    `;
    tbody.appendChild(tr);
  }
}

function applyFilter() {
  const [fromStart] = parseDateOnly(document.getElementById('from-date').value);
  const [toStart, toEnd] = parseDateOnly(document.getElementById('to-date').value);
  const start = fromStart ?? null;
  const end = (toStart !== null) ? toEnd : null;

  const all = loadCombinedRecords();
  const filtered = all.filter(r => withinDateRange(r.timestamp, start, end));
  render(filtered);
}

function exportCsv() {
  const records = cachedRecords && cachedRecords.length ? cachedRecords : loadCombinedRecords();
  if (!records.length) {
    alert('No records to export.');
    return;
  }

  const headers = ['Date', 'Type', 'Label ID', 'Item Name', 'Item ID', 'Lot No', 'Manufacturing Lot', 'Weight', 'Unit', 'Responsible'];
  const rows = records.map(r => [
    r.timestamp ? new Date(r.timestamp).toISOString() : '',
    r.type,
    r.labelId,
    r.itemName,
    r.itemId,
    r.lotNo,
    r.manufacturingLot,
    typeof r.weight === 'number' ? r.weight.toFixed(2) : '',
    r.unit,
    r.responsibleUser
  ]);

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

  render(loadCombinedRecords());
});
