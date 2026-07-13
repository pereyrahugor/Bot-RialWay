/* global Chart */
// dashboard.js - Logica del Dashboard de Performance

const _dashToken = localStorage.getItem('backoffice_token');
let _dashCharts = {};
let _dashInterval = null;

async function _loadDashboardData() {
    try {
        if (typeof window.Skeleton !== 'undefined') {
            const kpiIds = ['kpi-conversion', 'kpi-msgs', 'kpi-bot', 'kpi-resp'];
            kpiIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = `<div class="skeleton-title" style="width: 60%; height: 32px; margin: 0; border-radius: 6px;"></div>`;
            });
        }

        const url = _dashToken ? `/api/dashboard/stats?token=${_dashToken}` : `/api/dashboard/stats`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        _renderDashStats(data.stats);

        const aiUrl = _dashToken ? `/api/dashboard/openai-usage?token=${_dashToken}` : `/api/dashboard/openai-usage`;
        const aiRes = await fetch(aiUrl);
        const aiData = await aiRes.json();
        if (aiData.success) _createDashChart('chart-openai', 'bar', aiData.data, ['#10b981']);
    } catch (e) {
        console.error('Error cargando KPIs:', e);
    }
}

function _renderDashStats(stats) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpi-conversion', stats.conversionRate + '%');
    set('kpi-msgs', stats.msgCountLast24h);
    set('kpi-bot', stats.proactivity + '%');
    set('kpi-resp', stats.avgResponseTime + 'm');

    const lu = document.getElementById('last-update');
    if (lu) {
        lu.textContent = 'Actualizado: ' + new Date().toLocaleTimeString();
        lu.classList.remove('hidden');
    }

    _createDashChart('chart-funnel',      'doughnut',  stats.funnel,        ['#10b981','#f59e0b','#ef4444']);
    _createDashChart('chart-categories',  'bar',       stats.categories,    ['#0078D4']);
    _createDashChart('chart-productivity','pie',        stats.productivity);
    _createDashChart('chart-sources',     'polarArea',  stats.sources);
}

function _createDashChart(id, type, dataMap, colors = []) {
    if (_dashCharts[id]) { _dashCharts[id].destroy(); delete _dashCharts[id]; }
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataMap || {});
    const values = Object.values(dataMap || {});
    const bg = colors.length ? colors : ['#0078D4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    _dashCharts[id] = new Chart(ctx, {
        type,
        data: { labels, datasets: [{ data: values, backgroundColor: bg, borderWidth: 0, hoverOffset: 12 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor, usePointStyle: true, font: { family: 'Poppins', size: 11 } } }
            },
            scales: type === 'bar' ? {
                y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
                x: { ticks: { color: textColor }, grid: { display: false } }
            } : type === 'polarArea' ? {
                r: {
                    ticks: {
                        backdropColor: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.8)',
                        color: textColor,
                        font: { size: 10 }
                    },
                    grid: { color: gridColor }
                }
            } : {}
        }
    });
}

function _onDashThemeChange() {
    Object.keys(_dashCharts).forEach(k => { if (_dashCharts[k]) _dashCharts[k].destroy(); delete _dashCharts[k]; });
    _loadDashboardData();
}

window.initDashboardView = function() {
    if (_dashInterval) { clearInterval(_dashInterval); _dashInterval = null; }
    Object.keys(_dashCharts).forEach(k => { if (_dashCharts[k]) _dashCharts[k].destroy(); });
    _dashCharts = {};
    window.removeEventListener('themeChanged', _onDashThemeChange);
    window.addEventListener('themeChanged', _onDashThemeChange);
    _loadDashboardData();
    _dashInterval = setInterval(_loadDashboardData, 60000);
};

window.destroyDashboardView = function() {
    if (_dashInterval) { clearInterval(_dashInterval); _dashInterval = null; }
    window.removeEventListener('themeChanged', _onDashThemeChange);
};
