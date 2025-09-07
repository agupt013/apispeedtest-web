let APP_STATE = {
  results: [],
  meta: null,
  history: [],
  sortKey: null,
  sortDir: 'asc', // 'asc' | 'desc'
  searchQuery: '',
  provider: '',
  viewMode: 'table', // 'table' | 'history'
  selectedModel: 'all',
  timeFrame: 30, // days
  selectedMetric: 'nonstreaming_avg_s',
  historyChart: null
};

function showNotice(msg, kind) {
  const el = document.getElementById('notice');
  el.textContent = msg;
  el.classList.remove('error', 'info');
  if (kind) el.classList.add(kind);
  el.hidden = false;
}

function hideNotice() {
  const el = document.getElementById('notice');
  el.hidden = true;
  el.textContent = '';
  el.classList.remove('error', 'info');
}

async function fetchJson(url) {
  console.log(`[app] fetching ${url} ...`);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  console.log(`[app] fetched ${url}`);
  return await res.json();
}

function formatNumber(n) {
  if (n === null || n === undefined) return '-';
  const p = window.APISPEEDTEST_CONFIG.NUMBER_PRECISION || 3;
  return Number(n).toFixed(p);
}

function formatTime(isoUtc) {
  if (!isoUtc) return 'N/A';
  const cfg = window.APISPEEDTEST_CONFIG;
  const dt = new Date(isoUtc);
  if (cfg.TIME_DISPLAY_MODE === 'relative') {
    const diffMs = Date.now() - dt.getTime();
    const sec = Math.max(1, Math.floor(diffMs / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  } else {
    const tz = cfg.DISPLAY_TIMEZONE;
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    if (tz === 'UTC') opts.timeZone = 'UTC';
    return new Intl.DateTimeFormat(undefined, opts).format(dt);
  }
}

function compareValues(a, b, isNumeric) {
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (isNumeric) {
    const na = Number(a);
    const nb = Number(b);
    if (isNaN(na) && isNaN(nb)) return 0;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  }
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

const NUMERIC_KEYS = new Set([
  'nonstreaming_avg_s',
  'nonstream_tokens_per_second',
  'streaming_ttfb_avg_s',
  'streaming_total_avg_s',
  'stream_tokens_per_second'
]);

function sortList(list) {
  if (!APP_STATE.sortKey) return list.slice();
  const key = APP_STATE.sortKey;
  const dir = APP_STATE.sortDir === 'desc' ? -1 : 1;
  const isNumeric = NUMERIC_KEYS.has(key);
  return list.slice().sort((r1, r2) => dir * compareValues(r1[key], r2[key], isNumeric));
}

function filterList(list) {
  const q = (APP_STATE.searchQuery || '').trim().toLowerCase();
  const prov = (APP_STATE.provider || '').trim().toLowerCase();
  return list.filter(r => {
    if (prov && String(r.provider).toLowerCase() !== prov) return false;
    if (!q) return true;
    const hay = `${r.key} ${r.model}`.toLowerCase();
    return hay.includes(q);
  });
}

function computeView() {
  const filtered = filterList(APP_STATE.results);
  const sorted = sortList(filtered);
  console.log(`[app] filtered ${filtered.length}/${APP_STATE.results.length} then sorted by ${APP_STATE.sortKey || 'none'} (${APP_STATE.sortDir})`);
  if (sorted.length === 0) {
    const msg = (APP_STATE.results.length === 0)
      ? 'No benchmark results available. Check API keys or view later.'
      : 'No rows match current filters.';
    showNotice(msg, APP_STATE.results.length === 0 ? 'error' : 'info');
  } else {
    hideNotice();
  }
  return sorted;
}

function clearSortIndicators() {
  document.querySelectorAll('#results-table thead th').forEach(th => {
    th.classList.remove('sort-asc');
    th.classList.remove('sort-desc');
  });
}

function setSortIndicator() {
  if (!APP_STATE.sortKey) return;
  const th = document.querySelector(`#results-table thead th[data-key="${APP_STATE.sortKey}"]`);
  if (!th) return;
  th.classList.add(APP_STATE.sortDir === 'desc' ? 'sort-desc' : 'sort-asc');
}

function attachHeaderSortHandlers() {
  const headers = document.querySelectorAll('#results-table thead th[data-key]');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-key');
      if (APP_STATE.sortKey === key) {
        APP_STATE.sortDir = APP_STATE.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        APP_STATE.sortKey = key;
        APP_STATE.sortDir = 'asc';
      }
      clearSortIndicators();
      setSortIndicator();
      renderTable(computeView());
      console.log(`[app] sorted by ${APP_STATE.sortKey} (${APP_STATE.sortDir})`);
    });
  });
}

function attachFilterHandlers() {
  const search = document.getElementById('search');
  const provider = document.getElementById('provider-filter');
  const clearBtn = document.getElementById('clear-filters');

  search.addEventListener('input', () => {
    APP_STATE.searchQuery = search.value;
    renderTable(computeView());
  });
  provider.addEventListener('change', () => {
    APP_STATE.provider = provider.value;
    renderTable(computeView());
  });
  clearBtn.addEventListener('click', () => {
    APP_STATE.searchQuery = '';
    APP_STATE.provider = '';
    search.value = '';
    provider.value = '';
    renderTable(computeView());
  });
}

function renderTable(results) {
  console.log(`[app] rendering ${results.length} rows`);
  const tbody = document.querySelector('#results-table tbody');
  tbody.innerHTML = '';
  for (const r of results) {
    const updated = r.updated_at ? ` <span class="updated">(${formatTime(r.updated_at)})</span>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.key}${updated}</td>
      <td>${r.provider}</td>
      <td>${r.model}</td>
      <td class="num">${formatNumber(r.nonstreaming_avg_s)}</td>
      <td class="num">${formatNumber(r.nonstream_tokens_per_second)}</td>
      <td class="num">${formatNumber(r.streaming_ttfb_avg_s)}</td>
      <td class="num">${formatNumber(r.streaming_total_avg_s)}</td>
      <td class="num">${formatNumber(r.stream_tokens_per_second)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function toggleView() {
  const tableView = document.getElementById('table-view');
  const historyView = document.getElementById('history-view');
  const historyControls = document.getElementById('history-controls');
  const filters = document.querySelector('.filters');
  
  if (APP_STATE.viewMode === 'table') {
    tableView.style.display = 'block';
    historyView.style.display = 'none';
    historyControls.style.display = 'none';
    filters.style.display = 'flex';
  } else {
    tableView.style.display = 'none';
    historyView.style.display = 'block';
    historyControls.style.display = 'flex';
    filters.style.display = 'none';
    renderHistoryChart();
  }
}

function populateModelSelector() {
  const selector = document.getElementById('model-selector');
  
  // Clear existing options except the first one
  while (selector.options.length > 1) {
    selector.remove(1);
  }
  
  // Add models from results
  const models = new Set();
  APP_STATE.results.forEach(result => {
    models.add(result.key);
  });
  
  // Sort models alphabetically
  const sortedModels = Array.from(models).sort();
  
  // Add options to selector
  sortedModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    selector.appendChild(option);
  });
}

function getHistoryData() {
  // Filter history data based on selected model and time frame
  const now = new Date();
  const cutoff = new Date(now.getTime() - (APP_STATE.timeFrame * 24 * 60 * 60 * 1000));
  
  let filteredData = APP_STATE.history.filter(entry => {
    const entryDate = new Date(entry.timestamp);
    return entryDate >= cutoff;
  });
  
  if (APP_STATE.selectedModel !== 'all') {
    filteredData = filteredData.filter(entry => entry.key === APP_STATE.selectedModel);
  }
  
  return filteredData;
}

function renderHistoryChart() {
  const ctx = document.getElementById('history-chart').getContext('2d');
  
  // Get filtered data
  const data = getHistoryData();
  
  // Group data by model
  const modelData = {};
  data.forEach(entry => {
    if (!modelData[entry.key]) {
      modelData[entry.key] = [];
    }
    modelData[entry.key].push({
      x: new Date(entry.timestamp),
      y: entry[APP_STATE.selectedMetric]
    });
  });
  
  // Sort data points by date for each model
  Object.keys(modelData).forEach(model => {
    modelData[model].sort((a, b) => a.x - b.x);
  });
  
  // Generate random colors for each model
  const colors = {};
  Object.keys(modelData).forEach((model, index) => {
    // Generate colors based on provider
    const provider = data.find(entry => entry.key === model)?.provider || '';
    
    // Assign color based on provider
    switch(provider) {
      case 'openai':
        colors[model] = `hsl(120, 70%, ${40 + (index % 5) * 10}%)`;
        break;
      case 'azure':
        colors[model] = `hsl(210, 70%, ${40 + (index % 5) * 10}%)`;
        break;
      case 'anthropic':
        colors[model] = `hsl(280, 70%, ${40 + (index % 5) * 10}%)`;
        break;
      case 'gemini':
        colors[model] = `hsl(30, 70%, ${40 + (index % 5) * 10}%)`;
        break;
      default:
        colors[model] = `hsl(${(index * 60) % 360}, 70%, 50%)`;
    }
  });
  
  // Create datasets for Chart.js
  const datasets = Object.keys(modelData).map(model => ({
    label: model,
    data: modelData[model],
    borderColor: colors[model],
    backgroundColor: colors[model] + '33', // Add transparency
    tension: 0.2,
    pointRadius: 3
  }));
  
  // Get metric label for chart title
  const metricLabels = {
    'nonstreaming_avg_s': 'Non-streaming Average (seconds)',
    'streaming_ttfb_avg_s': 'Time to First Byte (seconds)',
    'streaming_total_avg_s': 'Streaming Total (seconds)',
    'nonstream_tokens_per_second': 'Non-streaming Tokens per Second',
    'stream_tokens_per_second': 'Streaming Tokens per Second'
  };
  
  // Destroy previous chart if it exists
  if (APP_STATE.historyChart) {
    APP_STATE.historyChart.destroy();
  }
  
  // Create new chart
  APP_STATE.historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: metricLabels[APP_STATE.selectedMetric] || APP_STATE.selectedMetric,
          font: {
            size: 16
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false
        },
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'YYYY-MM-DD HH:mm',
            displayFormats: {
              hour: 'MM/DD HH:mm',
              day: 'MM/DD'
            }
          },
          title: {
            display: true,
            text: 'Date'
          }
        },
        y: {
          title: {
            display: true,
            text: metricLabels[APP_STATE.selectedMetric] || APP_STATE.selectedMetric
          },
          beginAtZero: true
        }
      }
    }
  });
}

function attachHistoryControlHandlers() {
  const viewModeSelector = document.getElementById('view-mode');
  const modelSelector = document.getElementById('model-selector');
  const timeFrameSelector = document.getElementById('time-frame');
  const metricSelector = document.getElementById('metric-selector');
  
  viewModeSelector.addEventListener('change', () => {
    APP_STATE.viewMode = viewModeSelector.value;
    toggleView();
  });
  
  modelSelector.addEventListener('change', () => {
    APP_STATE.selectedModel = modelSelector.value;
    renderHistoryChart();
  });
  
  timeFrameSelector.addEventListener('change', () => {
    APP_STATE.timeFrame = parseInt(timeFrameSelector.value, 10);
    renderHistoryChart();
  });
  
  metricSelector.addEventListener('change', () => {
    APP_STATE.selectedMetric = metricSelector.value;
    renderHistoryChart();
  });
}

async function init() {
  try {
    const [results, meta, history] = await Promise.all([
      fetchJson('data/results.json'),
      fetchJson('data/meta.json'),
      fetchJson('data/history.json').catch(() => []) // Fallback to empty array if history doesn't exist yet
    ]);

    APP_STATE.results = Array.isArray(results) ? results : [];
    APP_STATE.meta = meta || {};
    APP_STATE.history = Array.isArray(history) ? history : [];

    if (APP_STATE.meta && APP_STATE.meta.error_message) {
      showNotice(APP_STATE.meta.error_message, 'error');
    }

    console.log('[app] meta:', APP_STATE.meta);
    clearSortIndicators();
    renderTable(computeView());
    attachHeaderSortHandlers();
    attachFilterHandlers();
    populateModelSelector();
    attachHistoryControlHandlers();
    toggleView();
    
    if (APP_STATE.meta && APP_STATE.meta.generated_at) {
      document.getElementById('updated-time').textContent = formatTime(APP_STATE.meta.generated_at);
    } else {
      document.getElementById('updated-time').textContent = 'N/A';
    }

    const modeSel = document.getElementById('time-mode');
    const tzSel = document.getElementById('timezone');
    modeSel.value = window.APISPEEDTEST_CONFIG.TIME_DISPLAY_MODE;
    tzSel.value = window.APISPEEDTEST_CONFIG.DISPLAY_TIMEZONE;

    function refreshTimesOnly() {
      // Re-render to update relative/absolute times in the table and header
      renderTable(computeView());
      if (APP_STATE.meta && APP_STATE.meta.generated_at) {
        document.getElementById('updated-time').textContent = formatTime(APP_STATE.meta.generated_at);
      }
    }

    modeSel.addEventListener('change', () => {
      window.APISPEEDTEST_CONFIG.TIME_DISPLAY_MODE = modeSel.value;
      refreshTimesOnly();
      console.log(`[app] time display mode set to ${modeSel.value}`);
    });
    tzSel.addEventListener('change', () => {
      window.APISPEEDTEST_CONFIG.DISPLAY_TIMEZONE = tzSel.value;
      refreshTimesOnly();
      console.log(`[app] timezone set to ${tzSel.value}`);
    });

    // Homepage link init
    const homepageUrl = (window.APISPEEDTEST_CONFIG.HOMEPAGE_URL || '').trim();
    const homeLink = document.getElementById('homepage-link');
    if (homepageUrl) {
      homeLink.href = homepageUrl;
      // Use _blank for external sites by default; keep _self if same origin
      try {
        const homeUrlObj = new URL(homepageUrl, window.location.href);
        homeLink.target = (homeUrlObj.origin === window.location.origin) ? '_self' : '_blank';
      } catch {}
      homeLink.hidden = false;
    }

    // Visitor counter (localStorage-based, per browser) as a simple indicator
    if (window.APISPEEDTEST_CONFIG.ENABLE_VISITOR_COUNTER) {
      const counterEl = document.getElementById('visitor-count-value');
      const storageKey = 'apispeedtest-visit-count';
      let count = 0;
      try {
        count = Number(localStorage.getItem(storageKey) || '0');
        if (!Number.isFinite(count) || count < 0) count = 0;
      } catch {}
      count += 1;
      try { localStorage.setItem(storageKey, String(count)); } catch {}
      if (counterEl) counterEl.textContent = String(count);
    }
  } catch (err) {
    console.error('[app] error:', err);
    document.getElementById('updated-time').textContent = 'Error loading data';
    showNotice('Failed to load benchmark data. Please try again later.', 'error');
  }
}

// Initialize links/counter as soon as DOM is ready, independent of data fetch
window.addEventListener('DOMContentLoaded', () => {
  try {
    const homepageUrl = (window.APISPEEDTEST_CONFIG && window.APISPEEDTEST_CONFIG.HOMEPAGE_URL) ? String(window.APISPEEDTEST_CONFIG.HOMEPAGE_URL).trim() : '';
    const homeLink = document.getElementById('homepage-link');
    if (homeLink && homepageUrl) {
      homeLink.href = homepageUrl;
      try {
        const homeUrlObj = new URL(homepageUrl, window.location.href);
        homeLink.target = (homeUrlObj.origin === window.location.origin) ? '_self' : '_blank';
      } catch {}
      homeLink.hidden = false;
    }

    if (window.APISPEEDTEST_CONFIG && window.APISPEEDTEST_CONFIG.ENABLE_VISITOR_COUNTER) {
      const counterEl = document.getElementById('visitor-count-value');
      const storageKey = 'apispeedtest-visit-count';
      let count = 0;
      try {
        count = Number(localStorage.getItem(storageKey) || '0');
        if (!Number.isFinite(count) || count < 0) count = 0;
      } catch {}
      count += 1;
      try { localStorage.setItem(storageKey, String(count)); } catch {}
      if (counterEl) counterEl.textContent = String(count);
    }
  } catch {}

  init();
});
