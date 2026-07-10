/* global loadViewScript */
window.dashboardView = {
    title: 'Dashboard - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10;padding:0;">

            <!-- Header -->
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-chart-simple kanban-header-icon"></i> Dashboard de Performance</h1>
                    <p>Analisis detallado de metricas y efectividad del bot</p>
                </div>
                <div id="last-update" class="text-xs text-muted-content font-body"></div>
            </div>

            <div class="dashboard-page">

                <!-- KPI Cards -->
                <div class="dashboard-kpi-grid animate-reveal-up">
                    <div class="kpi-card">
                        <div class="kpi-header">
                            <div class="kpi-icon-wrap"><i class="fas fa-percentage"></i></div>
                            <i class="fas fa-info-circle kpi-info tooltip">
                                <span class="tooltiptext">Porcentaje de conversaciones totales que han sido marcadas como Lead en el CRM.</span>
                            </i>
                        </div>
                        <div class="kpi-label">Conversion Leads</div>
                        <div class="kpi-value" id="kpi-conversion">--%</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-header">
                            <div class="kpi-icon-wrap"><i class="fas fa-paper-plane"></i></div>
                            <i class="fas fa-info-circle kpi-info tooltip">
                                <span class="tooltiptext">Cantidad total de mensajes procesados en las ultimas 24 horas.</span>
                            </i>
                        </div>
                        <div class="kpi-label">Mensajes (24h)</div>
                        <div class="kpi-value" id="kpi-msgs">--</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-header">
                            <div class="kpi-icon-wrap"><i class="fas fa-robot"></i></div>
                            <i class="fas fa-info-circle kpi-info tooltip">
                                <span class="tooltiptext">Relacion de mensajes enviados por el Bot frente a la participacion humana total.</span>
                            </i>
                        </div>
                        <div class="kpi-label">Proactividad Bot</div>
                        <div class="kpi-value" id="kpi-bot">--%</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-header">
                            <div class="kpi-icon-wrap"><i class="fas fa-bolt"></i></div>
                            <i class="fas fa-info-circle kpi-info tooltip">
                                <span class="tooltiptext">Tiempo promedio que tarda el sistema en responder a un mensaje del usuario.</span>
                            </i>
                        </div>
                        <div class="kpi-label">T. Respuesta</div>
                        <div class="kpi-value" id="kpi-resp">--m</div>
                    </div>
                </div>

                <!-- Charts main area -->
                <div class="dashboard-main animate-reveal-up">

                    <!-- Left: 2x2 chart grid -->
                    <div class="dashboard-charts-left">
                        <div class="chart-card">
                            <div class="chart-header">
                                <i class="fas fa-filter"></i>
                                <h3>Estado del Funnel</h3>
                                <i class="fas fa-info-circle kpi-info tooltip" style="margin-left:auto;">
                                    <span class="tooltiptext">Distribucion actual de tickets abiertos segun su etapa en el funnel de ventas.</span>
                                </i>
                            </div>
                            <div class="chart-canvas-wrapper"><canvas id="chart-funnel"></canvas></div>
                        </div>
                        <div class="chart-card">
                            <div class="chart-header">
                                <i class="fas fa-shapes"></i>
                                <h3>Categorizacion de Consultas</h3>
                                <i class="fas fa-info-circle kpi-info tooltip" style="margin-left:auto;">
                                    <span class="tooltiptext">Tematicas mas consultadas detectadas por la IA en las interacciones.</span>
                                </i>
                            </div>
                            <div class="chart-canvas-wrapper"><canvas id="chart-categories"></canvas></div>
                        </div>
                        <div class="chart-card">
                            <div class="chart-header">
                                <i class="fas fa-user-edit"></i>
                                <h3>Acciones por Operador (7d)</h3>
                                <i class="fas fa-info-circle kpi-info tooltip" style="margin-left:auto;">
                                    <span class="tooltiptext">Volumen de acciones realizadas por cada operador humano en los ultimos 7 dias.</span>
                                </i>
                            </div>
                            <div class="chart-canvas-wrapper"><canvas id="chart-productivity"></canvas></div>
                        </div>
                        <div class="chart-card">
                            <div class="chart-header">
                                <i class="fas fa-share-nodes"></i>
                                <h3>Origen de Contactos</h3>
                                <i class="fas fa-info-circle kpi-info tooltip" style="margin-left:auto;">
                                    <span class="tooltiptext">Atribucion de origen de los leads autodetectados por el sistema.</span>
                                </i>
                            </div>
                            <div class="chart-canvas-wrapper" style="height:320px;"><canvas id="chart-sources"></canvas></div>
                        </div>
                    </div>

                    <!-- Right: OpenAI chart -->
                    <div class="dashboard-charts-right">
                        <div class="chart-card">
                            <div class="chart-header">
                                <i class="fas fa-brain"></i>
                                <h3>Inversion OpenAI (USD)</h3>
                                <i class="fas fa-info-circle kpi-info tooltip" style="margin-left:auto;">
                                    <span class="tooltiptext">Inversion mensual en API de OpenAI. Incluye los ultimos 3 meses y el mes actual.</span>
                                </i>
                            </div>
                            <div class="chart-canvas-wrapper-lg"><canvas id="chart-openai"></canvas></div>
                        </div>
                    </div>
                </div>

            </div>
        </main>`;
    },

    async init() {
        if (typeof Chart === 'undefined') {
            await loadViewScript('https://cdn.jsdelivr.net/npm/chart.js');
        }
        await loadViewScript('/js/dashboard/dashboard.js');
        if (typeof window.initDashboardView === 'function') window.initDashboardView();
    },

    destroy() {
        if (typeof window.destroyDashboardView === 'function') window.destroyDashboardView();
    }
};
