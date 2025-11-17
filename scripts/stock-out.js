// --- State ---
let currentScannedData = null;
let cachedAvailableGrams = 0; // availability kept in grams as base
let cachedUnit = 'g';
let cachedPiecesAvailable = null;
let weightPerPieceGrams = null;

const MAX_RECORD_AGE_DAYS = 60;
const MAX_RECORD_AGE_MS = MAX_RECORD_AGE_DAYS * 24 * 60 * 60 * 1000;

// Scale state
let scalePort = null;
let scaleReader = null;
let keepReadingScale = false;
let currentWeight = 0;

// --- DOM ---
const qrInput = document.getElementById('qr-input');
const infoLabelId = document.getElementById('info-label-id');
const infoItemId = document.getElementById('info-item-id');
const infoItemName = document.getElementById('info-item-name');
const infoLotNo = document.getElementById('info-lot-no');
const infoMfgLot = document.getElementById('info-mfg-lot');
const infoAvailable = document.getElementById('info-available');
const outWeightInput = document.getElementById('out-weight');
const unitSelect = document.getElementById('unit-select');
const connectScaleBtn = document.getElementById('connect-scale-btn');
const disconnectScaleBtn = document.getElementById('disconnect-scale-btn');
const scaleStatus = document.getElementById('scale-status');
const scaleRawData = document.getElementById('scale-raw-data');
const currentWeightDisplay = document.getElementById('current-weight');
const saveOutBtn = document.getElementById('save-out-btn');
const statusMessage = document.getElementById('status-message');
const logoutBtn = document.getElementById('logout-btn');
const piecesToTakeEl = document.getElementById('pieces-to-take');
const piecesAvailableEl = document.getElementById('pieces-available');

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

// --- Unit Conversion ---
const unitToGramFactor = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
};

function toGrams(value, unit) {
  const f = unitToGramFactor[unit] || 1;
  return (parseFloat(value) || 0) * f;
}

function fromGrams(grams, unit) {
  const f = unitToGramFactor[unit] || 1;
  return grams / f;
}

function getKeyFromScanned(scanned) {
  if (!scanned) return null;
  if (scanned.labelId) return `LABEL:${scanned.labelId}`;
  const item = scanned.itemId || scanned.item || '';
  const lot = scanned.lotNo || '';
  const mfg = scanned.manufacturingLot || '';
  return `ITEMLOT:${item}|${lot}|${mfg}`;
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

function sumWeights(records) {
  return records.reduce((acc, r) => acc + (typeof r.measuredWeight === 'number' ? r.measuredWeight : 0), 0);
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

function updateInfo(scanned) {
  infoLabelId.textContent = scanned?.labelId || '--';
  infoItemId.textContent = scanned?.itemId || '--';
  infoItemName.textContent = scanned?.itemName || '--';
  infoLotNo.textContent = scanned?.lotNo || '--';
  infoMfgLot.textContent = scanned?.manufacturingLot || '--';
}

function setAvailableDisplay(value, unit) {
  infoAvailable.textContent = `${(value || 0).toFixed(2)} ${unit}`;
}

function updatePiecesDisplay() {
  if (piecesAvailableEl) {
    if (cachedPiecesAvailable === null || cachedPiecesAvailable === undefined) {
      piecesAvailableEl.textContent = '--';
    } else {
      piecesAvailableEl.textContent = Number.isFinite(cachedPiecesAvailable)
        ? cachedPiecesAvailable.toFixed(2)
        : '--';
    }
  }

  if (!piecesToTakeEl) return;

  const pieces = calculateRequestedPieces();
  if (pieces === null || pieces === undefined || !Number.isFinite(pieces)) {
    piecesToTakeEl.textContent = '--';
    return;
  }

  piecesToTakeEl.textContent = pieces.toFixed(2);
}

function enableIfValid() {
  const n = parseFloat(outWeightInput.value);
  const okScan = !!currentScannedData;
  const okNum = !isNaN(n) && n > 0;
  // compare in grams
  const nGrams = toGrams(n, unitSelect.value);
  const within = okNum && nGrams <= cachedAvailableGrams + 1e-9; // small tolerance

  let piecesValid = true;
  const requestedPieces = calculateRequestedPieces();
  if (requestedPieces !== null && requestedPieces !== undefined && Number.isFinite(requestedPieces)) {
    if (cachedPiecesAvailable !== null && cachedPiecesAvailable !== undefined && Number.isFinite(cachedPiecesAvailable)) {
      if (requestedPieces - cachedPiecesAvailable > 1e-6) {
        piecesValid = false;
      }
    }
  }

  saveOutBtn.disabled = !(okScan && okNum && within && piecesValid);
  updatePiecesDisplay();
}

function refreshAvailable() {
  if (!currentScannedData) {
    cachedAvailableGrams = 0;
    setAvailableDisplay(0, cachedUnit);
    cachedPiecesAvailable = null;
    weightPerPieceGrams = null;
    updatePiecesDisplay();
    enableIfValid();
    return;
  }
  const key = getKeyFromScanned(currentScannedData);
  const ins = readLocal('weight_records');
  const outs = readLocal('stock_out_records');

  // Match function for key
  const matchByKey = (rec) => {
    if (!rec) return false;
    if (key.startsWith('LABEL:')) return rec.labelId && `LABEL:${rec.labelId}` === key;
    const k2 = `ITEMLOT:${rec.itemId || ''}|${rec.lotNo || ''}|${rec.manufacturingLot || ''}`;
    return k2 === key;
  };

  const inRecs = ins.filter(matchByKey);
  const outRecs = outs.filter(matchByKey);

  // Choose display unit from latest stock-in for this key, fallback 'g'
  const latestIn = inRecs[0] || null;
  cachedUnit = latestIn?.unit || cachedUnit || 'g';
  unitSelect.value = cachedUnit; // align the UI

  const totalInGrams = inRecs.reduce((acc, r) => acc + toGrams(r.measuredWeight || 0, r.unit || 'g'), 0);
  const totalOutGrams = outRecs.reduce((acc, r) => acc + toGrams(r.outWeight || 0, r.unit || 'g'), 0);
  cachedAvailableGrams = Math.max(0, totalInGrams - totalOutGrams);
  setAvailableDisplay(fromGrams(cachedAvailableGrams, cachedUnit), cachedUnit);

  // Pieces tracking
  const totalInPieces = inRecs.reduce((acc, r) => acc + (parseFloat(r.quantity) || 0), 0);
  const totalOutPieces = outRecs.reduce((acc, r) => acc + (parseFloat(r.outPieces) || 0), 0);
  cachedPiecesAvailable = Math.max(0, totalInPieces - totalOutPieces);

  // Determine weight per piece using weighted average from stock-in records
  let weightedGrams = 0;
  let weightedPieces = 0;
  for (const rec of inRecs) {
    const qty = parseFloat(rec.quantity);
    if (!qty || qty <= 0) continue;
    const grams = toGrams(rec.measuredWeight || 0, rec.unit || 'g');
    if (!grams || grams <= 0) continue;
    weightedGrams += grams;
    weightedPieces += qty;
  }
  weightPerPieceGrams = weightedPieces > 0 && weightedGrams > 0 ? weightedGrams / weightedPieces : null;

  updatePiecesDisplay();
  enableIfValid();
}

function clearOutInputs() {
  outWeightInput.value = '';
}

// --- Events ---
qrInput.addEventListener('click', (e) => {
  e.target.value = '';
});
qrInput.addEventListener('change', (e) => {
  const data = e.target.value;
  if (!data) return;
  currentScannedData = parseScanned(data);
  updateInfo(currentScannedData);
  showStatus('Code scanned.', false);
  refreshAvailable();
  e.target.value = '';
});

unitSelect.addEventListener('change', () => {
  cachedUnit = unitSelect.value;
  setAvailableDisplay(fromGrams(cachedAvailableGrams, cachedUnit), cachedUnit);
  enableIfValid();
});

outWeightInput.addEventListener('input', enableIfValid);

function calculateRequestedPieces() {
  if (!weightPerPieceGrams || weightPerPieceGrams <= 0) return null;
  const n = parseFloat(outWeightInput.value);
  if (isNaN(n) || n <= 0) return null;
  const grams = toGrams(n, unitSelect.value);
  if (!isFinite(grams) || grams < 0) return null;
  const pieces = grams / weightPerPieceGrams;
  return isFinite(pieces) ? pieces : null;
}

saveOutBtn.addEventListener('click', () => {
  if (!currentScannedData) {
    showStatus('Scan an item first.', true);
    return;
  }
  const n = parseFloat(outWeightInput.value);
  if (isNaN(n) || n <= 0) {
    showStatus('Enter a valid weight to stock out.', true);
    return;
  }
  const nGrams = toGrams(n, unitSelect.value);
  if (nGrams > cachedAvailableGrams + 1e-9) {
    showStatus('Out weight exceeds available.', true);
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
  const requestedPieces = calculateRequestedPieces();
  outs.push({
    ...currentScannedData,
    outWeight: n,
    unit: unitSelect.value,
    timestamp: new Date().toISOString(),
    responsibleUser: currentUser.displayName || currentUser.name || currentUser.username || '',
    outPieces: requestedPieces !== null && requestedPieces !== undefined && isFinite(requestedPieces)
      ? Number(requestedPieces.toFixed(2))
      : null
  });
  writeLocal('stock_out_records', outs);

  showStatus('Stock out saved.', false);
  clearOutInputs();
  refreshAvailable();
  qrInput.focus();
});

// Focus QR input on load
window.addEventListener('DOMContentLoaded', () => {
  if (!ensureLoggedIn()) return;
  logoutBtn?.addEventListener('click', handleLogout);
  qrInput.focus();
});

// --- Web Serial (Scale) Integration ---
function updateCurrentWeightDisplay() {
  currentWeightDisplay.textContent = (currentWeight || 0).toFixed(2);
}

async function connectScale() {
  if (!('serial' in navigator)) {
    showStatus('Web Serial API not supported in your browser.', true);
    return;
  }
  try {
    scalePort = await navigator.serial.requestPort();
    await scalePort.open({ baudRate: 2400, dataBits: 7, stopBits: 1, parity: 'even' });
    scaleStatus.textContent = 'Connected';
    scaleStatus.className = 'text-xl font-bold text-green-600';
    connectScaleBtn.style.display = 'none';
    disconnectScaleBtn.style.display = 'block';
    keepReadingScale = true;
    qrInput.focus();
    readFromScale();
  } catch (err) {
    console.error('Error connecting to scale:', err);
    scaleStatus.textContent = 'Connection Failed';
    scaleStatus.className = 'text-xl font-bold text-red-600';
    showStatus(err.message || 'Failed to connect to scale.', true);
  }
}

async function disconnectScale() {
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
  scaleStatus.className = 'text-xl font-bold text-red-600';
  connectScaleBtn.style.display = 'block';
  disconnectScaleBtn.style.display = 'none';
}

async function readFromScale() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = scalePort.readable.pipeTo(textDecoder.writable);
  scaleReader = textDecoder.readable.getReader();
  let lineBuffer = '';

  while (scalePort?.readable && keepReadingScale) {
    try {
      const { value, done } = await scaleReader.read();
      if (done) break;
      lineBuffer += value;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        parseScaleData(line.trim());
      }
    } catch (error) {
      console.error('Error reading from scale:', error);
      break;
    }
  }
  if (scaleReader) { try { scaleReader.releaseLock(); } catch {} }
  try { await readableStreamClosed.catch(() => {}); } catch {}
}

function parseScaleData(data) {
  scaleRawData.textContent = data;
  const parts = data.split(',');
  let weight = NaN;
  if (parts.length >= 2) {
    weight = parseFloat(parts[1]);
  } else {
    weight = parseFloat(data);
  }
  if (!isNaN(weight)) {
    currentWeight = weight;
    updateCurrentWeightDisplay();
    // Auto-fill the out weight input with the latest reading
    outWeightInput.value = weight.toFixed(2);
    enableIfValid();
  }
}

connectScaleBtn?.addEventListener('click', connectScale);
disconnectScaleBtn?.addEventListener('click', disconnectScale);

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
  const headers = ['Date', 'Label ID', 'Item Name', 'Item ID', 'Lot No', 'Manufacturing Lot', 'Responsible', 'Out Weight', 'Unit'];
  const rows = prunedOuts.map(r => [
    r.timestamp ? new Date(r.timestamp).toISOString() : '',
    r.labelId || '',
    r.itemName || '',
    r.itemId || '',
    r.lotNo || '',
    r.manufacturingLot || '',
    r.responsibleUser || '',
    typeof r.outWeight === 'number' ? r.outWeight.toFixed(2) : '',
    r.unit || ''
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
  toGrams,
  fromGrams,
};
