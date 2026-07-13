window.Skeleton = {
    /**
     * Genera un bloque de tarjetas skeleton.
     * @param {number} count Cantidad de tarjetas
     * @returns {string} HTML de las tarjetas skeleton
     */
    cards: function(count = 1) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="glass-card p-3 mb-3 cursor-default" style="pointer-events: none;">
                    <div class="skeleton-title" style="width: 70%;"></div>
                    <div class="skeleton-text" style="width: 100%;"></div>
                    <div class="skeleton-text" style="width: 80%;"></div>
                    <div class="flex items-center gap-2 mt-4">
                        <div class="skeleton-avatar" style="width: 24px; height: 24px;"></div>
                        <div class="skeleton-text" style="width: 40%; margin: 0;"></div>
                    </div>
                </div>
            `;
        }
        return html;
    },

    /**
     * Genera un bloque de filas skeleton para listas o tablas.
     * @param {number} count Cantidad de filas
     * @returns {string} HTML de las filas skeleton
     */
    list: function(count = 1) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="flex items-center justify-between p-3 border-b border-white/5 dark:border-white/5">
                    <div class="flex-1 mr-4">
                        <div class="skeleton-title" style="width: 50%; height: 16px;"></div>
                        <div class="skeleton-text" style="width: 80%; height: 12px;"></div>
                    </div>
                    <div class="skeleton-avatar" style="width: 32px; height: 32px; border-radius: 8px;"></div>
                </div>
            `;
        }
        return html;
    },

    /**
     * Genera un skeleton para bloques de métricas (KPIs).
     * @returns {string} HTML del KPI skeleton
     */
    kpi: function() {
        return `
            <div class="kpi-card h-full" style="pointer-events: none;">
                <div class="kpi-header">
                    <div class="skeleton-text" style="width: 50px; height: 14px; margin: 0;"></div>
                </div>
                <div class="skeleton-title mt-2" style="width: 80px; height: 32px;"></div>
            </div>
        `;
    }
};
