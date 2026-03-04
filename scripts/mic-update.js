'use strict';

const tableBody = document.getElementById('mic-table-body');
const updateBtn = document.getElementById('mic-update-btn');
const cancelBtn = document.getElementById('mic-cancel-btn');
const statusBox = document.getElementById('mic-status');

function showStatus(message, isError = false) {
  if (!statusBox) return;
  if (!message) {
    statusBox.className = 'hidden px-4 py-3 rounded-lg text-sm font-semibold';
    statusBox.textContent = '';
    return;
  }
  statusBox.textContent = message;
  statusBox.className = 'px-4 py-3 rounded-lg text-sm font-semibold ' + (isError ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800');
}

function getOpenerApi() {
  try {
    const opener = window.opener;
    if (!opener) return null;
    if (typeof opener.getMicItemsForUpdate !== 'function') return null;
    if (typeof opener.saveMicQuantities !== 'function') return null;
    return opener;
  } catch {
    return null;
  }
}

function renderRows(items) {
  if (!tableBody) return;
  tableBody.innerHTML = '';

  if (!Array.isArray(items) || !items.length) {
    tableBody.innerHTML = '<tr><td colspan="2" class="py-6 text-center text-gray-500">No items found.</td></tr>';
    return;
  }

  for (const row of items) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'px-4 py-2 whitespace-nowrap text-sm text-gray-700';
    nameTd.textContent = row.itemName || '--';

    const qtyTd = document.createElement('td');
    qtyTd.className = 'px-4 py-2 whitespace-nowrap text-sm text-gray-700';

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.min = '0';
    input.inputMode = 'numeric';
    input.className = 'w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500';
    input.value = (typeof row.micQty === 'number' && Number.isFinite(row.micQty)) ? String(row.micQty) : '';
    input.dataset.itemName = row.itemName || '';

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        updateBtn?.click();
      }
    });

    qtyTd.appendChild(input);
    tr.appendChild(nameTd);
    tr.appendChild(qtyTd);
    tableBody.appendChild(tr);
  }
}

function collectRows() {
  if (!tableBody) return [];
  const inputs = Array.from(tableBody.querySelectorAll('input[data-item-name]'));
  const rows = [];

  for (const input of inputs) {
    const itemName = (input.dataset.itemName || '').trim();
    if (!itemName) continue;

    const raw = String(input.value ?? '').trim();
    if (!raw) continue;

    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { error: `Invalid MIC Quantity for ${itemName}.` };
    }
    if (n < 0) {
      return { error: `MIC Quantity cannot be negative for ${itemName}.` };
    }

    rows.push({ itemName, micQty: n });
  }

  return { rows };
}

function init() {
  const openerApi = getOpenerApi();
  if (!openerApi) {
    showStatus('Cannot access Stock Take window. Please open this window from Stock Take page.', true);
    renderRows([]);
    updateBtn?.setAttribute('disabled', 'disabled');
    return;
  }

  try {
    const items = openerApi.getMicItemsForUpdate();
    renderRows(items);
  } catch (err) {
    console.error('Error loading MIC items:', err);
    showStatus('Failed to load MIC items. See console.', true);
  }

  cancelBtn?.addEventListener('click', () => {
    window.close();
  });

  updateBtn?.addEventListener('click', () => {
    showStatus('', false);
    const result = collectRows();
    if (result && result.error) {
      showStatus(result.error, true);
      return;
    }

    try {
      openerApi.saveMicQuantities(result.rows);
      showStatus('MIC quantities updated.', false);
      try {
        openerApi.focus();
      } catch {
      }
    } catch (err) {
      console.error('Error saving MIC quantities:', err);
      showStatus('Failed to update MIC quantities. See console.', true);
    }
  });
}

window.addEventListener('DOMContentLoaded', init);
