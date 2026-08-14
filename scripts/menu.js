'use strict';

const { getCurrentUser, redirectToLogin, isAdmin } = window.WeightLoggerUtils;

function handleLogout() {
  localStorage.removeItem('current_user');
  redirectToLogin('menu.html');
}

const SST_FEATURE_ENABLED_KEY = 'feature_sst_enabled';

function getSstFeatureEnabled() {
  try {
    const raw = localStorage.getItem(SST_FEATURE_ENABLED_KEY);
    if (raw === null) return true;
    if (raw === '1') return true;
    if (raw === '0') return false;
    return raw === 'true';
  } catch {
    return true;
  }
}

function applySstVisibility() {
  const sstBtn = document.getElementById('sst-btn');
  if (!sstBtn) return;

  const enabled = getSstFeatureEnabled();
  if (enabled) {
    sstBtn.classList.remove('hidden');
    sstBtn.style.display = 'block';
  } else {
    sstBtn.classList.add('hidden');
    sstBtn.style.display = 'none';
  }
}

function parseJsonArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function getLatestTimestamp(records) {
  let latest = null;
  for (const r of records) {
    if (!r || !r.timestamp) continue;
    const t = new Date(r.timestamp).getTime();
    if (Number.isNaN(t)) continue;
    if (latest === null || t > latest) {
      latest = t;
    }
  }
  return latest;
}

function getLastPrintedStockTakeTimestamp() {
  try {
    const raw = localStorage.getItem('last_stock_take_print_ts');
    if (!raw) return null;
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

function buildLatestRecordMap(records) {
  const latestByLabel = new Map();
  if (!Array.isArray(records)) return latestByLabel;

  for (const record of records) {
    if (!record || !record.labelId) continue;
    const timestamp = record.timestamp ? new Date(record.timestamp).getTime() : 0;
    const existing = latestByLabel.get(record.labelId);
    const existingTimestamp = existing && existing.timestamp ? new Date(existing.timestamp).getTime() : -1;
    if (!existing || timestamp > existingTimestamp) {
      latestByLabel.set(record.labelId, record);
    }
  }

  return latestByLabel;
}

function isLabelInStock(inRec, outRec) {
  const inTime = inRec && inRec.timestamp ? new Date(inRec.timestamp).getTime() : 0;
  const outTime = outRec && outRec.timestamp ? new Date(outRec.timestamp).getTime() : -1;
  return !outRec || Number.isNaN(outTime) || outTime <= inTime;
}

function computeInStockLabelCount(ins, outs) {
  if (!Array.isArray(ins) && !Array.isArray(outs)) return 0;

  const latestInByLabel = buildLatestRecordMap(ins);
  const latestOutByLabel = buildLatestRecordMap(outs);

  let count = 0;
  latestInByLabel.forEach((inRec, labelId) => {
    if (isLabelInStock(inRec, latestOutByLabel.get(labelId))) {
      count += 1;
    }
  });

  return count;
}

function populateDashboard() {
  const totalInEl = document.getElementById('dash-total-in');
  const totalOutEl = document.getElementById('dash-total-out');
  const inStockEl = document.getElementById('dash-in-stock-labels');
  const lastStockTakeEl = document.getElementById('dash-last-stocktake');

  if (!totalInEl || !totalOutEl || !inStockEl || !lastStockTakeEl) return;

  const ins = parseJsonArray('weight_records');
  const outs = parseJsonArray('stock_out_records');
  const stockTakeHistory = parseJsonArray('stock_take_history');

  totalInEl.textContent = String(ins.length);
  totalOutEl.textContent = String(outs.length);

  const inStockCount = computeInStockLabelCount(ins, outs);
  inStockEl.textContent = String(inStockCount);

  const latestPrintedTs = getLastPrintedStockTakeTimestamp();
  const latestHistoryTs = getLatestTimestamp(stockTakeHistory);
  const latestTs = latestPrintedTs || latestHistoryTs;
  if (!latestTs) {
    lastStockTakeEl.textContent = 'No stock-take yet';
  } else {
    lastStockTakeEl.textContent = new Date(latestTs).toLocaleString();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();
  if (!user || !(user.name || user.username)) {
    redirectToLogin('menu.html');
    return;
  }

  const versionEl = document.getElementById('app-version');
  if (versionEl && self.APP_VERSION) {
    versionEl.textContent = self.APP_VERSION;
  }

  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    handleLogout();
  });

  const adminBtn = document.getElementById('admin-btn');
  if (adminBtn) {
    if (isAdmin(user)) {
      adminBtn.classList.remove('hidden');
      adminBtn.style.display = 'block';
    } else {
      adminBtn.classList.add('hidden');
      adminBtn.style.display = 'none';
    }
  }

  applySstVisibility();

  populateDashboard();
});
