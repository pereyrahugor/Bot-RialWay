/* global loadViewScript, marked */
window.docsView = {
    title: 'Manual - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <main class="crm-main-container docs-main relative" style="z-index:10; padding:0;">
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-book-open kanban-header-icon"></i> Centro de Ayuda</h1>
                    <p>Guia operacional de ${window.BOT_NAME || 'Backoffice'}</p>
                </div>
                <button class="btn no-print" onclick="window.print()">
                    <i class="fas fa-file-pdf"></i> Guardar PDF
                </button>
            </div>

            <nav class="docs-nav no-print" role="tablist">
                <button class="docs-nav-tab active" id="btn-user-docs" onclick="switchDoc('user')" role="tab">
                    <i class="fas fa-user-tie"></i><span>Instrucciones de Uso</span>
                </button>
                <button class="docs-nav-tab" id="btn-api-docs" onclick="switchDoc('api')" role="tab">
                    <i class="fas fa-code"></i><span>Instrucciones Tecnicas API</span>
                </button>
            </nav>

            <div class="docs-content-area">
                <div id="content" class="prose max-w-none text-primary-content animate-reveal-up"
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
        await loadViewScript('/js/docs/docs.js');
        if (typeof window.initDocsView === 'function') window.initDocsView();
    },

    destroy() {}
};
