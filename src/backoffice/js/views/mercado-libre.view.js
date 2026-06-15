window.mercadoLibreView = (() => {
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            <style>
                .meli-accordion {
                    width: 100%;
                    margin-top: 1.5rem;
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                    text-align: left;
                }
                .meli-accordion-item {
                    background: var(--bg-header, rgba(255, 255, 255, 0.02));
                    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
                    border-radius: 12px;
                    overflow: hidden;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .meli-accordion-item.active {
                    border-color: #FFE600;
                    box-shadow: 0 4px 20px rgba(255, 230, 0, 0.08);
                    background: var(--bg-header, rgba(255, 255, 255, 0.04));
                }
                .meli-accordion-header {
                    padding: 1rem 1.25rem;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    cursor: pointer;
                    user-select: none;
                    transition: background-color 0.2s;
                }
                .meli-accordion-header:hover {
                    background: rgba(255, 230, 0, 0.05);
                }
                .meli-accordion-title {
                    font-size: 0.95rem;
                    font-weight: 600;
                    color: var(--text-main);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .meli-accordion-icon {
                    color: #FFE600;
                    font-size: 1.1rem;
                    width: 20px;
                    text-align: center;
                }
                .meli-accordion-chevron {
                    transition: transform 0.3s ease;
                    color: var(--text-muted);
                    font-size: 0.85rem;
                }
                .meli-accordion-item.active .meli-accordion-chevron {
                    transform: rotate(180deg);
                    color: #FFE600;
                }
                .meli-accordion-content {
                    max-height: 0;
                    overflow: hidden;
                    transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s ease;
                    padding: 0 1.25rem;
                    color: var(--text-muted);
                    font-size: 0.9rem;
                    line-height: 1.5;
                }
                .meli-accordion-item.active .meli-accordion-content {
                    max-height: 200px;
                    padding-bottom: 1.25rem;
                }
                .meli-detail-step {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    margin-top: 0.5rem;
                }
                .meli-step-number {
                    background: rgba(255, 230, 0, 0.15);
                    color: #FFE600;
                    font-weight: bold;
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.75rem;
                    flex-shrink: 0;
                    margin-top: 2px;
                }
            </style>
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-handshake kanban-header-icon" style="color:#FFE600;"></i> Mercado Libre</h1>
                    <p>Integracion con Mercado Libre y Mercado Pago</p>
                </div>
            </div>
            <div class="meta-view-body">
                <div class="meta-onboarding-wrap glass-card animate-fade" style="max-width: 550px;">
                    <div style="color:#FFE600; font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%;">
                        <i class="fas fa-handshake"></i>
                    </div>
                    <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                        <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Mercado Libre</h2>
                        <div style="height:3px; width:50px; background:#FFE600; border-radius:10px; margin:0 auto 12px;"></div>
                        <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.5; margin:0;">
                            Proximamente podras gestionar tus ventas, mensajes, cobros con Mercado Pago y notificaciones de Mercado Libre directamente desde el CRM.
                        </p>
                    </div>

                    <!-- Accordion Secciones -->
                    <div class="meli-accordion">
                        <!-- Mercado Libre Productos -->
                        <div class="meli-accordion-item">
                            <div class="meli-accordion-header" onclick="toggleMeliAccordion(this)">
                                <span class="meli-accordion-title">
                                    <i class="fas fa-boxes meli-accordion-icon"></i> Mercado Libre Productos
                                </span>
                                <i class="fas fa-chevron-down meli-accordion-chevron"></i>
                            </div>
                            <div class="meli-accordion-content">
                                <div class="meli-detail-step">
                                    <span class="meli-step-number">1</span>
                                    <span>crea y administra productos/precios/stock</span>
                                </div>
                            </div>
                        </div>

                        <!-- Mercado Libre Bot -->
                        <div class="meli-accordion-item">
                            <div class="meli-accordion-header" onclick="toggleMeliAccordion(this)">
                                <span class="meli-accordion-title">
                                    <i class="fas fa-robot meli-accordion-icon"></i> Mercado Libre Bot
                                </span>
                                <i class="fas fa-chevron-down meli-accordion-chevron"></i>
                            </div>
                            <div class="meli-accordion-content">
                                <div class="meli-detail-step">
                                    <span class="meli-step-number">2</span>
                                    <span>automatiza las respuestas a las consultas de tus clientes en base a la info del producto</span>
                                </div>
                            </div>
                        </div>

                        <!-- Mercado Pago -->
                        <div class="meli-accordion-item">
                            <div class="meli-accordion-header" onclick="toggleMeliAccordion(this)">
                                <span class="meli-accordion-title">
                                    <i class="fas fa-wallet meli-accordion-icon"></i> Mercado Pago
                                </span>
                                <i class="fas fa-chevron-down meli-accordion-chevron"></i>
                            </div>
                            <div class="meli-accordion-content">
                                <div class="meli-detail-step">
                                    <span class="meli-step-number">3</span>
                                    <span>Gestion ventas y pagos</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="background:var(--bg-header); padding:1rem 1.25rem; border-radius:16px; border:1px solid var(--border); width:100%; text-align:center; margin-top: 1.5rem;">
                        <span style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#FFE600;">Proximamente</span>
                    </div>
                </div>
            </div>
        </main>`;
    }

    function init() {
        window.toggleMeliAccordion = (el) => {
            const item = el.closest('.meli-accordion-item');
            if (!item) return;
            const isActive = item.classList.contains('active');
            
            // Cerrar todos los demás
            document.querySelectorAll('.meli-accordion-item').forEach(i => {
                i.classList.remove('active');
            });
            
            if (!isActive) {
                item.classList.add('active');
            }
        };
    }

    function destroy() {
        delete window.toggleMeliAccordion;
    }

    return {
        title: 'Mercado Libre - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
        destroy
    };
})();
