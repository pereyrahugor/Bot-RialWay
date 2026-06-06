window.mercadoPagoView = (() => {
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-credit-card kanban-header-icon" style="color:#009ee3;"></i> Mercado Pago</h1>
                    <p>Integracion de pagos y cobros</p>
                </div>
            </div>
            <div class="meta-view-body">
                <div class="meta-onboarding-wrap glass-card animate-fade">
                    <div style="color:#009ee3; font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%;">
                        <i class="fas fa-credit-card"></i>
                    </div>
                    <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                        <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Mercado Pago</h2>
                        <div style="height:3px; width:50px; background:#009ee3; border-radius:10px; margin:0 auto 12px;"></div>
                        <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.5; margin:0;">
                            Proximamente podras gestionar cobros, pagos y notificaciones directamente desde el CRM.
                        </p>
                    </div>
                    <div style="background:var(--bg-header); padding:1rem 1.25rem; border-radius:16px; border:1px solid var(--border); width:100%; text-align:center;">
                        <span style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#009ee3;">Proximamente</span>
                    </div>
                </div>
            </div>
        </main>`;
    }

    return {
        title: 'Mercado Pago',
        getHTML,
        init: () => {},
        destroy: () => {}
    };
})();
