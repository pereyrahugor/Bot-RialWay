/* global loadViewScript */
window.dashboardView = {
    title: 'Dashboard - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <main class="crm-main-container relative" style="z-index:10;">

            <div class="flex items-center justify-between mb-2 animate-reveal-up">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style="background:rgba(0,153,255,0.15); border:1px solid rgba(0,153,255,0.2);">
                        <i class="fas fa-chart-simple text-accent-bright"></i>
                    </div>
                    <div>
                        <h1 class="text-2xl font-heading font-bold text-gradient-accent leading-tight">Dashboard de Performance</h1>
                        <p class="text-xs text-secondary-content">${window.BOT_NAME || ''}</p>
                    </div>
                </div>
                <div id="last-update" class="text-xs text-muted-content font-body hidden sm:block"></div>
            </div>
            <p class="text-sm text-secondary-content mb-8 animate-fade-in">
                Analisis detallado de metricas y efectividad del bot
            </p>

            <div class="kpi-container animate-reveal-up">
                <div class="kpi-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Porcentaje de conversaciones totales que han sido marcadas como "Lead" en el CRM.</span>
                    </i>
                    <div class="kpi-icon"><i class="fas fa-percentage"></i></div>
                    <div class="kpi-label">Conversion Leads</div>
                    <div class="kpi-value" id="kpi-conversion">--%</div>
                </div>
                <div class="kpi-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Cantidad total de mensajes procesados en las ultimas 24 horas.</span>
                    </i>
                    <div class="kpi-icon"><i class="fas fa-paper-plane"></i></div>
                    <div class="kpi-label">Msjs (24h)</div>
                    <div class="kpi-value" id="kpi-msgs">--</div>
                </div>
                <div class="kpi-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Relacion de mensajes enviados por el Bot frente a la participacion humana total.</span>
                    </i>
                    <div class="kpi-icon"><i class="fas fa-robot"></i></div>
                    <div class="kpi-label">Proactividad Bot</div>
                    <div class="kpi-value" id="kpi-bot">--%</div>
                </div>
                <div class="kpi-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Tiempo promedio que tarda el sistema en responder a un mensaje del usuario.</span>
                    </i>
                    <div class="kpi-icon"><i class="fas fa-bolt"></i></div>
                    <div class="kpi-label">T. Respuesta</div>
                    <div class="kpi-value" id="kpi-resp">--m</div>
                </div>
            </div>

            <div class="charts-grid">
                <div class="chart-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Distribucion actual de tickets abiertos segun su etapa en el funnel de ventas.</span>
                    </i>
                    <div class="chart-header"><i class="fas fa-filter"></i><h3>Estado del Funnel (Tickets)</h3></div>
                    <div class="chart-canvas-wrapper"><canvas id="chart-funnel"></canvas></div>
                </div>
                <div class="chart-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Tematicas mas consultadas detectadas por la IA en las interacciones.</span>
                    </i>
                    <div class="chart-header"><i class="fas fa-shapes"></i><h3>Categorizacion de Consultas</h3></div>
                    <div class="chart-canvas-wrapper"><canvas id="chart-categories"></canvas></div>
                </div>
                <div class="chart-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Volumen de acciones realizadas por cada operador humano en los ultimos 7 dias.</span>
                    </i>
                    <div class="chart-header"><i class="fas fa-user-edit"></i><h3>Acciones por Operador (7d)</h3></div>
                    <div class="chart-canvas-wrapper"><canvas id="chart-productivity"></canvas></div>
                </div>
                <div class="chart-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Atribucion de origen de los leads autodetectados por el sistema.</span>
                    </i>
                    <div class="chart-header"><i class="fas fa-share-nodes"></i><h3>Origen de Contactos</h3></div>
                    <div class="chart-canvas-wrapper"><canvas id="chart-sources"></canvas></div>
                </div>
                <div class="chart-card">
                    <i class="fas fa-info-circle info-badge tooltip">
                        <span class="tooltiptext">Inversion mensual en API de OpenAI. Incluye los ultimos 3 meses y el mes actual.</span>
                    </i>
                    <div class="chart-header"><i class="fas fa-brain"></i><h3>Inversion OpenAI (USD)</h3></div>
                    <div class="chart-canvas-wrapper"><canvas id="chart-openai"></canvas></div>
                </div>
            </div>
        </main>`;
    },

    async init() {
        // Cargar Chart.js si no esta disponible
        if (typeof Chart === 'undefined') {
            await loadViewScript('https://cdn.jsdelivr.net/npm/chart.js');
        }
        // Cargar logica del dashboard
        await loadViewScript('/js/dashboard.js');
        if (typeof window.initDashboardView === 'function') window.initDashboardView();
    },

    destroy() {
        if (typeof window.destroyDashboardView === 'function') window.destroyDashboardView();
    }
};
