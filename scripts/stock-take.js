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

let scalePort = null;
let scaleReader = null;
let keepReadingScale = false;
let currentWeight = 0;
const STOCK_TAKE_TOLERANCE_GRAMS = 5; // allowable +/- 5g difference
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

let stockItems = [];
let stockTakeSort = { key: 'labelId', direction: 'asc' };
let stockTakeHeaderCells = [];
const stockTakeSortKeys = ['labelId', 'itemName', 'expectedQty', 'expectedWeight', 'actualQty', 'actualWeight', 'diff'];

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

function applyStockTakeUpdates() {
  try {
    if (!stockItems.length) {
      alert('No in-stock items to update.');
      return;
    }

    // Only consider labels where we have an actual measured weight
    const updatedLabels = new Map();
    for (const item of stockItems) {
      if (typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)) {
        updatedLabels.set(item.labelId, item.actualWeight);
      }
    }

    if (!updatedLabels.size) {
      alert('No items have an actual weight recorded to update.');
      return;
    }

    if (!confirm('Apply the actual weights to the latest stock-in records and reset stock-take status?')) {
      return;
    }

    const currentUser = getCurrentUser();

    const insRaw = localStorage.getItem('weight_records');
    let ins = insRaw ? JSON.parse(insRaw) : [];
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

      historyEntries.push({
        timestamp: new Date().toISOString(),
        labelId,
        itemName: rec.itemName || '--',
        itemId: rec.itemId || '--',
        lotNo: rec.lotNo || '--',
        manufacturingLot: rec.manufacturingLot || '--',
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

    localStorage.setItem('weight_records', JSON.stringify(ins));

    // Append stock-take history
    if (historyEntries.length) {
      try {
        const rawHist = localStorage.getItem(STOCK_TAKE_HISTORY_KEY);
        let history = rawHist ? JSON.parse(rawHist) : [];
        if (!Array.isArray(history)) history = [];
        history.push(...historyEntries);
        localStorage.setItem(STOCK_TAKE_HISTORY_KEY, JSON.stringify(history));
      } catch (err) {
        console.error('Error saving stock take history:', err);
      }
    }

    // Clear saved stock-take state so everything resets to "Not checked"
    localStorage.removeItem(STOCK_TAKE_STATE_KEY);

    showStatus('Stock take updates applied. List reloaded with new weights.', false);
    resetInfo();
    loadInStockItems();
  } catch (err) {
    console.error('Error applying stock take updates:', err);
    alert('Failed to apply stock take updates. See console for details.');
  }
}

function exportStockTakeCsv() {
  try {
    if (!stockItems.length) {
      alert('No in-stock items to export.');
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
    alert('Failed to export CSV. See console for details.');
  }
}

function loadInStockItems() {
  if (!tableBody) return;
  stockItems = [];
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
  return PREFERRED_SCALE_IDS.some(({ usbVendorId, usbProductId }) => {
    const vendorMatches = typeof usbVendorId === 'number' ? info.usbVendorId === usbVendorId : true;
    const productMatches = typeof usbProductId === 'number' ? info.usbProductId === usbProductId : true;
    return vendorMatches && productMatches;
  });
}

async function disconnectScale({ quiet = true } = {}) {
  keepReadingScale = false;
  if (scaleReader) {
    try { await scaleReader.cancel(); } catch {}
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
  if (!quiet) showStatus('Scale disconnected.', false);
}

async function beginScaleSession(port) {
  if (!port) throw new Error('No serial port provided.');
  await disconnectScale({ quiet: true });
  await port.open(SCALE_SERIAL_OPTIONS);
  scalePort = port;
  scaleStatus.textContent = 'Connected';
  scaleStatus.className = 'text-lg font-bold text-green-600';
  connectScaleBtn.style.display = 'none';
  disconnectScaleBtn.style.display = 'block';
  keepReadingScale = true;
  qrInput.focus();
  readFromScale();
}

async function connectPreferredScale() {
  if (!('serial' in navigator)) {
    showStatus('Web Serial API not supported in this browser.', true);
    return;
  }
  try {
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
  }
}

async function readFromScale() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = scalePort.readable.pipeTo(textDecoder.writable);
  scaleReader = textDecoder.readable.getReader();

  let lineBuffer = '';
  while (scalePort.readable && keepReadingScale) {
    try {
      const { value, done } = await scaleReader.read();
      if (done) break;
      lineBuffer += value;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) handleScaleLine(line.trim());
      }
    } catch (err) {
      console.error('Error reading from scale:', err);
      break;
    }
  }

  if (scaleReader) {
    try { scaleReader.releaseLock(); } catch {}
  }
  try { await readableStreamClosed.catch(() => {}); } catch {}
}

function handleScaleLine(data) {
  scaleRawData.textContent = data;
  const parts = data.split(',');
  let w = NaN;
  if (parts.length >= 2) {
    w = parseFloat(parts[1]);
  } else {
    w = parseFloat(data);
  }
  if (!Number.isNaN(w)) {
    currentWeight = w;
    infoActual.textContent = `${formatNumber(w, 2)} g`;
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
  const withinTolerance = Math.abs(diff) <= STOCK_TAKE_TOLERANCE_GRAMS;
  infoDiff.textContent = `${formatNumber(diff, 2)} g${withinTolerance ? ' (within 5g)' : ''}`;
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
  const stockTakeStatus = withinTolerance ? 'Done (within 5g)' : 'Done (out of tolerance)';

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
    const insRaw = localStorage.getItem('weight_records');
    const outsRaw = localStorage.getItem('stock_out_records');
    const ins = insRaw ? JSON.parse(insRaw) : [];
    const outs = outsRaw ? JSON.parse(outsRaw) : [];
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

  resetInfo();

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
  updateDiff();
}

qrInput.addEventListener('click', (e) => { e.target.value = ''; });
qrInput.addEventListener('change', (e) => {
  const value = e.target.value;
  e.target.value = '';
  handleScan(value);
});

connectScaleBtn.addEventListener('click', () => {
  connectPreferredScale();
});

disconnectScaleBtn.addEventListener('click', () => {
  disconnectScale({ quiet: false });
});

exportBtn?.addEventListener('click', exportStockTakeCsv);
applyBtn?.addEventListener('click', applyStockTakeUpdates);
printBtn?.addEventListener('click', printStockTakeReport);

window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  logoutBtn?.addEventListener('click', handleLogout);
  resetInfo();
  loadInStockItems();
  qrInput.focus();

  if (tableBody) {
    const headerRow = tableBody.parentElement?.previousElementSibling?.querySelector('tr');
    if (headerRow) {
      stockTakeHeaderCells = Array.from(headerRow.querySelectorAll('th'));
      stockTakeHeaderCells.forEach((th, index) => {
        const key = stockTakeSortKeys[index];
        if (!key) return;
        th.addEventListener('click', () => setStockTakeSort(key));
      });
      updateStockTakeSortIndicators();
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
      alert('No in-stock items to print.');
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();

    const rowsHtml = stockItems.map((item, index) => {
      const expectedQtyText = typeof item.expectedQty === 'number' && !Number.isNaN(item.expectedQty)
        ? item.expectedQty.toFixed(0)
        : '';
      const actualQtyText = typeof item.actualQty === 'number' && !Number.isNaN(item.actualQty)
        ? item.actualQty.toFixed(0)
        : '';
      const expectedWeightText = typeof item.expectedWeight === 'number' && !Number.isNaN(item.expectedWeight)
        ? `${item.expectedWeight.toFixed(2)} ${item.unit}`
        : '';
      const actualWeightText = typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)
        ? `${item.actualWeight.toFixed(2)} g`
        : '';
      const diffText = typeof item.diff === 'number' && !Number.isNaN(item.diff)
        ? `${item.diff.toFixed(2)} g`
        : '';

      return `
        <tr>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:center;">${index + 1}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt;">${item.labelId || ''}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt;">${item.itemName || ''}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${expectedQtyText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${expectedWeightText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${actualQtyText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${actualWeightText}</td>
          <td style="padding:4px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${diffText}</td>
        </tr>
      `;
    }).join('');

    let totalExpectedQty = 0;
    let totalActualQty = 0;
    let totalExpectedWeight = 0;
    let totalActualWeight = 0;
    for (const item of stockItems) {
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

    const totalsHtml = `
      <tr style="background-color:#f9fafb; font-weight:600;">
        <td colspan="3" style="padding:6px 8px; border:1px solid #e5e7eb; font-size:10pt;">Total</td>
        <td style="padding:6px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${totalExpectedQty.toFixed(0)} pcs</td>
        <td style="padding:6px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${totalExpectedWeight.toFixed(2)} g</td>
        <td style="padding:6px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${totalActualQty.toFixed(0)} pcs</td>
        <td style="padding:6px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;">${totalActualWeight.toFixed(2)} g</td>
        <td style="padding:6px 8px; border:1px solid #e5e7eb; font-size:10pt; text-align:right;"></td>
      </tr>
    `;

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
        <title>Stock Take Report</title>
        <style>
          @page { size: A4; margin: 16mm; }
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11pt; color: #111827; }
          h1 { font-size: 18pt; margin: 0 0 4px 0; }
          .subhead { font-size: 10pt; color: #4b5563; margin-bottom: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th { background: #f3f4f6; font-size: 10pt; text-align: left; padding: 4px 8px; border: 1px solid #e5e7eb; }
        </style>
      </head>
      <body>
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:8px;">
          <div>
            <h1>Stock Take Report</h1>
            <div class="subhead">Generated on ${dateStr} at ${timeStr}</div>
          </div>
        </div>
        ${signatureHtml}
        <table>
          <thead>
            <tr>
              <th style="width:24px; text-align:center;">No</th>
              <th>Label ID</th>
              <th>Item Name</th>
              <th style="text-align:right;">Expected Qty</th>
              <th style="text-align:right;">Expected Weight</th>
              <th style="text-align:right;">Actual Qty</th>
              <th style="text-align:right;">Actual Weight</th>
              <th style="text-align:right;">Difference</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            ${totalsHtml}
          </tbody>
        </table>
      </body>
      </html>
    `;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!doc) {
      alert('Failed to access print frame.');
      document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 500);
      }
    };
  } catch (err) {
    console.error('Error generating stock take print report:', err);
    alert('Failed to generate print report. See console for details.');
  }
}
