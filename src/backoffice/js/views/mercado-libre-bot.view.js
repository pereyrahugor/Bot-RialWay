window.mercadoLibreBotView = (() => {
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-robot kanban-header-icon" style="color:#FFE600;"></i> Mercado Libre Bot</h1>
                    <p>Integracion con Mercado Libre y Mercado Pago</p>
                </div>
            </div>
            <div class="meta-view-body">
                <div class="meta-onboarding-wrap glass-card animate-fade" style="max-width: 550px;">
                    <div style="color:#FFE600; font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%;">
                        <i class="fas fa-robot"></i>
                    </div>
                    <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                        <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Mercado Libre Bot</h2>
                        <div style="height:3px; width:50px; background:#FFE600; border-radius:10px; margin:0 auto 12px;"></div>
                        <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.5; margin:0;">
                            Vincula tu cuenta e Integra al CRM las consultas de tus publicaciones y respondelas desde un solo canal, si tiene un bot en tu CRM podras automatizar las respuestas a estas en base a la info de tu negocio y tus productos.
                        </p>
                    </div>
                    <div style="background:var(--bg-header); padding:1rem 1.25rem; border-radius:16px; border:1px solid var(--border); width:100%; text-align:center;">
                        <span style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#FFE600;">Proximamente</span>
                    </div>
                </div>
            </div>
        </main>`;
    }

    return {
        title: 'Mercado Libre Bot - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
    };
})();
