let APP_STATE = {
  results: [],
  meta: null,
  sortKey: null,
  sortDir: 'asc', // 'asc' | 'desc'
  searchQuery: '',
  provider: ''
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

async function init() {
  try {
    const [results, meta] = await Promise.all([
      fetchJson('data/results.json'),
      fetchJson('data/meta.json')
    ]);

    APP_STATE.results = Array.isArray(results) ? results : [];
    APP_STATE.meta = meta || {};

    if (APP_STATE.meta && APP_STATE.meta.error_message) {
      showNotice(APP_STATE.meta.error_message, 'error');
    }

    console.log('[app] meta:', APP_STATE.meta);
    clearSortIndicators();
    renderTable(computeView());
    attachHeaderSortHandlers();
    attachFilterHandlers();
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
  } catch (err) {
    console.error('[app] error:', err);
    document.getElementById('updated-time').textContent = 'Error loading data';
    showNotice('Failed to load benchmark data. Please try again later.', 'error');
  }
}

window.addEventListener('DOMContentLoaded', init);
