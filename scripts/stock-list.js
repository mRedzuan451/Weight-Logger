'use strict';

const bodyEl = document.getElementById('stocklist-body');
const statusBox = document.getElementById('stocklist-status');
const logoutBtn = document.getElementById('logout-btn');

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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

    bodyEl.innerHTML = '';
    if (!rows.length) {
      bodyEl.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-gray-500">No current stock found.</td></tr>';
      return;
    }

    for (const row of rows) {
      const tr = document.createElement('tr');
      const expectedText = row.expectedWeight && !Number.isNaN(row.expectedWeight)
        ? `${Number(row.expectedWeight).toFixed(2)} ${row.unit}`
        : '--';
      tr.innerHTML = `
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.labelId}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.itemName}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.itemId}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.lotNo}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.manufacturingLot}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.quantity}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${expectedText}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${row.unit}</td>
      `;
      bodyEl.appendChild(tr);
    }

    showStatus('Current stock loaded.', false);
  } catch (err) {
    console.error('Error loading stock list:', err);
    showStatus('Failed to load current stock. See console for details.', true);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  logoutBtn?.addEventListener('click', handleLogout);
  loadStockList();
});
