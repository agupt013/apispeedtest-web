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
  selectedMetric: 'all',
  historyChart: null,
  metricCharts: {} // Holds charts for all metrics view
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
  const singleChartView = document.getElementById('single-chart-view');
  const allMetricsView = document.getElementById('all-metrics-view');
  
  console.log(`[app] Toggling view mode to: ${APP_STATE.viewMode}, metric: ${APP_STATE.selectedMetric}`);
  
  if (APP_STATE.viewMode === 'table') {
    // Show table view
    tableView.style.display = 'block';
    historyView.style.display = 'none';
    historyControls.style.display = 'none';
    filters.style.display = 'flex';
    
    // Destroy charts if they exist to prevent memory leaks
    destroyAllCharts();
  } else {
    // Show history view
    tableView.style.display = 'none';
    historyView.style.display = 'block';
    historyControls.style.display = 'flex';
    filters.style.display = 'none';
    
    // Update the metric selector to match the current state
    const metricSelector = document.getElementById('metric-selector');
    if (metricSelector && metricSelector.value !== APP_STATE.selectedMetric) {
      metricSelector.value = APP_STATE.selectedMetric;
    }
    
    // Check if we should show single chart or all metrics
    if (APP_STATE.selectedMetric === 'all') {
      console.log('[app] Showing all metrics view');
      singleChartView.style.display = 'none';
      allMetricsView.style.display = 'block';
      
      // Render all metric charts
      renderAllMetricCharts();
    } else {
      console.log('[app] Showing single chart view');
      singleChartView.style.display = 'block';
      allMetricsView.style.display = 'none';
      
      // Make sure the chart container is empty and has a fresh canvas
      singleChartView.innerHTML = '<canvas id="history-chart"></canvas>';
      
      // Small delay to ensure DOM is updated before rendering chart
      setTimeout(() => {
        renderHistoryChart();
      }, 50);
    }
  }
}

function destroyAllCharts() {
  // Destroy main chart if it exists
  if (APP_STATE.historyChart) {
    APP_STATE.historyChart.destroy();
    APP_STATE.historyChart = null;
  }
  
  // Destroy all metric charts if they exist
  if (APP_STATE.metricCharts) {
    Object.values(APP_STATE.metricCharts).forEach(chart => {
      if (chart) chart.destroy();
    });
    APP_STATE.metricCharts = {};
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
  
  console.log(`[app] Filtering history data from ${cutoff.toISOString()} to ${now.toISOString()}`);
  
  let filteredData = APP_STATE.history.filter(entry => {
    try {
      const entryDate = new Date(entry.timestamp);
      return entryDate >= cutoff;
    } catch (err) {
      console.error('[app] Error parsing entry timestamp:', err, entry);
      return false;
    }
  });
  
  console.log(`[app] Found ${filteredData.length} entries within time frame`);
  
  if (APP_STATE.selectedModel !== 'all') {
    filteredData = filteredData.filter(entry => entry.key === APP_STATE.selectedModel);
    console.log(`[app] Filtered to ${filteredData.length} entries for model ${APP_STATE.selectedModel}`);
  }
  
  // Sort data by timestamp to ensure proper ordering
  filteredData.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB;
  });
  
  // Log some sample timestamps to help with debugging
  if (filteredData.length > 0) {
    console.log('[app] Sample timestamps:');
    for (let i = 0; i < Math.min(5, filteredData.length); i++) {
      const entry = filteredData[i];
      console.log(`  ${entry.key}: ${entry.timestamp} -> ${new Date(entry.timestamp).toLocaleString()}`);
    }
  }
  
  return filteredData;
}

// Custom plugin to add IDs to legend items
const LegendItemIDPlugin = {
  id: 'legendItemID',
  afterRender: (chart) => {
    // Add IDs to legend items after chart is rendered
    const legendItems = chart.legend.legendItems;
    const legendContainer = chart.canvas.parentNode.querySelector('.chartjs-legend-list-wrapper');
    
    if (legendContainer) {
      const listItems = legendContainer.querySelectorAll('li');
      listItems.forEach((item, index) => {
        if (index < legendItems.length) {
          item.id = `chart-legend-item-${index}`;
        }
      });
    }
  }
};

// Function to render all metric charts
function renderAllMetricCharts() {
  // List of all metrics to render
  const metrics = [
    'nonstreaming_avg_s',
    'streaming_ttfb_avg_s',
    'streaming_total_avg_s',
    'nonstream_tokens_per_second',
    'stream_tokens_per_second'
  ];
  
  // Initialize metricCharts object if not exists
  if (!APP_STATE.metricCharts) {
    APP_STATE.metricCharts = {};
  }
  
  // Render each metric chart
  metrics.forEach(metric => {
    renderMetricChart(metric);
  });
}

// Function to render a single metric chart
function renderMetricChart(metric) {
  const chartId = `chart-${metric}`;
  const chartElement = document.getElementById(chartId);
  
  if (!chartElement) {
    console.error(`[app] Chart element not found for metric: ${metric}`);
    return;
  }
  
  const ctx = chartElement.getContext('2d');
  if (!ctx) {
    console.error(`[app] Failed to get 2d context for chart: ${metric}`);
    return;
  }
  
  // Register custom plugin
  Chart.register(LegendItemIDPlugin);
  
  // Get filtered data
  const data = getHistoryData();
  
  // Group data by model
  const modelData = {};
  data.forEach(entry => {
    if (!modelData[entry.key]) {
      modelData[entry.key] = [];
    }
    
    try {
      // Format the date for display
      let timestamp = entry.timestamp;
      
      // Create date object for validation
      const dateObj = new Date(timestamp);
      
      // Validate date
      if (isNaN(dateObj.getTime())) {
        console.error(`[app] Invalid date from timestamp: ${entry.timestamp}`);
        return;
      }
      
      // Format date for display
      const formattedDate = dateObj.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      console.log(`[app] Creating metric point for ${entry.key}: timestamp=${entry.timestamp}, formatted=${formattedDate}`);
      
      modelData[entry.key].push({
        x: formattedDate, // Use formatted string instead of Date object
        y: entry[metric],
        _date: dateObj // Keep original date for sorting
      });
    } catch (err) {
      console.error(`[app] Error parsing date for ${entry.key}:`, err, entry.timestamp);
    }
  });
  
  // Sort data points by date for each model
  Object.keys(modelData).forEach(model => {
    modelData[model].sort((a, b) => a._date - b._date);
  });
  
  // Generate colors and point styles for each model
  const colors = {};
  const pointStyles = {};
  
  const providerBaseColors = {
    'openai': 120,  // Green
    'azure': 210,   // Blue
    'anthropic': 280, // Purple
    'gemini': 30,   // Orange
    'llama': 60,    // Yellow
    'default': 0    // Red
  };
  
  // Available point styles for models
  const availablePointStyles = [
    'circle', 'triangle', 'rect', 'star', 'cross', 'crossRot', 
    'rectRounded', 'rectRot', 'dash', 'line', 'diamond'
  ];
  
  // First, group models by provider
  const modelsByProvider = {};
  Object.keys(modelData).forEach(model => {
    const provider = data.find(entry => entry.key === model)?.provider || 'default';
    if (!modelsByProvider[provider]) {
      modelsByProvider[provider] = [];
    }
    modelsByProvider[provider].push(model);
  });
  
  // Then assign colors by provider and unique point styles for each model
  let styleIndex = 0;
  Object.entries(modelsByProvider).forEach(([provider, models]) => {
    const baseHue = providerBaseColors[provider] || providerBaseColors.default;
    
    models.forEach((model, idx) => {
      // Vary lightness within provider
      const lightness = 40 + (idx % 5) * 10;
      colors[model] = `hsl(${baseHue}, 70%, ${lightness}%)`;
      
      // Assign a unique point style to each model
      pointStyles[model] = availablePointStyles[styleIndex % availablePointStyles.length];
      styleIndex++;
    });
  });
  
  // Create datasets for Chart.js
  const datasets = Object.keys(modelData).map(model => ({
    label: model,
    data: modelData[model],
    borderColor: colors[model],
    backgroundColor: colors[model] + '33', // Add transparency
    tension: 0.2,
    pointStyle: pointStyles[model],
    pointRadius: 4,
    pointHoverRadius: 6,
    pointHoverBorderWidth: 2,
    pointHoverBackgroundColor: colors[model],
    pointHoverBorderColor: 'white'
  }));
  
  // If no data, show a message
  if (datasets.length === 0) {
    console.log(`[app] No data available for chart: ${metric}`);
    const noDataEl = document.createElement('div');
    noDataEl.className = 'no-data-message';
    noDataEl.textContent = 'No historical data available for the selected criteria.';
    
    const chartContainer = chartElement.parentNode;
    chartContainer.innerHTML = '';
    chartContainer.appendChild(noDataEl);
    return;
  }
  
  // Get metric label for chart title
  const metricLabels = {
    'nonstreaming_avg_s': 'Non-streaming Average (seconds)',
    'streaming_ttfb_avg_s': 'Time to First Byte (seconds)',
    'streaming_total_avg_s': 'Streaming Total (seconds)',
    'nonstream_tokens_per_second': 'Non-streaming Tokens per Second',
    'stream_tokens_per_second': 'Streaming Tokens per Second'
  };
  
  // Destroy previous chart if it exists
  if (APP_STATE.metricCharts[metric]) {
    APP_STATE.metricCharts[metric].destroy();
  }
  
  // Create new chart with simplified options for the grid view
  APP_STATE.metricCharts[metric] = new Chart(ctx, {
    type: 'line',
    data: {
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        title: {
          display: false // Title is already in the HTML
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0,0,0,0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          callbacks: {
            title: function(context) {
              try {
                if (context && context.length > 0 && context[0].parsed && context[0].parsed.x) {
                  const date = new Date(context[0].parsed.x);
                  return date.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                  });
                }
                return '';
              } catch (err) {
                console.error('Error in tooltip title callback:', err);
                return '';
              }
            },
            label: function(context) {
              try {
                const label = context.dataset.label || '';
                const value = context.parsed.y !== null ? context.parsed.y.toFixed(3) : 'N/A';
                const symbol = context.dataset.pointStyle || '●';
                
                // Highlight the current item
                if (context.tooltip && context.tooltip.dataPoints && 
                    context.tooltip.dataPoints.length > 0 && 
                    context.datasetIndex === context.tooltip.dataPoints[0].datasetIndex) {
                  return ' ' + symbol + ' ' + label + ': ' + value + ' ← CURRENT';
                }
                return ' ' + symbol + ' ' + label + ': ' + value;
              } catch (err) {
                console.error('Error in tooltip label callback:', err);
                const label = context.dataset ? (context.dataset.label || '') : '';
                const value = context.parsed && context.parsed.y !== null ? context.parsed.y.toFixed(3) : 'N/A';
                return `${label}: ${value}`;
              }
            }
          }
        },
        legend: {
          position: 'bottom',
          align: 'start',
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            padding: 10,
            usePointStyle: true,
            pointStyleWidth: 8,
            font: {
              size: 10
            }
          },
          maxHeight: 100
        }
      },
      scales: {
        x: {
          type: 'category',
          grid: {
            display: true,
            color: 'rgba(0,0,0,0.2)',
            lineWidth: 1
          },
          border: {
            display: true,
            width: 2,
            color: 'rgba(0,0,0,0.5)'
          },
          title: {
            display: true,
            text: 'Date & Time',
            color: '#333',
            font: {
              size: 12,
              weight: 'bold'
            }
          },
          ticks: {
            autoSkip: true,
            maxRotation: 90,
            minRotation: 45,
            display: true,
            color: '#000',
            padding: 8,
            font: {
              size: 10,
              weight: 'bold'
            }
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            font: {
              size: 10
            }
          }
        }
      },
      elements: {
        point: {
          radius: 3,
          hitRadius: 8,
          hoverRadius: 5
        },
        line: {
          borderWidth: 2
        }
      }
    }
  });
}

function renderHistoryChart() {
  const chartElement = document.getElementById('history-chart');
  if (!chartElement) {
    console.error('[app] Chart element not found');
    return;
  }
  
  const ctx = chartElement.getContext('2d');
  if (!ctx) {
    console.error('[app] Failed to get 2d context for chart');
    return;
  }
  
  // Register custom plugin
  Chart.register(LegendItemIDPlugin);
  
  // Get filtered data
  const data = getHistoryData();
  console.log('[app] History data for chart:', data);
  
  // Debug log the raw data to check timestamps
  if (data.length > 0) {
    console.log('[app] Sample data point timestamp:', data[0].timestamp);
    console.log('[app] Sample data parsed as date:', new Date(data[0].timestamp));
  }
  
  // Group data by model
  const modelData = {};
  data.forEach(entry => {
    if (!modelData[entry.key]) {
      modelData[entry.key] = [];
    }
    
    try {
      // Format the date for display
      let timestamp = entry.timestamp;
      
      // Create date object for validation
      const dateObj = new Date(timestamp);
      
      // Validate date
      if (isNaN(dateObj.getTime())) {
        console.error(`[app] Invalid date from timestamp: ${entry.timestamp}`);
        return;
      }
      
      // Format date for display
      const formattedDate = dateObj.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      console.log(`[app] Creating point for ${entry.key}: timestamp=${entry.timestamp}, formatted=${formattedDate}`);
      
      modelData[entry.key].push({
        x: formattedDate, // Use formatted string instead of Date object
        y: entry[APP_STATE.selectedMetric],
        _date: dateObj // Keep original date for sorting
      });
    } catch (err) {
      console.error(`[app] Error parsing date for ${entry.key}:`, err, entry.timestamp);
    }
  });
  
  console.log('[app] Grouped model data:', modelData);
  
  // Sort data points by date for each model
  Object.keys(modelData).forEach(model => {
    modelData[model].sort((a, b) => a._date - b._date);
  });
  
  // Generate colors and point styles for each model
  const colors = {};
  const pointStyles = {};
  
  const providerBaseColors = {
    'openai': 120,  // Green
    'azure': 210,   // Blue
    'anthropic': 280, // Purple
    'gemini': 30,   // Orange
    'llama': 60,    // Yellow
    'default': 0    // Red
  };
  
  // Available point styles for models
  const availablePointStyles = [
    'circle', 'triangle', 'rect', 'star', 'cross', 'crossRot', 
    'rectRounded', 'rectRot', 'dash', 'line', 'diamond'
  ];
  
  // First, group models by provider
  const modelsByProvider = {};
  Object.keys(modelData).forEach(model => {
    const provider = data.find(entry => entry.key === model)?.provider || 'default';
    if (!modelsByProvider[provider]) {
      modelsByProvider[provider] = [];
    }
    modelsByProvider[provider].push(model);
  });
  
  // Then assign colors by provider and unique point styles for each model
  let styleIndex = 0;
  Object.entries(modelsByProvider).forEach(([provider, models]) => {
    const baseHue = providerBaseColors[provider] || providerBaseColors.default;
    
    models.forEach((model, idx) => {
      // Vary lightness within provider
      const lightness = 40 + (idx % 5) * 10;
      colors[model] = `hsl(${baseHue}, 70%, ${lightness}%)`;
      
      // Assign a unique point style to each model
      pointStyles[model] = availablePointStyles[styleIndex % availablePointStyles.length];
      styleIndex++;
    });
  });
  
  // Create datasets for Chart.js
  const datasets = Object.keys(modelData).map(model => ({
    label: model,
    data: modelData[model],
    borderColor: colors[model],
    backgroundColor: colors[model] + '33', // Add transparency
    tension: 0.2,
    pointStyle: pointStyles[model],
    pointRadius: 5,
    pointHoverRadius: 8,
    pointHoverBorderWidth: 2,
    pointHoverBackgroundColor: colors[model],
    pointHoverBorderColor: 'white'
  }));
  
  // If no data, show a message
  if (datasets.length === 0) {
    console.log('[app] No data available for chart');
    const noDataEl = document.createElement('div');
    noDataEl.className = 'no-data-message';
    noDataEl.textContent = 'No historical data available for the selected criteria.';
    
    const chartContainer = document.querySelector('.chart-container');
    chartContainer.innerHTML = '';
    chartContainer.appendChild(noDataEl);
    return;
  }
  
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
      interaction: {
        mode: 'index',
        intersect: false,
      },
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
          intersect: false,
          backgroundColor: 'rgba(0,0,0,0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          callbacks: {
            // Highlight the corresponding legend item when hovering over a line
            label: function(context) {
              try {
                // Find the legend element for this dataset
                const legendId = `chart-legend-item-${context.datasetIndex}`;
                
                // Highlight all legend items first
                document.querySelectorAll('.chart-legend-highlight').forEach(el => {
                  el.classList.remove('chart-legend-highlight');
                });
                
                // Add highlight class to the current legend item
                setTimeout(() => {
                  const legendEl = document.getElementById(legendId);
                  if (legendEl) {
                    legendEl.classList.add('chart-legend-highlight');
                  }
                }, 0);
                
                // Return the enhanced tooltip text with symbol and formatted value
                const label = context.dataset.label || '';
                const value = context.parsed.y !== null ? context.parsed.y.toFixed(3) : 'N/A';
                const symbol = context.dataset.pointStyle || '●';
                
                // Highlight the current item
                if (context.tooltip && context.tooltip.dataPoints && 
                    context.tooltip.dataPoints.length > 0 && 
                    context.datasetIndex === context.tooltip.dataPoints[0].datasetIndex) {
                  return ' ' + symbol + ' ' + label + ': ' + value + ' ← CURRENT';
                }
                return ' ' + symbol + ' ' + label + ': ' + value;
              } catch (err) {
                console.error('Error in tooltip label callback:', err);
                const label = context.dataset ? (context.dataset.label || '') : '';
                const value = context.parsed && context.parsed.y !== null ? context.parsed.y.toFixed(3) : 'N/A';
                return `${label}: ${value}`;
              }
            },
            
            // Add a title to the tooltip showing the exact date and time
            title: function(context) {
              try {
                if (context && context.length > 0) {
                  // Use the formatted date string directly
                  return context[0].label || '';
                }
                return '';
              } catch (err) {
                console.error('Error in tooltip title callback:', err);
                return '';
              }
            }
          }
        },
        legend: {
          position: 'bottom',
          align: 'start',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            padding: 15,
            usePointStyle: true,
            pointStyleWidth: 10,
            font: {
              size: 11
            },
            // Add unique ID to each legend item for highlighting
            generateLabels: function(chart) {
              const datasets = chart.data.datasets;
              const legendItems = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              
              // Add ID to each legend item
              legendItems.forEach((item, index) => {
                item.datasetIndex = index;
                item.fillStyle = datasets[index].backgroundColor;
                item.strokeStyle = datasets[index].borderColor;
                item.pointStyle = datasets[index].pointStyle;
                item.text = datasets[index].label;
                item.lineWidth = 1;
                // Add unique ID for each legend item
                item.id = `chart-legend-item-${index}`;
              });
              
              return legendItems;
            }
          },
          title: {
            display: true,
            text: 'Click to toggle visibility',
            font: {
              size: 10,
              style: 'italic'
            }
          },
          maxHeight: 250,
          onClick: function(e, legendItem, legend) {
            // Toggle visibility when clicking on legend
            const index = legendItem.datasetIndex;
            const ci = legend.chart;
            const meta = ci.getDatasetMeta(index);
            
            // Toggle visibility
            meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
            
            // Update chart
            ci.update();
          }
        }
      },
      elements: {
        point: {
          hitRadius: 10,
          hoverRadius: 6
        }
      },
      scales: {
        x: {
          type: 'category',
          grid: {
            display: true,
            color: 'rgba(0,0,0,0.2)',
            lineWidth: 1
          },
          border: {
            display: true,
            width: 2,
            color: 'rgba(0,0,0,0.5)'
          },
          title: {
            display: true,
            text: 'Date & Time',
            color: '#333',
            font: {
              size: 14,
              weight: 'bold'
            }
          },
          ticks: {
            autoSkip: true,
            maxRotation: 90,
            minRotation: 45,
            display: true,
            color: '#000',
            padding: 8,
            font: {
              size: 11,
              weight: 'bold'
            }
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
    
    if (APP_STATE.selectedMetric === 'all') {
      // For all metrics view, re-render all charts
      destroyAllCharts();
      renderAllMetricCharts();
    } else {
      // For single chart view
      const chartContainer = document.getElementById('single-chart-view');
      if (chartContainer) {
        // Destroy existing chart if any
        if (APP_STATE.historyChart) {
          APP_STATE.historyChart.destroy();
          APP_STATE.historyChart = null;
        }
        
        // Create fresh canvas
        chartContainer.innerHTML = '<canvas id="history-chart"></canvas>';
        
        // Small delay to ensure DOM is updated
        setTimeout(() => {
          renderHistoryChart();
        }, 50);
      }
    }
  });
  
  timeFrameSelector.addEventListener('change', () => {
    APP_STATE.timeFrame = parseInt(timeFrameSelector.value, 10);
    
    if (APP_STATE.selectedMetric === 'all') {
      // For all metrics view, re-render all charts
      destroyAllCharts();
      renderAllMetricCharts();
    } else {
      // For single chart view
      renderHistoryChart();
    }
  });
  
  metricSelector.addEventListener('change', () => {
    APP_STATE.selectedMetric = metricSelector.value;
    
    // Toggle between single chart and all metrics views
    const singleChartView = document.getElementById('single-chart-view');
    const allMetricsView = document.getElementById('all-metrics-view');
    
    if (APP_STATE.selectedMetric === 'all') {
      // Switch to all metrics view
      singleChartView.style.display = 'none';
      allMetricsView.style.display = 'block';
      
      // Destroy single chart if it exists
      if (APP_STATE.historyChart) {
        APP_STATE.historyChart.destroy();
        APP_STATE.historyChart = null;
      }
      
      // Render all metric charts
      renderAllMetricCharts();
    } else {
      // Switch to single chart view
      singleChartView.style.display = 'block';
      allMetricsView.style.display = 'none';
      
      // Destroy all metric charts if they exist
      if (APP_STATE.metricCharts) {
        Object.values(APP_STATE.metricCharts).forEach(chart => {
          if (chart) chart.destroy();
        });
        APP_STATE.metricCharts = {};
      }
      
      // Create fresh canvas for single chart
      singleChartView.innerHTML = '<canvas id="history-chart"></canvas>';
      
      // Render the single chart
      setTimeout(() => {
        renderHistoryChart();
      }, 50);
    }
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
  // Initialize metricCharts object
  APP_STATE.metricCharts = {};
  
  // Initialize view settings
  APP_STATE.viewMode = 'history'; // Start with history view to show charts
  APP_STATE.selectedMetric = 'all'; // Default to all metrics view
  APP_STATE.timeFrame = 30; // Set timeframe to 30 days by default
  
  // Update UI elements to match state
  document.getElementById('view-mode').value = 'history';
  document.getElementById('metric-selector').value = 'all';
  document.getElementById('time-frame').value = '30';
  
  // Toggle view to apply settings
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
      const visitedKey = 'apispeedtest-visited-session';
      let count = 0;
      
      // Check if we've already counted this visit in this session
      const hasVisited = sessionStorage.getItem(visitedKey) === 'true';
      
      try {
        count = Number(localStorage.getItem(storageKey) || '0');
        if (!Number.isFinite(count) || count < 0) count = 0;
        
        // Only increment if this is a new session
        if (!hasVisited) {
          count += 1;
          // Mark this session as visited
          sessionStorage.setItem(visitedKey, 'true');
          // Store the updated count
          localStorage.setItem(storageKey, String(count));
          console.log('[app] Visitor count incremented to:', count);
        } else {
          console.log('[app] Visitor already counted in this session:', count);
        }
      } catch (err) {
        console.error('[app] Error handling visitor count:', err);
      }
      
      // Update the UI
      if (counterEl) counterEl.textContent = String(count);
    }
  } catch (err) {
    console.error('[app] error:', err);
    document.getElementById('updated-time').textContent = 'Error loading data';
    showNotice('Failed to load benchmark data. Please try again later.', 'error');
  }
}

// Add error logging
window.addEventListener('error', function(event) {
  console.error('Global error caught:', event.error);
});

// Debug function to check Chart.js adapter
function debugChartAdapter() {
  console.log('Chart version:', Chart.version);
  console.log('Chart.js adapters available:', !!Chart.adapters);
  
  // Check if Luxon is available
  if (typeof luxon !== 'undefined') {
    console.log('Luxon loaded:', true);
    console.log('Luxon version:', luxon.VERSION || 'unknown');
  } else {
    console.error('Luxon not loaded!');
  }
  
  // Check if the time scale is registered
  console.log('Time scale registered:', !!Chart.defaults.scales.time);
  
  // Check date parsing
  const testDate = new Date('2025-09-07T12:00:00Z');
  console.log('Test date parsing:', testDate, 'isValid:', !isNaN(testDate.getTime()));
}

// Initialize links as soon as DOM is ready, independent of data fetch
window.addEventListener('DOMContentLoaded', () => {
  try {
    // Debug Chart.js adapter
    debugChartAdapter();
    
    // Ensure Chart.js adapter is registered
    if (!Chart.defaults.scales.time) {
      console.error('[app] Chart.js time scale not registered! Attempting to register...');
      
      // Try to register the adapter manually if needed
      if (typeof luxon !== 'undefined' && Chart.adapters) {
        console.log('[app] Manually registering time adapter...');
        
        // Register adapter if needed
        if (typeof window._chartjs_adapter_luxon !== 'undefined') {
          window._chartjs_adapter_luxon.register();
          console.log('[app] Adapter registered manually.');
        }
      }
    }
    
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
    
    // Note: Visitor counter is now handled only in the init() function
    // to prevent double-counting
  } catch (err) {
    console.error('[app] Error in DOMContentLoaded:', err);
  }

  init();
});
