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

let stockItems = [];

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('current_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
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

      stockItems.push({
        labelId,
        itemName: inRec.itemName || '--',
        status,
        expectedWeight: measured,
        unit,
        actualWeight: null,
        diff: null,
        stockTakeStatus: 'Not checked',
      });
    });
  } catch (err) {
    console.error('Error loading in-stock items for stock take:', err);
  }

  renderStockTable();
}

function renderStockTable() {
  if (!tableBody) return;
  tableBody.innerHTML = '';
  if (!stockItems.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-500">No in-stock items found.</td></tr>';
    return;
  }

  for (const item of stockItems) {
    const tr = document.createElement('tr');
    const expectedText = item.expectedWeight && !Number.isNaN(item.expectedWeight)
      ? `${Number(item.expectedWeight).toFixed(2)} ${item.unit}`
      : '--';
    const actualText = typeof item.actualWeight === 'number' && !Number.isNaN(item.actualWeight)
      ? `${item.actualWeight.toFixed(2)} g`
      : '--';
    const diffText = typeof item.diff === 'number' && !Number.isNaN(item.diff)
      ? `${item.diff.toFixed(2)} g`
      : '--';
    const statusClass = item.stockTakeStatus.startsWith('Done')
      ? (item.stockTakeStatus.includes('within') ? 'text-green-700' : 'text-red-700')
      : 'text-gray-700';

    tr.innerHTML = `
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${item.labelId}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${item.itemName}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${item.status}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${expectedText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${actualText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${diffText}</td>
      <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold ${statusClass}">${item.stockTakeStatus}</td>
    `;
    tableBody.appendChild(tr);
  }
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
    infoActual.textContent = `${w.toFixed(2)} g`;
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
  infoDiff.textContent = `${diff.toFixed(2)} g${withinTolerance ? ' (within 5g)' : ''}`;
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

  const updated = {
    labelId,
    itemName,
    status,
    expectedWeight,
    unit,
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
    infoExpected.textContent = `${Number(data.expectedWeight).toFixed(2)} ${data.unit}`;
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

window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  logoutBtn?.addEventListener('click', handleLogout);
  resetInfo();
   loadInStockItems();
  qrInput.focus();
});
