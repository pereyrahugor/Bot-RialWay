/* global loadViewScript, marked */
window.docsView = {
    title: 'Manual - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <main class="crm-main-container relative" style="z-index:10;">
            <div class="card animate-reveal-up">
                <div class="flex items-center justify-between mb-6">
                    <div>
                        <h1 class="text-2xl font-heading font-bold text-gradient-accent">Centro de Ayuda</h1>
                        <p class="text-xs text-secondary-content mt-1">Guia operacional de ${window.BOT_NAME || 'Backoffice'}</p>
                    </div>
                    <button class="btn-primary" onclick="window.print()">
                        <i class="fas fa-file-pdf icon-mr"></i> Guardar PDF
                    </button>
                </div>

                <div class="flex gap-2 mb-6 no-print">
                    <button class="tab-btn active" id="btn-user-docs" onclick="switchDoc('user')">
                        <i class="fas fa-user-tie icon-mr"></i> Instrucciones de Uso
                    </button>
                    <button class="tab-btn" id="btn-api-docs" onclick="switchDoc('api')">
                        <i class="fas fa-code icon-mr"></i> Instrucciones Tecnicas API
                    </button>
                </div>

                <div id="content" class="prose max-w-none text-primary-content"
                    style="line-height:1.7;">
                    <div class="flex items-center justify-center py-10 opacity-50">
                        <i class="fas fa-circle-notch fa-spin text-2xl text-accent-bright mr-3"></i>
                        Cargando manual...
                    </div>
                </div>
            </div>
        </main>`;
    },

    async init() {
        // Cargar Marked.js si no esta disponible
        if (typeof marked === 'undefined') {
            await loadViewScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
        }
        await loadViewScript('/js/docs.js');
        if (typeof window.initDocsView === 'function') window.initDocsView();
    },

    destroy() {}
};
