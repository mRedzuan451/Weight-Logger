const { ensureLoggedIn, formatNumber, getCurrentUser, redirectToLogin, safeParseArray } = window.WeightLoggerUtils;

// --- Global State ---
let scalePort = null;
let scaleReader = null;
let keepReadingScale = false;
let scaleConnectInProgress = false;
let stockInSaveInProgress = false;

const PREFERRED_SCALE_IDS = [
    { usbVendorId: 0x0557, usbProductId: 0x2008 }, // ATEN UC232A
    { usbVendorId: 0x0557, usbProductId: 0x2011 }, // Alternate ATEN variants
];

const SCALE_SERIAL_OPTIONS = {
    baudRate: 2400,
    dataBits: 7,
    stopBits: 1,
    parity: 'even',
};

// Unit conversion helpers (base unit: grams)
const unitToGramFactor = {
    g: 1,
    kg: 1000,
    lb: 453.59237,
    oz: 28.349523125,
};

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

function toGrams(value, unit) {
    const f = unitToGramFactor[unit] || 1;
    return (parseFloat(value) || 0) * f;
}

// Check if a label already has an active stock-in (latest event for that label is IN)
function hasActiveStockInForLabel(labelId) {
    try {
        if (!labelId) return false;

        const ins = getWeightRecordsArray();
        const outs = getStockOutRecordsArray();
        if (!Array.isArray(ins) && !Array.isArray(outs)) return false;

        const events = [];
        if (Array.isArray(ins)) {
            for (const r of ins) {
                if (r && r.labelId === labelId) {
                    events.push({ type: 'IN', timestamp: r.timestamp || '' });
                }
            }
        }
        if (Array.isArray(outs)) {
            for (const r of outs) {
                if (r && r.labelId === labelId) {
                    events.push({ type: 'OUT', timestamp: r.timestamp || '' });
                }
            }
        }

        if (!events.length) return false;

        events.sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        });

        return events[0].type === 'IN';
    } catch (err) {
        console.error('Error checking active stock-in for label:', err);
        return false;
    }
}

let currentScannedData = null;
let currentWeight = 0;
let lockedWeight = null;
let lockedWeightSource = null; // 'auto' or 'manual'

const AUTO_LOCK_THRESHOLD = 0.01; // Minimum change required to refresh auto lock
const PARTIAL_WEIGHT_TOLERANCE_GRAMS = 5; // Allowable tolerance for partial packets
const MAX_RECORD_AGE_DAYS = 60;
const MAX_RECORD_AGE_MS = MAX_RECORD_AGE_DAYS * 24 * 60 * 60 * 1000;

// Pagination State
let allDocs = []; // Will hold all sorted records
let currentPage = 1;
const recordsPerPage = 20; // Show 20 records per page

// --- DOM Elements ---
const connectScaleBtn = document.getElementById('connect-scale-btn');
const disconnectScaleBtn = document.getElementById('disconnect-scale-btn');
const scaleStatus = document.getElementById('scale-status');
const scaleRawData = document.getElementById('scale-raw-data');
const currentWeightDisplay = document.getElementById('current-weight');
const unitSelect = document.getElementById('unit-select');
const lockWeightBtn = document.getElementById('lock-weight-btn');
const manualWeightInput = document.getElementById('manual-weight-input');
const manualWeightApplyBtn = document.getElementById('manual-weight-apply');

const qrInput = document.getElementById('qr-input');
const scanModeBarcodeBtn = document.getElementById('scan-mode-barcode');
const scanModeManualBtn = document.getElementById('scan-mode-manual');
const manualEntryForm = document.getElementById('manual-entry-form');
const manualLabelIdInput = document.getElementById('manual-label-id');
const manualItemIdInput = document.getElementById('manual-item-id');
const manualItemNameInput = document.getElementById('manual-item-name');
const manualLotNoInput = document.getElementById('manual-lot-no');
const manualMfgLotInput = document.getElementById('manual-mfg-lot');
const manualQtyInput = document.getElementById('manual-qty');
const manualEntrySubmitBtn = document.getElementById('manual-entry-submit');

const infoLabelId = document.getElementById('info-label-id');
const infoItemId = document.getElementById('info-item-id');
const infoItemName = document.getElementById('info-item-name');
const infoLotNo = document.getElementById('info-lot-no');
const infoMfgLot = document.getElementById('info-mfg-lot');
const infoQuantity = document.getElementById('info-quantity');
const infoLockedWeight = document.getElementById('info-locked-weight');
const infoPrevWeight = document.getElementById('info-prev-weight');

const saveRecordBtn = document.getElementById('save-record-btn');
const statusMessage = document.getElementById('status-message');

// Page view elements
const loggerView = document.getElementById('logger-view');
const recordsView = document.getElementById('records-view');
const viewAllBtn = document.getElementById('view-all-btn');
const backToLoggerBtn = document.getElementById('back-to-logger-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const recentRecordsBody = document.getElementById('recent-records-body');
const allRecordsBody = document.getElementById('all-records-body');
const logoutBtn = document.getElementById('logout-btn');

// Pagination Elements
const paginationControls = document.getElementById('pagination-controls');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const pageInfo = document.getElementById('page-info');

// --- Utility Functions ---
let weightRecordsCache = null;
let stockOutRecordsCache = null;

function getWeightRecordsArray() {
    if (!weightRecordsCache) {
        const raw = localStorage.getItem('weight_records');
        weightRecordsCache = safeParseArray(raw);
    }
    return weightRecordsCache;
}

function saveWeightRecordsArray(records) {
    const arr = Array.isArray(records) ? records : [];
    try {
        localStorage.setItem('weight_records', JSON.stringify(arr));
        weightRecordsCache = arr;
        return true;
    } catch (err) {
        console.error('Error saving weight_records:', err);
        return false;
    }
}

function getStockOutRecordsArray() {
    if (!stockOutRecordsCache) {
        const raw = localStorage.getItem('stock_out_records');
        stockOutRecordsCache = safeParseArray(raw);
    }
    return stockOutRecordsCache;
}

function applyPartialPacketLogic(scanned) {
    try {
        const labelId = (scanned && scanned.labelId) || '';
        if (!labelId) return scanned;

        const ins = getWeightRecordsArray();
        const outs = getStockOutRecordsArray();
        if (!Array.isArray(ins) || !Array.isArray(outs)) return scanned;

        const inForLabel = ins.filter(r => r && r.labelId === labelId);
        const outForLabel = outs.filter(r => r && r.labelId === labelId);
        if (!inForLabel.length || !outForLabel.length) return scanned;

        // There is at least one previous IN and OUT for this label -> label reused
        const isPartial = window.confirm(
            `Label ${labelId} was previously stocked out.\n\nOK = Partial packet (estimate quantity from weight)\nCancel = Full packet (use label quantity).`
        );
        if (!isPartial) {
            return scanned;
        }

        // Use the most recent stock-in for weight/quantity reference
        inForLabel.sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        });
        const ref = inForLabel[0];
        const baseWeight = typeof ref.measuredWeight === 'number' ? ref.measuredWeight : parseFloat(ref.measuredWeight);
        const baseUnit = ref.unit || 'g';
        const baseQty = parseFloat(ref.quantity || scanned.quantity);

        const baseWeightGrams = toGrams(baseWeight, baseUnit);
        if (!baseWeightGrams || !baseQty || !isFinite(baseWeightGrams) || !isFinite(baseQty) || baseWeightGrams <= 0 || baseQty <= 0) {
            showStatusMessage('Cannot estimate quantity for partial packet (missing previous weight/quantity).', true);
            return scanned;
        }

        const clone = { ...scanned };
        clone._partialBaseWeightGrams = baseWeightGrams;
        clone._partialBaseQty = baseQty;
        if (!Number.isNaN(baseWeight) && isFinite(baseWeight)) {
            const baseDisplay = `${formatNumber(baseWeight, 2)} ${baseUnit}`;
            clone.previousWeightDisplay = baseDisplay;
        }
        // Defer quantity calculation until weight is locked
        clone.quantity = '--';
        showStatusMessage('Partial packet detected: quantity will be estimated from weight when saving.', false);
        return clone;
    } catch (error) {
        console.error('Error applying partial packet logic:', error);
        return scanned;
    }
}


function handleLogout(event) {
    if (event) {
        event.preventDefault();
    }
    localStorage.removeItem('current_user');
    redirectToLogin();
}

function pruneOldRecords(records) {
    if (!Array.isArray(records)) {
        return [];
    }
    const cutoff = Date.now() - MAX_RECORD_AGE_MS;
    return records.filter(record => {
        if (!record || !record.timestamp) {
            return true;
        }
        const time = new Date(record.timestamp).getTime();
        return Number.isNaN(time) || time >= cutoff;
    });
}

function showStatusMessage(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message'; // Reset classes
    if (isError) {
        statusMessage.classList.add('status-error');
    } else {
        statusMessage.classList.add('status-success');
    }
    statusMessage.style.display = 'block';
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 3000);
}

function checkSaveButtonState() {
    if (currentScannedData && lockedWeight !== null) {
        saveRecordBtn.disabled = false;
    } else {
        saveRecordBtn.disabled = true;
    }
}

function updateLockedWeightDisplay() {
    if (lockedWeight !== null) {
        const unit = unitSelect.value;
        infoLockedWeight.textContent = `${formatNumber(lockedWeight, 2)} ${unit}`;
    } else {
        infoLockedWeight.textContent = '--';
    }
}

function setLockedWeight(weight, source, { showMessage = false } = {}) {
    if (typeof weight !== 'number' || isNaN(weight)) {
        return false;
    }

    const normalizedSource = source === 'manual' ? 'manual' : 'auto';
    const isManual = normalizedSource === 'manual';

    if (!isManual && lockedWeightSource === 'manual') {
        return false; // Respect manual lock unless user updates it
    }

    const shouldOverride = isManual
        || lockedWeight === null
        || Math.abs((lockedWeight ?? 0) - weight) > AUTO_LOCK_THRESHOLD
        || lockedWeightSource !== normalizedSource;

    if (!shouldOverride) {
        return false;
    }

    lockedWeight = weight;
    lockedWeightSource = normalizedSource;
    updateLockedWeightDisplay();

    // If current scan is a partial packet, estimate and display quantity now
    if (currentScannedData && currentScannedData._partialBaseWeightGrams && currentScannedData._partialBaseQty) {
        const baseGrams = currentScannedData._partialBaseWeightGrams;
        const baseQty = currentScannedData._partialBaseQty;
        const lockedGrams = toGrams(lockedWeight, unitSelect.value);
        if (baseGrams > 0 && baseQty > 0 && lockedGrams > 0) {
            let finalQty;

            // If the current weight is within ±5g of the original full weight, treat as full packet
            if (Math.abs(lockedGrams - baseGrams) <= PARTIAL_WEIGHT_TOLERANCE_GRAMS) {
                finalQty = baseQty;
            } else {
                const estQty = lockedGrams * (baseQty / baseGrams);
                if (isFinite(estQty) && estQty > 0) {
                    finalQty = Math.round(estQty);
                }
            }

            if (finalQty && isFinite(finalQty) && finalQty > 0) {
                currentScannedData = {
                    ...currentScannedData,
                    quantity: String(finalQty),
                };
                infoQuantity.textContent = currentScannedData.quantity;
            }
        }
    }

    if (showMessage) {
        const message = normalizedSource === 'auto'
            ? 'Weight auto-locked from scale.'
            : 'Weight locked!';
        showStatusMessage(message, false);
    }

    checkSaveButtonState();
    return true;
}

function resetForm() {
    currentScannedData = null;
    lockedWeight = null;
    lockedWeightSource = null;

    infoLabelId.textContent = '--';
    infoItemId.textContent = '--';
    infoItemName.textContent = '--';
    infoLotNo.textContent = '--';
    infoMfgLot.textContent = '--';
    infoQuantity.textContent = '--';
    if (infoPrevWeight) infoPrevWeight.textContent = '--';
    updateLockedWeightDisplay();

    qrInput.value = '';
    qrInput.focus();
    checkSaveButtonState();
}

// --- Page Navigation ---
viewAllBtn.addEventListener('click', () => {
    loggerView.style.display = 'none';
    recordsView.style.display = 'block';
});

backToLoggerBtn.addEventListener('click', () => {
    recordsView.style.display = 'none';
    loggerView.style.display = 'block';
});

// --- Pagination Navigation ---
prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderAllRecordsView();
    }
});

nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(allDocs.length / recordsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderAllRecordsView();
    }
});

exportCsvBtn.addEventListener('click', () => {
    exportAllRecordsAsCsv();
});

// --- Web Serial API (Scale) ---
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
        try {
            await scaleReader.cancel();
        } catch (err) {
            console.warn('Error cancelling reader:', err);
        }
    }
    if (scalePort) {
        try {
            await scalePort.close();
        } catch (err) {
            console.warn('Error closing port:', err);
        }
    }

    scalePort = null;
    scaleReader = null;
    scaleStatus.textContent = 'Not Connected';
    scaleStatus.className = 'text-xl font-bold text-red-600';
    connectScaleBtn.style.display = 'block';
    disconnectScaleBtn.style.display = 'none';
    if (!quiet) {
        showStatusMessage('Scale disconnected.', false);
    }
}

async function beginScaleSession(port) {
    if (!port) throw new Error('No serial port provided.');
    await disconnectScale({ quiet: true });
    try {
        await port.open(SCALE_SERIAL_OPTIONS);
        scalePort = port;
        scaleStatus.textContent = 'Connected';
        scaleStatus.className = 'text-xl font-bold text-green-600';
        connectScaleBtn.style.display = 'none';
        disconnectScaleBtn.style.display = 'block';
        keepReadingScale = true;
        qrInput.focus();
        readFromScale();
    } catch (err) {
        scalePort = null;
        console.error('Error connecting to scale:', err);
        scaleStatus.textContent = 'Connection Failed';
        scaleStatus.className = 'text-xl font-bold text-red-600';
        throw err;
    }
}

async function connectPreferredScale({ auto = false } = {}) {
    if (scaleConnectInProgress) {
        showStatusMessage('Scale connection already in progress.', true);
        return;
    }
    if (!('serial' in navigator)) {
        showStatusMessage('Web Serial API not supported in this browser.', true);
        return;
    }

    scaleConnectInProgress = true;
    connectScaleBtn.disabled = true;
    try {
        const grantedPorts = await navigator.serial.getPorts();
        let port = grantedPorts.find(isPreferredScalePort);

        if (!port) {
            if (auto) {
                // On auto-connect, we are not allowed to show the chooser without a user gesture.
                // Just update status and tell the user to click Connect Scale.
                scaleStatus.textContent = 'Not Connected';
                scaleStatus.className = 'text-xl font-bold text-red-600';
                connectScaleBtn.style.display = 'block';
                disconnectScaleBtn.style.display = 'none';
                showStatusMessage('Scale not yet authorised. Click "Connect Scale" and choose the ATEN USB to Serial Bridge.', true);
                return;
            }

            // Manual connect: open the chooser without strict filters so the
            // user can pick their ATEN bridge or compatible serial adapter.
            port = await navigator.serial.requestPort();
        }

        // Prefer ATEN, but still allow other serial devices if the user chose them.
        if (!isPreferredScalePort(port)) {
            showStatusMessage('Connected to a serial device (not recognised as ATEN). If weights look wrong, re-connect and pick the ATEN USB to Serial Bridge.', false);
        }

        await beginScaleSession(port);
        showStatusMessage(auto ? 'Scale connected automatically.' : 'Scale connected.', false);
    } catch (error) {
        if (error.name === 'NotFoundError') {
            showStatusMessage('Preferred scale not found. Please connect the ATEN USB to Serial Bridge.', true);
        } else if (error.name === 'SecurityError') {
            showStatusMessage('Serial access denied. Please allow permission for the ATEN USB to Serial Bridge.', true);
        } else if (error.name === 'AbortError') {
            // User cancelled the selection; no need to show an error.
        } else {
            console.error('Error during scale connection:', error);
            showStatusMessage(error.message || 'Failed to connect to the scale.', true);
        }
    } finally {
        scaleConnectInProgress = false;
        connectScaleBtn.disabled = false;
    }
}

connectScaleBtn.addEventListener('click', () => {
    (async () => {
        try {
            if ('serial' in navigator) {
                const ports = await navigator.serial.getPorts();
                if (!ports || !ports.length) {
                    const currentPage = (location.pathname.split('/').pop()) || 'index.html';
                    const url = new URL('ports.html', window.location.href);
                    url.searchParams.set('return', currentPage);
                    const w = window.open(url.toString(), 'ports', 'width=900,height=700');
                    if (!w) {
                        window.location.href = url.toString();
                    }
                    showStatusMessage('Open Ports window to grant serial access, then come back and click Connect again.', true);
                    return;
                }
            }
        } catch {
        }
        connectPreferredScale({ auto: false });
    })();
});

disconnectScaleBtn.addEventListener('click', () => {
    disconnectScale({ quiet: false });
});

async function readFromScale() {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = scalePort.readable.pipeTo(textDecoder.writable);
    scaleReader = textDecoder.readable.getReader();

    let lineBuffer = '';

    while (scalePort.readable && keepReadingScale) {
        try {
            const { value, done } = await scaleReader.read();
            if (done) {
                break;
            }

            lineBuffer += value;
            const lines = lineBuffer.split(/\r\n|\n|\r/);
            lineBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    parseScaleData(line.trim());
                }
            }
        } catch (error) {
            console.error('Error reading from scale:', error);
            break;
        }
    }

    if (scaleReader) {
        try {
            scaleReader.releaseLock();
        } catch {}
    }
    try {
        await readableStreamClosed.catch(() => {});
    } catch {}
}

function parseScaleData(data) {
    scaleRawData.textContent = data;

    const parts = data.split(',');

    let weight = NaN;
    if (parts.length >= 2) {
        weight = parseFloat(parts[1]);
        if (Number.isNaN(weight) && parts.length >= 3) {
            weight = parseFloat(parts[2]);
        }
    } else {
        weight = parseFloat(data);
    }

    if (Number.isNaN(weight)) {
        const match = String(data).match(/-?\d+(?:\.\d+)?/);
        if (match) {
            weight = parseFloat(match[0]);
        }
    }

    if (!Number.isNaN(weight)) {
        currentWeight = weight;
        currentWeightDisplay.textContent = formatNumber(weight, 2);
        setLockedWeight(currentWeight, 'auto');
    }
}

function applyManualWeight() {
    try {
        const raw = manualWeightInput ? manualWeightInput.value : '';
        const n = Number(raw);
        if (!Number.isFinite(n)) {
            showStatusMessage('Invalid manual weight value.', true);
            manualWeightInput?.focus();
            return;
        }
        if (n <= 0) {
            showStatusMessage('Manual weight must be greater than zero.', true);
            manualWeightInput?.focus();
            return;
        }

        currentWeight = n;
        currentWeightDisplay.textContent = formatNumber(n, 2);
        setLockedWeight(currentWeight, 'manual', { showMessage: true });
    } catch (err) {
        console.error('Error applying manual weight:', err);
        showStatusMessage('Failed to apply manual weight. See console.', true);
    }
}

// --- QR Code Scanner ---
let scanInputMode = 'barcode';

function setScanInputMode(mode) {
    scanInputMode = mode === 'manual' ? 'manual' : 'barcode';

    if (scanModeBarcodeBtn && scanModeManualBtn) {
        if (scanInputMode === 'barcode') {
            scanModeBarcodeBtn.className = 'px-3 py-1 text-sm font-semibold bg-indigo-600 text-white';
            scanModeManualBtn.className = 'px-3 py-1 text-sm font-semibold bg-white text-gray-700';
        } else {
            scanModeBarcodeBtn.className = 'px-3 py-1 text-sm font-semibold bg-white text-gray-700';
            scanModeManualBtn.className = 'px-3 py-1 text-sm font-semibold bg-indigo-600 text-white';
        }
    }

    if (qrInput) {
        if (scanInputMode === 'barcode') {
            qrInput.classList.remove('hidden');
            qrInput.placeholder = 'Click here and then scan...';
        } else {
            qrInput.classList.add('hidden');
        }
    }
    if (manualEntryForm) {
        if (scanInputMode === 'manual') {
            manualEntryForm.classList.remove('hidden');
        } else {
            manualEntryForm.classList.add('hidden');
        }
    }
}

function submitManualEntry() {
    try {
        const labelId = (manualLabelIdInput?.value || '').trim();
        if (!labelId) {
            showStatusMessage('Label ID is required.', true);
            manualLabelIdInput?.focus();
            return;
        }

        if (hasActiveStockInForLabel(labelId)) {
            window.alert(`Label ${labelId} is already stocked in and not yet stocked out.`);
            return;
        }

        const itemId = (manualItemIdInput?.value || '').trim() || '--';
        const itemName = (manualItemNameInput?.value || '').trim() || '--';
        const lotNo = (manualLotNoInput?.value || '').trim() || '--';
        const manufacturingLot = (manualMfgLotInput?.value || '').trim() || '--';
        const qtyRaw = (manualQtyInput?.value || '').trim();
        const quantity = qtyRaw ? String(qtyRaw) : '--';

        const baseScanned = {
            labelId,
            itemId,
            itemName,
            lotNo,
            manufacturingLot,
            quantity,
            originalQrData: {
                manualEntry: true,
                labelId,
                itemId,
                itemName,
                lotNo,
                manufacturingLot,
                quantity,
            }
        };

        const adjusted = applyPartialPacketLogic(baseScanned);
        currentScannedData = adjusted;
        infoLabelId.textContent = adjusted.labelId || '--';
        infoItemId.textContent = adjusted.itemId || '--';
        infoItemName.textContent = adjusted.itemName || '--';
        infoLotNo.textContent = adjusted.lotNo || '--';
        infoMfgLot.textContent = adjusted.manufacturingLot || '--';
        infoQuantity.textContent = adjusted.quantity || '--';
        if (infoPrevWeight) {
            if (adjusted.previousWeightDisplay) {
                infoPrevWeight.textContent = adjusted.previousWeightDisplay;
            } else {
                infoPrevWeight.textContent = '--';
            }
        }
        showStatusMessage('Manual entry saved for this label.', false);
        checkSaveButtonState();
    } catch (err) {
        console.error('Error submitting manual entry:', err);
        showStatusMessage('Failed to submit manual entry. See console.', true);
    }
}

scanModeBarcodeBtn?.addEventListener('click', () => {
    setScanInputMode('barcode');
    try { qrInput?.focus(); } catch {}
});
scanModeManualBtn?.addEventListener('click', () => {
    setScanInputMode('manual');
    try { manualLabelIdInput?.focus(); } catch {}
});

qrInput.addEventListener('click', (event) => {
    event.target.classList.remove('border-red-500', 'ring-red-300');
    if (scanInputMode === 'barcode') {
        event.target.value = '';
    }
});
qrInput.addEventListener('change', (event) => {
    if (scanInputMode !== 'barcode') {
        return;
    }
    const data = event.target.value;
    if (data) {
        handleQrData(data);
        event.target.value = '';
    }
});
manualEntrySubmitBtn?.addEventListener('click', () => {
    submitManualEntry();
});
const manualEntryInputs = [
    manualLabelIdInput,
    manualItemIdInput,
    manualItemNameInput,
    manualLotNoInput,
    manualMfgLotInput,
    manualQtyInput,
].filter(Boolean);
manualEntryInputs.forEach((el) => {
    el.addEventListener('keydown', (event) => {
        if (scanInputMode !== 'manual') return;
        if (event.key === 'Enter') {
            event.preventDefault();
            submitManualEntry();
        }
    });
});

setScanInputMode('barcode');

function handleQrData(data) {
    const raw = (data || '').trim();
    if (!raw) {
        return;
    }

    const assignScannedData = (scannedData, statusText) => {
        currentScannedData = scannedData;
        infoLabelId.textContent = scannedData.labelId || '--';
        infoItemId.textContent = scannedData.itemId || '--';
        infoItemName.textContent = scannedData.itemName || '--';
        infoLotNo.textContent = scannedData.lotNo || '--';
        infoMfgLot.textContent = scannedData.manufacturingLot || '--';
        infoQuantity.textContent = scannedData.quantity || '--';
        if (infoPrevWeight) {
            if (scannedData.previousWeightDisplay) {
                infoPrevWeight.textContent = scannedData.previousWeightDisplay;
            } else {
                infoPrevWeight.textContent = '--';
            }
        }
        if (statusText) {
            showStatusMessage(statusText, false);
        }
        checkSaveButtonState();
    };

    const fallbackData = {
        labelId: raw,
        itemId: '--',
        itemName: '--',
        lotNo: '--',
        manufacturingLot: '--',
        quantity: '--',
        originalQrData: raw
    };

    if (!raw.startsWith('{')) {
        if (hasActiveStockInForLabel(fallbackData.labelId)) {
            window.alert(`Label ${fallbackData.labelId} is already stocked in and not yet stocked out.`);
            return;
        }
        const adjusted = applyPartialPacketLogic(fallbackData);
        assignScannedData(adjusted, 'Barcode scanned (non-JSON format).');
        return;
    }

    try {
        const parsedData = JSON.parse(raw);
        if (parsedData.id && parsedData.item && parsedData.name) {
            let quantity = '--';
            let lotNo = '--';
            if (parsedData.detail && parsedData.detail.length > 0) {
                const detailParts = parsedData.detail[0].split(',');
                if (detailParts.length >= 4) {
                    lotNo = detailParts[3];
                }
                if (detailParts.length >= 5) {
                    quantity = parseFloat(detailParts[4]).toString();
                }
            }

            const baseScanned = {
                labelId: parsedData.id,
                itemId: parsedData.item,
                itemName: parsedData.name,
                lotNo: lotNo,
                manufacturingLot: parsedData.mfglot,
                quantity: quantity,
                originalQrData: parsedData
            };

            if (hasActiveStockInForLabel(baseScanned.labelId)) {
                window.alert(`Label ${baseScanned.labelId} is already stocked in and not yet stocked out.`);
                return;
            }

            const adjusted = applyPartialPacketLogic(baseScanned);
            assignScannedData(adjusted, 'QR Code scanned successfully!');
        } else {
            throw new Error("Invalid JSON structure in QR code. Missing 'id', 'item', or 'name'.");
        }
    } catch (err) {
        console.warn('QR Parse Error:', err);
        assignScannedData(fallbackData, 'Scanned data is not valid JSON. Stored as plain barcode.');
    }
}

// --- Data Locking & Saving ---
lockWeightBtn.addEventListener('click', () => {
    setLockedWeight(currentWeight, 'manual', { showMessage: true });
});

manualWeightApplyBtn?.addEventListener('click', () => {
    applyManualWeight();
});
manualWeightInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        applyManualWeight();
    }
});

unitSelect.addEventListener('change', () => {
    updateLockedWeightDisplay();
});

saveRecordBtn.addEventListener('click', async () => {
    if (stockInSaveInProgress) {
        showStatusMessage('A save is already in progress.', true);
        return;
    }
    if (!currentScannedData) {
        showStatusMessage('Scan a label before saving.', true);
        if (qrInput) {
            qrInput.focus();
            qrInput.classList.add('border-red-500', 'ring-red-300');
        }
        return;
    }
    if (qrInput) {
        qrInput.classList.remove('border-red-500', 'ring-red-300');
    }

    if (lockedWeight === null) {
        showStatusMessage('Lock a weight before saving.', true);
        lockWeightBtn?.focus();
        return;
    }

    if (typeof lockedWeight !== 'number' || !Number.isFinite(lockedWeight) || lockedWeight <= 0) {
        showStatusMessage('Locked weight must be greater than zero.', true);
        lockWeightBtn?.focus();
        return;
    }

    stockInSaveInProgress = true;
    saveRecordBtn.disabled = true;
    saveRecordBtn.textContent = 'Saving...';

    try {
        const currentUser = getCurrentUser();
        if (!currentUser) {
            showStatusMessage('Please login before saving.', true);
            const ret = encodeURIComponent((location.pathname.split('/').pop()) || 'index.html');
            window.location.href = `login.html?return=${ret}`;
            return;
        }
        const { _partialBaseWeightGrams, _partialBaseQty, ...cleanScanned } = currentScannedData || {};

        const record = {
            ...cleanScanned,
            measuredWeight: lockedWeight,
            unit: unitSelect.value,
            timestamp: new Date().toISOString(),
            responsibleUser: currentUser.displayName || currentUser.name || currentUser.username || ''
        };

        let records = getWeightRecordsArray();
        if (!Array.isArray(records)) {
            records = [];
        }

        records.push(record);
        records = pruneOldRecords(records);

        if (!saveWeightRecordsArray(records)) {
            throw new Error('Unable to save record to local storage. Storage may be full or unavailable.');
        }

        showStatusMessage('Record saved successfully!', false);
        resetForm();
        loadRecords();
    } catch (err) {
        console.error('Error saving record:', err);
        showStatusMessage(err?.message || 'Error saving record. Check console.', true);
    } finally {
        stockInSaveInProgress = false;
        saveRecordBtn.disabled = false;
        saveRecordBtn.textContent = 'Save Record to Database';
        checkSaveButtonState();
    }
});

// --- Data Loading (from localStorage) ---
function loadRecords() {
    let loadedDocs = [];
    try {
        const storedRecords = getWeightRecordsArray();
        const prunedDocs = pruneOldRecords(storedRecords);
        if (prunedDocs.length !== storedRecords.length) {
            saveWeightRecordsArray(prunedDocs);
        }
        loadedDocs = prunedDocs;
    } catch (error) {
        console.error('Error parsing records from localStorage:', error);
        showStatusMessage('Error loading records from storage.', true);
        loadedDocs = [];
    }

    if (loadedDocs.length === 0) {
        recentRecordsBody.innerHTML = `
            <tr>
                <td colspan="9" class="py-6 text-center text-gray-500">No records found.</td>
            </tr>`;
        allRecordsBody.innerHTML = `
            <tr>
                <td colspan="9" class="py-6 text-center text-gray-500">No records found.</td>
            </tr>`;
        allDocs = [];
        paginationControls.style.display = 'none';
        pageInfo.textContent = 'Page 0 of 0';
        return;
    }

    loadedDocs.sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    allDocs = loadedDocs;

    recentRecordsBody.innerHTML = '';
    const recentDocs = allDocs.slice(0, 5);
    if (recentDocs.length === 0) {
        recentRecordsBody.innerHTML = `
            <tr>
                <td colspan="8" class="py-6 text-center text-gray-500">No records found.</td>
            </tr>`;
    } else {
        recentDocs.forEach(doc => {
            recentRecordsBody.appendChild(createRecordRow(doc));
        });
    }

    const totalPages = Math.ceil(allDocs.length / recordsPerPage);
    if (currentPage > totalPages) {
        currentPage = totalPages || 1;
    }
    renderAllRecordsView();
}

function renderAllRecordsView() {
    allRecordsBody.innerHTML = '';

    const docs = allDocs || [];

    if (docs.length === 0) {
        allRecordsBody.innerHTML = `
            <tr>
                <td colspan="9" class="py-6 text-center text-gray-500">No records found.</td>
            </tr>`;
        paginationControls.style.display = 'none';
        pageInfo.textContent = 'Page 0 of 0';
        return;
    }

    paginationControls.style.display = 'flex';

    const totalPages = Math.ceil(docs.length / recordsPerPage);

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = startIndex + recordsPerPage;
    const paginatedDocs = docs.slice(startIndex, endIndex);

    paginatedDocs.forEach(doc => {
        allRecordsBody.appendChild(createRecordRow(doc));
    });

    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
}

function createRecordRow(data) {
    const row = document.createElement('tr');
    const date = data.timestamp ? new Date(data.timestamp).toLocaleString() : '--';
    const labelId = data.labelId || '--';
    const itemName = data.itemName || '--';
    const itemId = data.itemId || '--';
    const lotNo = data.lotNo || '--';
    const manufacturingLot = data.manufacturingLot || '--';
    let quantity = data.quantity || '--';
    if (quantity !== '--') {
        const qNum = Number(quantity);
        if (!Number.isNaN(qNum)) {
            quantity = formatNumber(qNum, 0);
        }
    }
    const responsible = data.responsibleUser || '--';
    const weight = typeof data.measuredWeight === 'number'
        ? `${formatNumber(data.measuredWeight, 2)} ${data.unit || 'g'}`
        : '--';

    row.innerHTML = `
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${date}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${labelId}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${itemName}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${itemId}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${lotNo}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${manufacturingLot}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${quantity}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${responsible}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm font-semibold text-blue-700">${weight}</td>
    `;
    return row;
}

// --- Start Application ---
document.addEventListener('DOMContentLoaded', () => {
    if (!ensureLoggedIn()) return;
    logoutBtn?.addEventListener('click', handleLogout);
    loadRecords();
    connectPreferredScale({ auto: true });
});

function exportAllRecordsAsCsv() {
    if (!allDocs || allDocs.length === 0) {
        showStatusMessage('No records to export.', true);
        return;
    }

    const headers = [
        'Date',
        'Label ID',
        'Item Name',
        'Item ID',
        'Lot No',
        'Manufacturing Lot',
        'Quantity',
        'Responsible',
        'Weight',
        'Unit'
    ];

    const rows = allDocs.map(record => {
        const date = record.timestamp ? new Date(record.timestamp).toISOString() : '';
        const weight = typeof record.measuredWeight === 'number' ? formatNumber(record.measuredWeight, 2) : '';
        return [
            date,
            record.labelId || '',
            record.itemName || '',
            record.itemId || '',
            record.lotNo || '',
            record.manufacturingLot || '',
            record.quantity || '',
            record.responsibleUser || '',
            weight,
            record.unit || ''
        ];
    });

    const csvContent = [headers, ...rows]
        .map(row => row.map(value => escapeCsv(value)).join(','))
        .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `weight-records-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showStatusMessage('CSV exported successfully.', false);
}

function escapeCsv(value) {
    const stringValue = String(value ?? '');
    if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}
