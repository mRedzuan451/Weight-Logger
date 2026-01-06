'use strict';

const SCALE_SERIAL_OPTIONS = {
  baudRate: 2400,
  dataBits: 7,
  stopBits: 1,
  parity: 'even',
};

const PREFERRED_SCALE_IDS = [
  { usbVendorId: 0x0557, usbProductId: 0x2008 },
  { usbVendorId: 0x0557, usbProductId: 0x2011 },
];

function getPreferredScaleIds() {
  try {
    const raw = localStorage.getItem('preferred_scale_ids');
    const parsed = raw ? JSON.parse(raw) : [];
    const saved = Array.isArray(parsed)
      ? parsed
        .map((p) => ({
          usbVendorId: typeof p?.usbVendorId === 'number' ? p.usbVendorId : null,
          usbProductId: typeof p?.usbProductId === 'number' ? p.usbProductId : null,
        }))
        .filter((p) => typeof p.usbVendorId === 'number' && typeof p.usbProductId === 'number')
      : [];

    const combined = [...saved, ...PREFERRED_SCALE_IDS];
    const seen = new Set();
    return combined.filter((p) => {
      const key = `${p.usbVendorId}:${p.usbProductId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [...PREFERRED_SCALE_IDS];
  }
}

let scalePort = null;
let scaleReader = null;
let keepReadingScale = false;
let currentWeight = 0;
let scaleConnectInProgress = false;
const DEFAULT_STOCK_TAKE_TOLERANCE_GRAMS = 5;
let stockTakeToleranceGrams = DEFAULT_STOCK_TAKE_TOLERANCE_GRAMS;
const GLOBAL_STOCK_TAKE_TOLERANCE_KEY = 'global_stock_take_tolerance_grams';
const GLOBAL_STOCK_TAKE_DIFF_LIMIT_KEY = 'global_stock_take_diff_limit_grams';
let stockTakeDiffLimitGrams = null;
let lastDiffLimitPromptKey = '';
let diffLimitPromptArmed = false;
const STOCK_TAKE_STATE_KEY = 'stock_take_state';
const STOCK_TAKE_HISTORY_KEY = 'stock_take_history';

const connectScaleBtn = document.getElementById('connect-scale-btn');
const disconnectScaleBtn = document.getElementById('disconnect-scale-btn');
const scaleStatus = document.getElementById('scale-status');
const scaleRawData = document.getElementById('scale-raw-data');

const qrInput = document.getElementById('qr-input');
const infoLabelId = document.getElementById('info-label-id');
const infoItemName = document.getElementById('info-item-name');
const infoStatus = document.getElementById('info-status');
const infoExpected = document.getElementById('info-expected');
const infoActual = document.getElementById('info-actual');
const infoDiff = document.getElementById('info-diff');
const statusBox = document.getElementById('stocktake-status');
const logoutBtn = document.getElementById('logout-btn');
const tableBody = document.getElementById('stocktake-table-body');
const exportBtn = document.getElementById('stocktake-export-btn');
const applyBtn = document.getElementById('stocktake-apply-btn');
const printBtn = document.getElementById('stocktake-print-btn');
const confirmModal = document.getElementById('confirm-modal');
const confirmModalOkBtn = document.getElementById('confirm-modal-ok');
const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel');

let stockItems = [];
let stockTakeSort = { key: 'labelId', direction: 'asc' };
let stockTakeHeaderCells = [];
const stockTakeSortKeys = ['labelId', 'itemName', 'expectedQty', 'expectedWeight', 'actualQty', 'actualWeight', 'diff'];

let qrScanBuffer = '';
let qrScanBufferTimer = null;
const DEBUG_QR_FOCUS = false;

let pendingScaleCompareForScan = false;

function ensureQrInputInteractive() {
  if (!qrInput) return;
  qrInput.disabled = false;
  qrInput.readOnly = false;
  try {
    qrInput.removeAttribute('disabled');
    qrInput.removeAttribute('readonly');
    qrInput.style.pointerEvents = 'auto';
  } catch {
  }
}

function refocusQrInputSoon() {
  try {
    ensureQrInputInteractive();
  } catch {
  }
  setTimeout(() => {
    try {
      // Explicitly bring the window and QR input back into focus.
      try {
        window.focus();
      } catch {
      }
      ensureQrInputInteractive();
      try {
        if (DEBUG_QR_FOCUS) {
          console.log('[stock-take] refocusQrInputSoon: before focus', {
            disabled: qrInput?.disabled,
            readOnly: qrInput?.readOnly,
            activeElementId: document?.activeElement?.id,
            activeElementTag: document?.activeElement?.tagName,
          });
        }
      } catch {
      }
      qrInput?.focus();
      try {
        if (DEBUG_QR_FOCUS) {
          console.log('[stock-take] refocusQrInputSoon: after focus', {
            disabled: qrInput?.disabled,
            readOnly: qrInput?.readOnly,
            activeElementId: document?.activeElement?.id,
            activeElementTag: document?.activeElement?.tagName,
          });
        }
      } catch {
      }
    } catch {
    }
  }, 0);
}

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

function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const name = (user.name || '').trim().toLowerCase();
  const id = (user.employeeId || user.username || '').trim();
  return name === 'admin' && id === '1234';
}

function refreshStockTakeTolerance() {
  try {
    const raw = localStorage.getItem(GLOBAL_STOCK_TAKE_TOLERANCE_KEY);
    if (raw === null || raw === '') {
      stockTakeToleranceGrams = DEFAULT_STOCK_TAKE_TOLERANCE_GRAMS;
      return;
    }
    const parsed = Number(raw);
    stockTakeToleranceGrams = (Number.isFinite(parsed) && parsed >= 0)
      ? parsed
      : DEFAULT_STOCK_TAKE_TOLERANCE_GRAMS;
  } catch {
    stockTakeToleranceGrams = DEFAULT_STOCK_TAKE_TOLERANCE_GRAMS;
  }
}

function refreshStockTakeDiffLimit() {
  try {
    const raw = localStorage.getItem(GLOBAL_STOCK_TAKE_DIFF_LIMIT_KEY);
    if (raw === null || raw === '') {
      stockTakeDiffLimitGrams = null;
      return;
    }
    const parsed = Number(raw);
    stockTakeDiffLimitGrams = (Number.isFinite(parsed) && parsed >= 0) ? parsed : null;
  } catch {
    stockTakeDiffLimitGrams = null;
  }
}

let weightRecordsCache = null;
let stockOutRecordsCache = null;
let stockTakeHistoryCache = null;

function safeParseArray(text) {
  try {
    const parsed = text ? JSON.parse(text) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getWeightRecordsArray() {
  if (!weightRecordsCache) {
    const raw = localStorage.getItem('weight_records');
    weightRecordsCache = safeParseArray(raw);
  }
  return weightRecordsCache;
}

function saveWeightRecordsArray(records) {
  const arr = Array.isArray(records) ? records : [];
  weightRecordsCache = arr;
  try {
    localStorage.setItem('weight_records', JSON.stringify(arr));
  } catch (err) {
    console.error('Error saving weight_records:', err);
  }
}

function getStockOutRecordsArray() {
  if (!stockOutRecordsCache) {
    const raw = localStorage.getItem('stock_out_records');
    stockOutRecordsCache = safeParseArray(raw);
  }
  return stockOutRecordsCache;
}

function getStockTakeHistoryArray() {
  if (!stockTakeHistoryCache) {
    const raw = localStorage.getItem(STOCK_TAKE_HISTORY_KEY);
    stockTakeHistoryCache = safeParseArray(raw);
  }
  return stockTakeHistoryCache;
}

function saveStockTakeHistoryArray(records) {
  const arr = Array.isArray(records) ? records : [];
  stockTakeHistoryCache = arr;
  try {
    localStorage.setItem(STOCK_TAKE_HISTORY_KEY, JSON.stringify(arr));
  } catch (err) {
    console.error('Error saving stock_take_history:', err);
  }
}

function applyStockTakeUpdates() {
  try {
    if (!stockItems.length) {
      showStatus('No in-stock items to update.', true);
      refocusQrInputSoon();
      return;
    }

    if (typeof stockTakeDiffLimitGrams === 'number') {
      const overLimit = stockItems.some(item => (
        typeof item?.actualWeight === 'number'
        && !Number.isNaN(item.actualWeight)
        && typeof item?.diff === 'number'
        && !Number.isNaN(item.diff)
        && Math.abs(item.diff) > stockTakeDiffLimitGrams
      ));
      if (overLimit) {
        const currentUser = getCurrentUser();
        if (!isAdmin(currentUser)) {
          try {
            if (DEBUG_QR_FOCUS) {
              console.log('[stock-take] applyStockTakeUpdates blocked (non-admin, over diff limit): before alert', {
                disabled: qrInput?.disabled,
                readOnly: qrInput?.readOnly,
                activeElementId: document?.activeElement?.id,
                activeElementTag: document?.activeElement?.tagName,
              });
            }
          } catch {
          }
          alert('Some items exceed the allowable difference limit. Please ask your superior/admin to confirm and perform the stock take update.');
          showStatus('Update cancelled: authorization required (items exceed allowable difference limit).', true);
          try {
            ensureQrInputInteractive();
            try {
              window.focus();
            } catch {
            }
            qrInput?.focus();
          } catch {
          }
          try {
            if (DEBUG_QR_FOCUS) {
              console.log('[stock-take] applyStockTakeUpdates blocked (non-admin, over diff limit): after focus attempt', {
                disabled: qrInput?.disabled,
                readOnly: qrInput?.readOnly,
                activeElementId: document?.activeElement?.id,
                activeElementTag: document?.activeElement?.tagName,
              });
            }
          } catch {
          }
          refocusQrInputSoon();
          return;
        }
      }
    }

    // Only consider labels where we have an actual measured weight
    const updatedLabels = new Map();
    for (const item of stockItems) {
      if (typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)) {
        updatedLabels.set(item.labelId, item.actualWeight);
      }
    }

    if (!updatedLabels.size) {
      showStatus('No items have an actual weight recorded to update.', true);
      refocusQrInputSoon();
      return;
    }

    const overLimit = (typeof stockTakeDiffLimitGrams === 'number')
      ? stockItems.some(item => (
        typeof item?.actualWeight === 'number'
        && !Number.isNaN(item.actualWeight)
        && typeof item?.diff === 'number'
        && !Number.isNaN(item.diff)
        && Math.abs(item.diff) > stockTakeDiffLimitGrams
      ))
      : false;

    const popup = window.open('', 'stockTakeUpdateConfirm', 'width=520,height=360,resizable=yes,scrollbars=yes');
    if (!popup) {
      alert('Unable to open confirmation window. Please allow popups for this app.');
      refocusQrInputSoon();
      return;
    }

    const warning = overLimit && typeof stockTakeDiffLimitGrams === 'number'
      ? `Some items exceed allowable difference limit (${formatNumber(stockTakeDiffLimitGrams, 2)}g).`
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>Confirm Update</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 16px; color: #111827; }
          h1 { font-size: 16pt; margin: 0 0 10px 0; }
          .muted { color: #6b7280; font-size: 10pt; }
          .box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #f9fafb; }
          .warn { color: #991b1b; font-weight: 700; margin-top: 8px; }
          .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
          button { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid #d1d5db; background: #ffffff; cursor: pointer; }
          button.primary { background: #2563eb; border-color: #2563eb; color: #ffffff; }
        </style>
      </head>
      <body>
        <h1>Confirm Stock Take Update</h1>
        <div class="box">
          <div>Apply updates for <b>${updatedLabels.size}</b> label(s)?</div>
          <div class="muted">This will overwrite the latest IN record weights and add a stock-take history entry.</div>
          ${warning ? `<div class="warn">${warning}</div>` : ''}
        </div>
        <div class="actions">
          <button type="button" onclick="window.close()">Cancel</button>
          <button class="primary" type="button" onclick="try { window.opener && window.opener.executeStockTakeUpdates && window.opener.executeStockTakeUpdates(); } catch (e) {} window.close();">Confirm</button>
        </div>
      </body>
      </html>
    `;

    try {
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      popup.focus();
    } catch {
      try { popup.close(); } catch {}
      alert('Failed to open confirmation window.');
      refocusQrInputSoon();
      return;
    }
  } catch (err) {
    console.error('Error preparing stock take updates:', err);
    showStatus('Error preparing updates. See console.', true);
  }
}

function executeStockTakeUpdates() {
  let didApply = false;
  try {
    // Hide modal first
    if (confirmModal) {
      confirmModal.classList.add('hidden');
    }

    if (typeof stockTakeDiffLimitGrams === 'number') {
      const overLimit = stockItems.some(item => (
        typeof item?.actualWeight === 'number'
        && !Number.isNaN(item.actualWeight)
        && typeof item?.diff === 'number'
        && !Number.isNaN(item.diff)
        && Math.abs(item.diff) > stockTakeDiffLimitGrams
      ));
      if (overLimit) {
        const currentUser = getCurrentUser();
        if (!isAdmin(currentUser)) {
          alert('Some items exceed the allowable difference limit. Please ask your superior/admin to confirm and perform the stock take update.');
          showStatus('Update cancelled: authorization required (items exceed allowable difference limit).', true);
          try {
            ensureQrInputInteractive();
            try {
              window.focus();
            } catch {
            }
            qrInput?.focus();
          } catch {
          }
          refocusQrInputSoon();
          return;
        }
      }
    }

    // Re-validate just in case
    const updatedLabels = new Map();
    for (const item of stockItems) {
      if (typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)) {
        updatedLabels.set(item.labelId, item.actualWeight);
      }
    }
    if (!updatedLabels.size) return;

    const currentUser = getCurrentUser();

    let ins = getWeightRecordsArray();
    if (!Array.isArray(ins)) ins = [];

    // Find latest IN record index per label for labels we are updating
    const latestIndexByLabel = new Map();
    for (let i = 0; i < ins.length; i++) {
      const r = ins[i];
      if (!r || !r.labelId) continue;
      if (!updatedLabels.has(r.labelId)) continue;
      const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
      const existingIndex = latestIndexByLabel.get(r.labelId);
      if (existingIndex === undefined) {
        latestIndexByLabel.set(r.labelId, i);
      } else {
        const existing = ins[existingIndex];
        const existingT = existing && existing.timestamp ? new Date(existing.timestamp).getTime() : -1;
        if (t > existingT) {
          latestIndexByLabel.set(r.labelId, i);
        }
      }
    }

    if (!latestIndexByLabel.size) {
      alert('No matching stock-in records found to update.');
      return;
    }

    // Apply new weights (stored in grams) to the latest IN records and log history
    const historyEntries = [];
    latestIndexByLabel.forEach((index, labelId) => {
      const rec = ins[index];
      const newWeight = updatedLabels.get(labelId);
      if (!rec || typeof newWeight !== 'number' || Number.isNaN(newWeight)) return;

      const prevWeight = typeof rec.measuredWeight === 'number'
        ? rec.measuredWeight
        : parseFloat(rec.measuredWeight);
      const prevUnit = rec.unit || 'g';

      const stockItem = stockItems.find(item => item.labelId === labelId) || {};
      const qtyBefore = typeof stockItem.expectedQty === 'number' && !Number.isNaN(stockItem.expectedQty)
        ? stockItem.expectedQty
        : null;
      const qtyAfter = typeof stockItem.actualQty === 'number' && !Number.isNaN(stockItem.actualQty)
        ? stockItem.actualQty
        : null;

      historyEntries.push({
        timestamp: new Date().toISOString(),
        labelId,
        itemName: rec.itemName || '--',
        itemId: rec.itemId || '--',
        lotNo: rec.lotNo || '--',
        manufacturingLot: rec.manufacturingLot || '--',
        quantityBefore: qtyBefore,
        quantityAfter: qtyAfter,
        weightBefore: prevWeight,
        unitBefore: prevUnit,
        weightAfter: newWeight,
        unitAfter: 'g',
        responsibleUser: currentUser
          ? (currentUser.displayName || currentUser.name || currentUser.username || '')
          : '',
      });

      rec.measuredWeight = newWeight;
      rec.unit = 'g';
    });

    saveWeightRecordsArray(ins);

    // Append stock-take history
    if (historyEntries.length) {
      try {
        let history = getStockTakeHistoryArray();
        if (!Array.isArray(history)) history = [];
        history.push(...historyEntries);
        saveStockTakeHistoryArray(history);
      } catch (err) {
        console.error('Error saving stock take history:', err);
      }
    }

    // Clear saved stock-take state so everything resets to "Not checked"
    localStorage.removeItem(STOCK_TAKE_STATE_KEY);

    showStatus('Stock take updates applied. List reloaded with new weights.', false);
    didApply = true;
    resetInfo();
    loadInStockItems();
  } catch (err) {
    console.error('Error applying stock take updates:', err);
    showStatus('Failed to apply stock take updates. See console.', true);
  } finally {
    try {
      ensureQrInputInteractive();
      refocusQrInputSoon();
    } catch {
    }
  }
}

confirmModalOkBtn?.addEventListener('click', () => {
  if (confirmModal) {
    confirmModal.classList.add('hidden');
  }
});

confirmModalCancelBtn?.addEventListener('click', () => {
  if (confirmModal) {
    confirmModal.classList.add('hidden');
  }
  refocusQrInputSoon();
});

function exportStockTakeCsv() {
  try {
    if (!stockItems.length) {
      showStatus('No in-stock items to export.', true);
      return;
    }

    const headers = [
      'Label ID',
      'Item Name',
      'Expected Qty',
      'Expected Weight',
      'Actual Qty',
      'Actual Weight',
      'Difference',
    ];

    const rows = stockItems.map(item => {
      const expectedText = item.expectedWeight && !Number.isNaN(item.expectedWeight)
        ? `${formatNumber(item.expectedWeight, 2)} ${item.unit}`
        : '';
      const actualText = typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)
        ? formatNumber(item.actualWeight, 2)
        : '';
      const diffText = typeof item.diff === 'number' && !Number.isNaN(item.diff)
        ? formatNumber(item.diff, 2)
        : '';
      return [
        item.labelId || '',
        item.itemName || '',
        typeof item.expectedQty === 'number' && !Number.isNaN(item.expectedQty)
          ? formatNumber(item.expectedQty, 0)
          : '',
        expectedText,
        typeof item.actualQty === 'number' && !Number.isNaN(item.actualQty)
          ? formatNumber(item.actualQty, 0)
          : '',
        actualText,
        diffText,
      ];
    });

    const csv = [headers, ...rows]
      .map(row => row.map(escapeCsv).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-take-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error exporting stock take CSV:', err);
    showStatus('Failed to export CSV. See console.', true);
  }
}

function loadInStockItems() {
  if (!tableBody) return;
  stockItems = [];
  try {
    const ins = getWeightRecordsArray();
    const outs = getStockOutRecordsArray();

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

    latestInByLabel.forEach((inRec, labelId) => {
      const outRec = latestOutByLabel.get(labelId);
      const inTime = inRec.timestamp ? new Date(inRec.timestamp).getTime() : 0;
      const outTime = outRec && outRec.timestamp ? new Date(outRec.timestamp).getTime() : -1;
      const status = outTime > inTime ? 'OUT' : 'IN';
      if (status !== 'IN') return; // only show in-stock

      const measured = typeof inRec.measuredWeight === 'number' ? inRec.measuredWeight : parseFloat(inRec.measuredWeight);
      const unit = inRec.unit || 'g';
      const expectedQty = typeof inRec.quantity === 'number'
        ? inRec.quantity
        : parseFloat(inRec.quantity);

      stockItems.push({
        labelId,
        itemId: inRec.itemId || '--',
        itemName: inRec.itemName || '--',
        status,
        expectedQty: !Number.isNaN(expectedQty) ? expectedQty : null,
        expectedWeight: measured,
        unit,
        actualQty: !Number.isNaN(expectedQty) ? expectedQty : null,
        actualWeight: null,
        diff: null,
        stockTakeStatus: 'Not checked',
      });
    });
  } catch (err) {
    console.error('Error loading in-stock items for stock take:', err);
  }

  // Merge any previously saved stock-take state (so checked items remain marked)
  try {
    const savedRaw = localStorage.getItem(STOCK_TAKE_STATE_KEY);
    const saved = savedRaw ? JSON.parse(savedRaw) : {};
    if (saved && typeof saved === 'object') {
      stockItems = stockItems.map(item => {
        const state = saved[item.labelId];
        if (!state) return item;
        return {
          ...item,
          actualQty: typeof state.actualQty === 'number' ? state.actualQty : item.actualQty,
          actualWeight: typeof state.actualWeight === 'number' ? state.actualWeight : item.actualWeight,
          diff: typeof state.diff === 'number' ? state.diff : item.diff,
          stockTakeStatus: state.stockTakeStatus || item.stockTakeStatus,
        };
      });
    }
  } catch (err) {
    console.error('Error restoring stock take state:', err);
  }

  renderStockTable();
}

function saveStockTakeState() {
  try {
    const payload = {};
    for (const item of stockItems) {
      payload[item.labelId] = {
        actualQty: typeof item.actualQty === 'number' ? item.actualQty : null,
        actualWeight: typeof item.actualWeight === 'number' ? item.actualWeight : null,
        diff: typeof item.diff === 'number' ? item.diff : null,
        stockTakeStatus: item.stockTakeStatus,
      };
    }
    localStorage.setItem(STOCK_TAKE_STATE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('Error saving stock take state:', err);
  }
}

function renderStockTable() {
  if (!tableBody) return;
  tableBody.innerHTML = '';
  if (!stockItems.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-500">No in-stock items found.</td></tr>';
    return;
  }

  let totalExpectedQty = 0;
  let totalActualQty = 0;
  let totalExpectedWeight = 0;
  let totalActualWeight = 0;

  const items = stockItems.slice();
  const { key, direction } = stockTakeSort;
  if (key) {
    items.sort((a, b) => {
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
  }

  for (const item of items) {
    const tr = document.createElement('tr');
    const expectedText = item.expectedWeight && !Number.isNaN(item.expectedWeight)
      ? `${formatNumber(item.expectedWeight, 2)} ${item.unit}`
      : '--';
    const actualText = typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)
      ? `${formatNumber(item.actualWeight, 2)} g`
      : '--';
    const diffText = typeof item.diff === 'number' && !Number.isNaN(item.diff)
      ? `${formatNumber(item.diff, 2)} g`
      : '--';
    const expectedQtyText = typeof item.expectedQty === 'number' && !Number.isNaN(item.expectedQty)
      ? `${formatNumber(item.expectedQty, 0)} pcs`
      : '--';
    const actualQtyText = typeof item.actualQty === 'number' && !Number.isNaN(item.actualQty)
      ? `${formatNumber(item.actualQty, 0)} pcs`
      : '--';

    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${item.labelId}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${item.itemName}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${expectedQtyText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${expectedText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${actualQtyText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${actualText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${diffText}</td>
    `;
    tableBody.appendChild(tr);

    if (typeof item.expectedQty === 'number' && !Number.isNaN(item.expectedQty)) {
      totalExpectedQty += item.expectedQty;
    }
    if (typeof item.actualQty === 'number' && !Number.isNaN(item.actualQty)) {
      totalActualQty += item.actualQty;
    }
    if (typeof item.expectedWeight === 'number' && !Number.isNaN(item.expectedWeight)) {
      totalExpectedWeight += item.expectedWeight;
    }
    if (typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)) {
      totalActualWeight += item.actualWeight;
    }
  }

  const totalTr = document.createElement('tr');
  totalTr.className = 'bg-gray-50';
  totalTr.innerHTML = `
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-700" colspan="2">Total</td>
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-900">${formatNumber(totalExpectedQty, 0)} pcs</td>
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-900">${formatNumber(totalExpectedWeight, 2)} g</td>
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-900">${formatNumber(totalActualQty, 0)} pcs</td>
    <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-900">${formatNumber(totalActualWeight, 2)} g</td>
    <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700"></td>
  `;
  tableBody.appendChild(totalTr);
}

function setStockTakeSort(key) {
  if (stockTakeSort.key === key) {
    stockTakeSort.direction = stockTakeSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    stockTakeSort = { key, direction: 'asc' };
  }
  updateStockTakeSortIndicators();
  renderStockTable();
}

function updateStockTakeSortIndicators() {
  if (!stockTakeHeaderCells || !stockTakeHeaderCells.length) return;
  stockTakeHeaderCells.forEach((th, index) => {
    const key = stockTakeSortKeys[index];
    if (!key) return;
    const baseLabel = th.dataset.baseLabel || th.textContent.replace(/[▲▼]/g, '').trim();
    th.dataset.baseLabel = baseLabel;

    if (key === stockTakeSort.key) {
      const arrow = stockTakeSort.direction === 'asc' ? '▲' : '▼';
      th.textContent = baseLabel + ' ' + arrow;
    } else {
      th.textContent = baseLabel;
    }
    th.classList.add('cursor-pointer', 'select-none');
  });
}

function redirectToLogin() {
  window.location.href = 'login.html?return=stock-take.html';
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

function isPreferredScalePort(port) {
  if (!port || typeof port.getInfo !== 'function') return false;
  const info = port.getInfo() || {};
  const preferredIds = getPreferredScaleIds();
  return preferredIds.some(({ usbVendorId, usbProductId }) => {
    const vendorMatches = typeof usbVendorId === 'number' ? info.usbVendorId === usbVendorId : true;
    const productMatches = typeof usbProductId === 'number' ? info.usbProductId === usbProductId : true;
    return vendorMatches && productMatches;
  });
}

async function disconnectScale({ quiet = true } = {}) {
  keepReadingScale = false;
  if (scaleReader) {
    try { await scaleReader.cancel(); } catch {}
    try { scaleReader.releaseLock(); } catch {}
  }
  if (scalePort) {
    try { await scalePort.close(); } catch {}
  }
  scalePort = null;
  scaleReader = null;
  scaleStatus.textContent = 'Not Connected';
  scaleStatus.className = 'text-lg font-bold text-red-600';
  connectScaleBtn.style.display = 'block';
  disconnectScaleBtn.style.display = 'none';
  ensureQrInputInteractive();
  if (!quiet) showStatus('Scale disconnected.', false);
}

async function beginScaleSession(port) {
  if (!port) throw new Error('No serial port provided.');
  if (scaleConnectInProgress) return;
  scaleConnectInProgress = true;
  try {
    await disconnectScale({ quiet: true });

    // If the user pulled the cable / device glitched, make sure we don't re-open an already-open port.
    if (port.readable) {
      try { await port.close(); } catch {}
    }

    try {
      await port.open(SCALE_SERIAL_OPTIONS);
      scalePort = port;
      scaleStatus.textContent = 'Connected';
      scaleStatus.className = 'text-lg font-bold text-green-600';
      connectScaleBtn.style.display = 'none';
      disconnectScaleBtn.style.display = 'block';
      keepReadingScale = true;
      refocusQrInputSoon();
      readFromScale(port);
    } catch (err) {
      try {
        if (port?.readable) {
          try { await port.close(); } catch {}
        }
      } catch {
      }
      await disconnectScale({ quiet: true });
      scaleStatus.textContent = 'Connection Failed';
      scaleStatus.className = 'text-lg font-bold text-red-600';
      throw err;
    }
  } finally {
    scaleConnectInProgress = false;
  }
}

async function connectPreferredScale() {
  if (!('serial' in navigator)) {
    showStatus('Web Serial API not supported in this browser.', true);
    return;
  }
  try {
    if (scalePort?.readable && !scaleConnectInProgress) {
      showStatus('Scale already connected.', false);
      refocusQrInputSoon();
      return;
    }
    const grantedPorts = await navigator.serial.getPorts();
    let port = grantedPorts.find(isPreferredScalePort);
    if (!port) {
      port = await navigator.serial.requestPort();
    }
    await beginScaleSession(port);
    showStatus('Scale connected.', false);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      showStatus('Scale not found. Please connect the ATEN USB to Serial Bridge.', true);
    } else if (err.name === 'SecurityError') {
      showStatus('Serial access denied. Please allow permission for the scale.', true);
    } else if (err.name === 'AbortError') {
      // user cancelled
    } else {
      console.error('Error during scale connection:', err);
      showStatus('Failed to connect to scale.', true);
    }
    refocusQrInputSoon();
  }
}

async function readFromScale(port = scalePort) {
  const activePort = port;
  if (!activePort?.readable) return;

  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = activePort.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();
  scaleReader = reader;

  let lineBuffer = '';
  while (activePort.readable && keepReadingScale && scalePort === activePort) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      lineBuffer += value;
      const lines = lineBuffer.split(/\r\n|\n|\r/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) handleScaleLine(line.trim());
      }
    } catch (err) {
      console.error('Error reading from scale:', err);
      break;
    }
  }

  try { reader.releaseLock(); } catch {}
  try { await readableStreamClosed.catch(() => {}); } catch {}
}

function handleScaleLine(data) {
  scaleRawData.textContent = data;
  const parts = data.split(',');
  let w = NaN;
  if (parts.length >= 2) {
    w = parseFloat(parts[1]);
    if (Number.isNaN(w) && parts.length >= 3) {
      w = parseFloat(parts[2]);
    }
  } else {
    w = parseFloat(data);
  }

  if (Number.isNaN(w)) {
    const match = String(data).match(/-?\d+(?:\.\d+)?/);
    if (match) {
      w = parseFloat(match[0]);
    }
  }
  if (!Number.isNaN(w)) {
    currentWeight = w;
    infoActual.textContent = `${formatNumber(w, 2)} g`;

    if (pendingScaleCompareForScan) {
      diffLimitPromptArmed = true;
      pendingScaleCompareForScan = false;
    }
    updateDiff();
  }
}

function resetInfo() {
  infoLabelId.textContent = '--';
  infoItemName.textContent = '--';
  infoStatus.textContent = '--';
  infoExpected.textContent = '--';
  infoActual.textContent = '--';
  infoDiff.textContent = '--';
}

function updateDiff() {
  const shouldPromptForDiffLimit = diffLimitPromptArmed;
  diffLimitPromptArmed = false;

  const expectedText = infoExpected.textContent || '';
  const match = expectedText.match(/([-0-9.]+)/);
  if (!match) {
    infoDiff.textContent = '--';
    return;
  }
  const expected = parseFloat(match[1]);
  if (Number.isNaN(expected) || Number.isNaN(currentWeight)) {
    infoDiff.textContent = '--';
    return;
  }
  const diff = currentWeight - expected;

  if (shouldPromptForDiffLimit && typeof stockTakeDiffLimitGrams === 'number' && Math.abs(diff) > stockTakeDiffLimitGrams) {
    const labelId = (infoLabelId.textContent || '').trim();
    const key = `${labelId}|${formatNumber(currentWeight, 2)}|${formatNumber(diff, 2)}|${formatNumber(stockTakeDiffLimitGrams, 2)}`;
    if (key !== lastDiffLimitPromptKey) {
      lastDiffLimitPromptKey = key;
      const ok = window.confirm(`Difference exceeds allowable limit (${formatNumber(stockTakeDiffLimitGrams, 2)}g). Continue?`);
      if (!ok) {
        currentWeight = Number.NaN;
        infoActual.textContent = '--';
        infoDiff.textContent = '--';
        return;
      }
    }
  }

  const withinTolerance = Math.abs(diff) <= stockTakeToleranceGrams;
  infoDiff.textContent = `${formatNumber(diff, 2)} g${withinTolerance ? ` (within ${formatNumber(stockTakeToleranceGrams, 2)}g)` : ''}`;
  // Use text color to indicate out-of-tolerance differences
  infoDiff.className = 'font-mono float-right ' + (withinTolerance ? 'text-green-700' : 'text-red-700');

  updateStockTakeRow(expected, diff, withinTolerance);
}

function updateStockTakeRow(expected, diff, withinTolerance) {
  if (!tableBody) return;
  const labelId = infoLabelId.textContent || '';
  if (!labelId || labelId === '--') return;

  const idx = stockItems.findIndex(item => item.labelId === labelId);
  const status = infoStatus.textContent || 'IN';
  const itemName = infoItemName.textContent || '--';
  const expectedWeight = expected;

  const actualWeight = currentWeight;
  const stockTakeStatus = withinTolerance
    ? `Done (within ${formatNumber(stockTakeToleranceGrams, 2)}g)`
    : 'Done (out of tolerance)';

  const unitMatch = (infoExpected.textContent || '').match(/[a-zA-Z]+$/);
  const unit = unitMatch ? unitMatch[0] : 'g';

  const baseItem = idx >= 0 ? stockItems[idx] : stockItems.find(it => it.labelId === labelId) || {};
  const expectedQty = typeof baseItem.expectedQty === 'number' && !Number.isNaN(baseItem.expectedQty)
    ? baseItem.expectedQty
    : null;

  let actualQty = expectedQty;
  if (expectedQty && expectedWeight > 0 && typeof actualWeight === 'number' && !Number.isNaN(actualWeight)) {
    const ratio = actualWeight / expectedWeight;
    if (!Number.isNaN(ratio) && ratio > 0) {
      actualQty = expectedQty * ratio;
    }
  }

  const updated = {
    labelId,
    itemId: baseItem.itemId || '',
    itemName,
    status,
    expectedWeight,
    unit,
    expectedQty,
    actualQty,
    actualWeight,
    diff,
    stockTakeStatus,
  };

  if (idx === -1) {
    stockItems.push(updated);
  } else {
    stockItems[idx] = { ...stockItems[idx], ...updated };
  }

  renderStockTable();
  saveStockTakeState();
}

function parseExpectedFromRecords(labelId) {
  try {
    const ins = getWeightRecordsArray();
    const outs = getStockOutRecordsArray();
    if (!Array.isArray(ins) && !Array.isArray(outs)) return null;

    const inForLabel = Array.isArray(ins) ? ins.filter(r => r && r.labelId === labelId) : [];
    const outForLabel = Array.isArray(outs) ? outs.filter(r => r && r.labelId === labelId) : [];

    if (!inForLabel.length) return null;

    inForLabel.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    const latestIn = inForLabel[0];

    outForLabel.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    const latestOut = outForLabel[0];

    const status = latestOut && latestOut.timestamp &&
      new Date(latestOut.timestamp).getTime() > new Date(latestIn.timestamp || 0).getTime()
      ? 'OUT'
      : 'IN';

    const measured = typeof latestIn.measuredWeight === 'number'
      ? latestIn.measuredWeight
      : parseFloat(latestIn.measuredWeight);
    const unit = latestIn.unit || 'g';

    return {
      itemName: latestIn.itemName || '--',
      status,
      expectedWeight: measured,
      unit,
    };
  } catch (err) {
    console.error('Error reading expected weight from records:', err);
    return null;
  }
}

function handleScan(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return;

  pendingScaleCompareForScan = true;
  diffLimitPromptArmed = false;

  let labelId = trimmed;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.id) labelId = parsed.id;
    } catch {
      // fall back to raw
    }
  }

  infoLabelId.textContent = labelId;

  const data = parseExpectedFromRecords(labelId);
  if (!data) {
    showStatus(`No stock records found for label ${labelId}.`, true);
    infoStatus.textContent = 'UNKNOWN';
    return;
  }

  infoItemName.textContent = data.itemName;
  infoStatus.textContent = data.status;

  if (data.expectedWeight && !Number.isNaN(data.expectedWeight)) {
    infoExpected.textContent = `${formatNumber(data.expectedWeight, 2)} ${data.unit}`;
  } else {
    infoExpected.textContent = '--';
  }

  showStatus(`Data loaded for label ${labelId}.`, false);
  currentWeight = Number.NaN;
  infoActual.textContent = '--';
  infoDiff.textContent = '--';
  infoDiff.className = 'font-mono float-right';
}

qrInput.addEventListener('click', (e) => {
  e.target.value = '';
  qrScanBuffer = '';
  if (qrScanBufferTimer) {
    clearTimeout(qrScanBufferTimer);
    qrScanBufferTimer = null;
  }
  try {
    ensureQrInputInteractive();
    try {
      window.focus();
    } catch {
    }
    qrInput?.focus();
  } catch {
  }
});
window.addEventListener('focus', () => {
  try {
    if (DEBUG_QR_FOCUS) console.log('[stock-take] window focus -> refocusQrInputSoon');
  } catch {
  }
  refocusQrInputSoon();
});
document.addEventListener('keydown', (e) => {
  try {
    if (!qrInput) return;
    const active = document?.activeElement;
    if (active === qrInput) return;

    // Don't steal focus from other editable fields.
    const tag = active?.tagName ? String(active.tagName).toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return;

    // If a scanner or user is typing but focus routing is broken (common after modal alert),
    // force focus back to QR input so the existing qrInput keydown handler can capture the scan.
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      ensureQrInputInteractive();
      qrInput.focus();
    }
  } catch {
  }
}, true);
qrInput.addEventListener('keydown', (e) => {
  try {
    if (DEBUG_QR_FOCUS) {
      console.log('[stock-take] qrInput keydown', {
        key: e.key,
        code: e.code,
        disabled: qrInput?.disabled,
        readOnly: qrInput?.readOnly,
        activeElementId: document?.activeElement?.id,
      });
    }
  } catch {
  }
  if (qrScanBufferTimer) {
    clearTimeout(qrScanBufferTimer);
    qrScanBufferTimer = null;
  }
  qrScanBufferTimer = setTimeout(() => {
    qrScanBuffer = '';
    qrScanBufferTimer = null;
  }, 500);

  if (e.key === 'Enter' || e.key === 'Tab') {
    const value = qrScanBuffer || e.target.value;
    qrScanBuffer = '';
    e.target.value = '';
    e.preventDefault();
    handleScan(value);
    return;
  }

  if (e.key === 'Backspace') {
    qrScanBuffer = qrScanBuffer.slice(0, -1);
    return;
  }
  if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
    return;
  }
  if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    qrScanBuffer += e.key;
  }
});
qrInput.addEventListener('change', (e) => {
  const value = e.target.value;
  e.target.value = '';
  handleScan(value);
});

connectScaleBtn.addEventListener('click', () => {
  (async () => {
    try {
      if ('serial' in navigator) {
        const ports = await navigator.serial.getPorts();
        if (!ports || !ports.length) {
          const currentPage = (location.pathname.split('/').pop()) || 'stock-take.html';
          const url = new URL('ports.html', window.location.href);
          url.searchParams.set('return', currentPage);
          const w = window.open(url.toString(), 'ports', 'width=900,height=700');
          if (!w) {
            window.location.href = url.toString();
          }
          showStatus('Open Ports window to grant serial access, then come back and click Connect again.', true);
          return;
        }
      }
    } catch {
    }
    connectPreferredScale();
  })();
});

disconnectScaleBtn.addEventListener('click', () => {
  disconnectScale({ quiet: false });
});

exportBtn?.addEventListener('click', exportStockTakeCsv);
applyBtn?.addEventListener('click', applyStockTakeUpdates);
printBtn?.addEventListener('click', printStockTakeReport);

window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  refreshStockTakeTolerance();
  refreshStockTakeDiffLimit();
  logoutBtn?.addEventListener('click', handleLogout);
  resetInfo();
  loadInStockItems();
  ensureQrInputInteractive();
  qrInput.focus();

  if (tableBody) {
    // Find the table element that contains the table body
    const table = tableBody.closest('table');
    if (table) {
      // Find the thead > tr that contains the header cells
      const headerRow = table.querySelector('thead tr');
      if (headerRow) {
        stockTakeHeaderCells = Array.from(headerRow.querySelectorAll('th'));
        stockTakeHeaderCells.forEach((th, index) => {
          const key = stockTakeSortKeys[index];
          if (!key) return;
          th.style.cursor = 'pointer';
          th.style.userSelect = 'none';
          th.addEventListener('click', () => setStockTakeSort(key));
        });
        updateStockTakeSortIndicators();
      }
    }
  }
});

function escapeCsv(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
}

function printStockTakeReport() {
  try {
    if (!stockItems.length) {
      showStatus('No in-stock items to print.', true);
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();
    const currentUser = getCurrentUser();
    let generatedByText = '';
    if (currentUser) {
      const name = (currentUser.displayName || currentUser.name || currentUser.username || '').trim();
      const empId = (currentUser.employeeId || currentUser.username || '').trim();
      if (name && empId) {
        generatedByText = `${name} (${empId})`;
      } else if (name) {
        generatedByText = name;
      } else if (empId) {
        generatedByText = empId;
      }
    }

    // Group items by itemId (item number)
    const groups = new Map();
    for (const item of stockItems) {
      const itemId = (item.itemId || '').toString() || '--';
      if (!itemId) continue;
      if (!groups.has(itemId)) {
        groups.set(itemId, {
          itemId,
          itemName: item.itemName || '',
          expectedQty: 0,
          actualQty: 0,
          expectedWeight: 0,
          actualWeight: 0,
        });
      }
      const g = groups.get(itemId);
      if (typeof item.expectedQty === 'number' && !Number.isNaN(item.expectedQty)) {
        g.expectedQty += item.expectedQty;
      }
      if (typeof item.actualQty === 'number' && !Number.isNaN(item.actualQty)) {
        g.actualQty += item.actualQty;
      }
      if (typeof item.expectedWeight === 'number' && !Number.isNaN(item.expectedWeight)) {
        g.expectedWeight += item.expectedWeight;
      }
      if (typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)) {
        g.actualWeight += item.actualWeight;
      }
    }

    const grouped = Array.from(groups.values());
    grouped.sort((a, b) => {
      const aId = a.itemId.toString().toLowerCase();
      const bId = b.itemId.toString().toLowerCase();
      if (aId < bId) return -1;
      if (aId > bId) return 1;
      return 0;
    });

    const rowsHtml = grouped.map((g, index) => {
      const totalDiffQty = g.actualQty - g.expectedQty;
      const totalDiffWeight = g.actualWeight - g.expectedWeight;

      const remarkText = (typeof stockTakeDiffLimitGrams === 'number' && Math.abs(totalDiffWeight) > stockTakeDiffLimitGrams)
        ? 'Need review'
        : '';

      const expectedQtyText = Number.isFinite(g.expectedQty) ? formatNumber(g.expectedQty, 0) : '';
      const actualQtyText = Number.isFinite(g.actualQty) ? formatNumber(g.actualQty, 0) : '';
      const diffQtyText = Number.isFinite(totalDiffQty) ? formatNumber(totalDiffQty, 0) : '';
      const expectedWeightText = Number.isFinite(g.expectedWeight) ? `${formatNumber(g.expectedWeight, 2)} g` : '';
      const actualWeightText = Number.isFinite(g.actualWeight) ? `${formatNumber(g.actualWeight, 2)} g` : '';
      const diffWeightText = Number.isFinite(totalDiffWeight) ? `${formatNumber(totalDiffWeight, 2)} g` : '';

      return `
        <tr>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:center;">${index + 1}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt;">${g.itemId}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt;">${g.itemName}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${expectedQtyText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${actualQtyText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${diffQtyText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${expectedWeightText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${actualWeightText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${diffWeightText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt;"></td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt;"></td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt;">${remarkText}</td>
        </tr>
      `;
    }).join('');

    const signatureHtml = `
      <div style="margin-bottom:16px; display:flex; justify-content:flex-end;">
        <div style="display:flex;">
          <div style="width:120px;">
            <div style="border:1px solid #111827; height:50px; display:flex; align-items:flex-end; justify-content:center; font-size:10pt; font-weight:600;">
              Issue
            </div>
          </div>
          <div style="width:120px;">
            <div style="border:1px solid #111827; border-left:none; height:50px; display:flex; align-items:flex-end; justify-content:center; font-size:10pt; font-weight:600;">
              Confirm
            </div>
          </div>
          <div style="width:120px;">
            <div style="border:1px solid #111827; border-left:none; height:50px; display:flex; align-items:flex-end; justify-content:center; font-size:10pt; font-weight:600;">
              Approved
            </div>
          </div>
        </div>
      </div>
    `;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>Stock Record Report</title>
        <style>
          @page { size: A4 landscape; margin: 16mm; }
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11pt; color: #111827; }
          h1 { font-size: 18pt; margin: 0 0 4px 0; }
          .subhead { font-size: 10pt; color: #4b5563; margin-bottom: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th { background: #f3f4f6; font-size: 10pt; text-align: left; padding: 4px 8px; border: 1px solid #e5e7eb; }
          .print-controls { position: sticky; top: 0; z-index: 50; background: #ffffff; border-bottom: 1px solid #e5e7eb; padding: 10px 0; margin-bottom: 12px; }
          .print-controls-inner { display: flex; justify-content: flex-end; gap: 8px; }
          .btn { font: inherit; font-size: 10pt; padding: 8px 12px; border-radius: 8px; cursor: pointer; border: 1px solid #d1d5db; background: #ffffff; }
          .btn-primary { background: #2563eb; border-color: #2563eb; color: #ffffff; }
          @media print { .print-controls { display: none; } }
        </style>
      </head>
      <body>
        <div class="print-controls">
          <div class="print-controls-inner">
            <button class="btn" onclick="window.close()">Close</button>
            <button class="btn btn-primary" onclick="window.print()">Print</button>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:8px;">
          <div>
            <h1>Stock Record</h1>
            <div class="subhead">Generated on ${dateStr} at ${timeStr}${generatedByText ? ` by ${generatedByText}` : ''}</div>
          </div>
        </div>
        ${signatureHtml}
        <table>
          <thead>
            <tr>
              <th style="width:24px; text-align:center;">No</th>
              <th>Item Number</th>
              <th>Item Name</th>
              <th style="text-align:right;">Total Expected Qty</th>
              <th style="text-align:right;">Total Actual Qty</th>
              <th style="text-align:right;">Total Diff Qty</th>
              <th style="text-align:right;">Expected Weight</th>
              <th style="text-align:right;">Actual Weight</th>
              <th style="text-align:right;">Diff Weight</th>
              <th>Final Judgement</th>
              <th>Comment</th>
              <th>Remark</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
      </html>
    `;
    const preview = window.open('', '_blank');
    if (!preview) {
      alert('Unable to open print preview window. Please allow popups.');
      return;
    }
    preview.document.open();
    preview.document.write(html);
    preview.document.close();
    try {
      preview.focus();
    } catch {
    }
  } catch (err) {
    console.error('Error generating stock take print report:', err);
    alert('Failed to generate print report. See console for details.');
  }
}
