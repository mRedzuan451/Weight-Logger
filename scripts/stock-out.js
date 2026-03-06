// --- State ---
let currentScannedData = null;

const MAX_RECORD_AGE_DAYS = 60;
const MAX_RECORD_AGE_MS = MAX_RECORD_AGE_DAYS * 24 * 60 * 60 * 1000;

// --- DOM ---
const qrInput = document.getElementById('qr-input');
const infoLabelId = document.getElementById('info-label-id');
const infoItemId = document.getElementById('info-item-id');
const infoItemName = document.getElementById('info-item-name');
const infoLotNo = document.getElementById('info-lot-no');
const infoMfgLot = document.getElementById('info-mfg-lot');
const infoQuantity = document.getElementById('info-quantity');
const infoStatus = document.getElementById('info-status');
const saveOutBtn = document.getElementById('save-out-btn');
const statusMessage = document.getElementById('status-message');
const logoutBtn = document.getElementById('logout-btn');
const recentStockOutBody = document.getElementById('recent-stock-out-body');

// --- Utils ---
function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.className = 'status-message';
  statusMessage.classList.add(isError ? 'status-error' : 'status-success');
  statusMessage.style.display = 'block';
  setTimeout(() => (statusMessage.style.display = 'none'), 3000);
}

function getCurrentUser() {
  try {
    const u = localStorage.getItem('current_user');
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

function redirectToLogin() {
  const ret = encodeURIComponent((location.pathname.split('/').pop()) || 'stock-out.html');
  window.location.href = `login.html?return=${ret}`;
}

function ensureLoggedIn() {
  const user = getCurrentUser();
  if (!user || !(user.name || user.username)) {
    redirectToLogin();
    return false;
  }
  return true;
}

function handleLogout(event) {
  if (event) {
    event.preventDefault();
  }
  localStorage.removeItem('current_user');
  redirectToLogin();
}

function parseScanned(raw) {
  const data = (raw || '').trim();
  if (!data) return null;
  if (!data.startsWith('{')) {
    return {
      labelId: data,
      itemId: '--',
      itemName: '--',
      lotNo: '--',
      manufacturingLot: '--',
      quantity: '--',
      originalQrData: data,
    };
  }
  try {
    const parsed = JSON.parse(data);
    if (parsed.id && parsed.item && parsed.name) {
      let quantity = '--';
      let lotNo = '--';
      if (parsed.detail && parsed.detail.length > 0) {
        const parts = parsed.detail[0].split(',');
        if (parts.length >= 4) lotNo = parts[3];
        if (parts.length >= 5) quantity = String(parseFloat(parts[4]));
      }
      return {
        labelId: parsed.id,
        itemId: parsed.item,
        itemName: parsed.name,
        lotNo,
        manufacturingLot: parsed.mfglot,
        quantity,
        originalQrData: parsed,
      };
    }
  } catch (e) {}
  // Fallback to plain
  return {
    labelId: data,
    itemId: '--',
    itemName: '--',
    lotNo: '--',
    manufacturingLot: '--',
    quantity: '--',
    originalQrData: data,
  };
}

function pruneRecords(records) {
  if (!Array.isArray(records)) return [];
  const cutoff = Date.now() - MAX_RECORD_AGE_MS;
  return records.filter(record => {
    if (!record || !record.timestamp) return true;
    const t = new Date(record.timestamp).getTime();
    return Number.isNaN(t) || t >= cutoff;
  });
}

function readLocal(name) {
  try {
    const text = localStorage.getItem(name);
    const records = text ? JSON.parse(text) : [];
    const pruned = pruneRecords(records);
    if (pruned.length !== records.length) {
      localStorage.setItem(name, JSON.stringify(pruned));
    }
    return pruned;
  } catch (e) {
    return [];
  }
}

function writeLocal(name, value) {
  const pruned = pruneRecords(value);
  localStorage.setItem(name, JSON.stringify(pruned));
}

function renderRecentStockOutRecords() {
  if (!recentStockOutBody) return;
  const outs = readLocal('stock_out_records');
  if (!Array.isArray(outs) || outs.length === 0) {
    recentStockOutBody.innerHTML = `
      <tr>
        <td colspan="9" class="py-6 text-center text-gray-500">No records found.</td>
      </tr>`;
    return;
  }

  const sorted = outs.slice().sort((a, b) => {
    const ta = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  const recent = sorted.slice(0, 5);
  recentStockOutBody.innerHTML = '';

  for (const record of recent) {
    const row = document.createElement('tr');
    const date = record?.timestamp ? new Date(record.timestamp).toLocaleString() : '--';
    const status = (record?.status || '').toUpperCase() || 'OUT';
    row.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${date}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record?.labelId || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record?.itemName || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record?.itemId || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record?.lotNo || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record?.manufacturingLot || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record?.quantity || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${record?.responsibleUser || '--'}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-blue-700">${status}</td>
    `;
    recentStockOutBody.appendChild(row);
  }
}

function updateInfo(scanned) {
  infoLabelId.textContent = scanned?.labelId || '--';
  infoItemId.textContent = scanned?.itemId || '--';
  infoItemName.textContent = scanned?.itemName || '--';
  infoLotNo.textContent = scanned?.lotNo || '--';
  infoMfgLot.textContent = scanned?.manufacturingLot || '--';
  infoQuantity.textContent = scanned?.quantity || '--';
}

function getStatusForLabel(labelId) {
  if (!labelId) return 'Scan an item';
  const outs = readLocal('stock_out_records');
  const ins = readLocal('weight_records');

  let latestInTime = -Infinity;
  let latestOutTime = -Infinity;
  let hasIn = false;
  let hasOut = false;

  for (const rec of ins) {
    if (!rec || rec.labelId !== labelId) continue;
    hasIn = true;
    const t = rec.timestamp ? new Date(rec.timestamp).getTime() : 0;
    if (!Number.isNaN(t) && t > latestInTime) latestInTime = t;
  }

  for (const rec of outs) {
    if (!rec || rec.labelId !== labelId) continue;
    hasOut = true;
    const t = rec.timestamp ? new Date(rec.timestamp).getTime() : 0;
    if (!Number.isNaN(t) && t > latestOutTime) latestOutTime = t;
  }

  if (!hasIn && !hasOut) return 'Not Found';
  if (hasIn && (!hasOut || latestInTime > latestOutTime)) return 'In Stock';
  if (hasOut && (!hasIn || latestOutTime >= latestInTime)) return 'Out of Stock';
  return 'Not Found';
}

function updateStatusMessage(labelId) {
  const statusText = getStatusForLabel(labelId);
  infoStatus.textContent = statusText;
  saveOutBtn.disabled = statusText !== 'In Stock';
}

// --- Events ---
qrInput.addEventListener('click', (e) => {
  e.target.value = '';
  e.target.classList.remove('border-red-500', 'ring-red-300');
});
qrInput.addEventListener('change', (e) => {
  const data = e.target.value;
  if (!data) {
    showStatus('Scan is empty. Click the box and scan the code again.', true);
    qrInput.classList.add('border-red-500', 'ring-red-300');
    return;
  }
  const scanned = parseScanned(data);
  if (!scanned) {
    showStatus('Unable to read scanned code.', true);
    qrInput.classList.add('border-red-500', 'ring-red-300');
    return;
  }

  // Attempt to resolve against the latest stock-in record using unique labelId
  let resolved = scanned;
  if (scanned.labelId && scanned.labelId !== '--') {
    const ins = readLocal('weight_records');
    let latest = null;
    let latestTime = -Infinity;
    for (const rec of ins) {
      if (!rec || rec.labelId !== scanned.labelId) continue;
      const t = rec.timestamp ? new Date(rec.timestamp).getTime() : 0;
      if (!Number.isNaN(t) && t > latestTime) {
        latest = rec;
        latestTime = t;
      }
    }

    if (latest) {
      resolved = {
        labelId: latest.labelId,
        itemId: latest.itemId,
        itemName: latest.itemName,
        lotNo: latest.lotNo,
        manufacturingLot: latest.manufacturingLot,
        quantity: latest.quantity,
        originalQrData: scanned.originalQrData ?? scanned,
      };
    } else {
      showStatus('No stock-in record found for this label. It may not be in stock.', true);
      qrInput.classList.add('border-red-500', 'ring-red-300');
    }
  } else {
    showStatus('Scanned code missing label ID.', true);
    qrInput.classList.add('border-red-500', 'ring-red-300');
  }

  currentScannedData = resolved;
  updateInfo(currentScannedData);
  updateStatusMessage(currentScannedData?.labelId);
  showStatus('Code scanned.', false);
  qrInput.classList.remove('border-red-500', 'ring-red-300');
  e.target.value = '';
});

saveOutBtn.addEventListener('click', () => {
  if (!currentScannedData || !currentScannedData.labelId) {
    showStatus('Scan an item with a valid label ID before saving.', true);
    qrInput.focus();
    qrInput.classList.add('border-red-500', 'ring-red-300');
    return;
  }

  const statusText = getStatusForLabel(currentScannedData.labelId);
  if (statusText !== 'In Stock') {
    showStatus('This label is not currently in stock and cannot be marked out.', true);
    updateStatusMessage(currentScannedData.labelId);
    return;
  }

  // Save record
  const outs = readLocal('stock_out_records');
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showStatus('Please login before saving.', true);
    redirectToLogin();
    return;
  }
  outs.push({
    ...currentScannedData,
    outWeight: null,
    unit: null,
    timestamp: new Date().toISOString(),
    responsibleUser: currentUser.displayName || currentUser.name || currentUser.username || '',
    status: 'OUT'
  });
  writeLocal('stock_out_records', outs);

  renderRecentStockOutRecords();

  showStatus('Package marked as out of stock.', false);
  infoStatus.textContent = 'Out of Stock';
  saveOutBtn.disabled = true;
  // Refresh status so subsequent scans respect latest data
  updateStatusMessage(currentScannedData.labelId);
  qrInput.focus();
});

// Focus QR input on load
window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  logoutBtn?.addEventListener('click', handleLogout);
  renderRecentStockOutRecords();
  qrInput.focus();
});

// --- Web Serial (Scale) Integration ---

// --- CSV Export for Stock-Out ---
const exportCsvBtn = document.getElementById('export-csv-btn');
exportCsvBtn?.addEventListener('click', exportStockOutCsv);

function exportStockOutCsv() {
  const outs = readLocal('stock_out_records');
  const prunedOuts = pruneRecords(outs);
  if (!prunedOuts || prunedOuts.length === 0) {
    showStatus('No stock-out records to export.', true);
    return;
  }
  const headers = ['Date', 'Label ID', 'Item Name', 'Item ID', 'Lot No', 'Manufacturing Lot', 'Responsible', 'Status'];
  const rows = prunedOuts.map(r => [
    r.timestamp ? new Date(r.timestamp).toISOString() : '',
    r.labelId || '',
    r.itemName || '',
    r.itemId || '',
    r.lotNo || '',
    r.manufacturingLot || '',
    r.responsibleUser || '',
    r.status || 'OUT'
  ]);
  const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stock-out-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showStatus('Stock-out CSV exported.', false);
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Expose helper for records page if needed
window.StockOutHelpers = {
  readLocal,
  escapeCsv,
  exportStockOutCsv,
};
