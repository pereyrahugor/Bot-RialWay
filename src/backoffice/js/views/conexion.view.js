/* global loadViewScript */
window.conexionView = {
    title: 'Conexion - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <main class="crm-main-container relative" style="z-index:10;">
            <div class="flex items-center gap-3 mb-8 animate-reveal-up">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style="background:rgba(0,153,255,0.15); border:1px solid rgba(0,153,255,0.2);">
                    <i class="fas fa-plug-circle-bolt text-accent-bright"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-heading font-bold text-gradient-accent leading-tight">Conexion del Bot</h1>
                    <p class="text-xs text-secondary-content">${window.BOT_NAME || ''}</p>
                </div>
            </div>

            <div class="flex flex-col gap-5 max-w-2xl mx-auto">

                <!-- Card Estado / QR -->
                <div class="card text-center animate-reveal-up">
                    <h2 class="text-base font-heading font-semibold text-primary-content mb-5 flex items-center justify-center gap-2">
                        <i class="fas fa-satellite-dish text-accent-bright text-sm"></i> Estado de la Vinculacion
                    </h2>
                    <div class="flex items-center justify-center gap-3 mb-5 text-sm text-primary-content">
                        Estado de Sesion:
                        <span class="status" id="session-status">Cargando...</span>
                    </div>
                    <div id="group-connection-container"
                        class="flex items-center justify-center gap-3 mb-5 text-sm text-primary-content p-3 rounded-xl"
                        style="display:none; background:rgba(0,153,255,0.05); border:1px solid rgba(0,153,255,0.1);">
                        <span class="text-secondary-content">Estado de grupos:</span>
                        <span id="group-session-status" class="status">No configurado</span>
                    </div>
                    <div id="session-error" class="mb-3"></div>
                    <div id="baileys-start-container" style="display:none;" class="text-center my-5">
                        <p class="info-text mb-4">La conexion de Baileys no esta activa. Pulsa el boton para generar el codigo QR.</p>
                        <button id="generate-qr-btn" class="btn">
                            <i class="fas fa-qrcode"></i> Generar QR Baileys
                        </button>
                        <div id="generate-qr-loading" style="display:none;" class="mt-4 flex flex-col items-center gap-2">
                            <i class="fas fa-spinner animate-spin-loader text-accent-bright text-2xl"></i>
                            <p class="info-text text-center">Iniciando motor de WhatsApp... esto tardara unos segundos.</p>
                        </div>
                    </div>
                    <div id="qr-section" style="display:none;" class="mt-5">
                        <div class="inline-block bg-white p-5 rounded-2xl shadow-premium">
                            <h3 class="text-gray-700 text-sm font-heading font-semibold mb-3">Escaneá con WhatsApp</h3>
                            <img src="/qr.png" class="w-56 h-56 rounded-xl" alt="Codigo QR"
                                onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                            <p class="qr-error-msg hidden text-orange-400 p-4 text-sm">Generando QR... por favor espera.</p>
                        </div>
                        <p class="info-text mt-4 text-xs">La pagina se actualizara automaticamente cuando estes vinculado.</p>
                    </div>
                    <div id="session-info" style="display:none;"
                        class="text-sm font-heading font-semibold text-emerald-400 mt-3"></div>
                    <div id="whatsapp-link-container" style="display:none;" class="mt-5 flex justify-center">
                        <a id="whatsapp-link" href="#" target="_blank"
                            class="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-heading font-semibold text-sm text-white transition-all duration-200 hover:brightness-110"
                            style="background:#25D366; box-shadow:0 4px 12px rgba(37,211,102,0.3);">
                            <i class="fab fa-whatsapp"></i> Abrir en WhatsApp
                        </a>
                    </div>
                </div>

                <!-- Card Centro de Control -->
                <div class="card animate-reveal-up" style="border-left:3px solid rgba(0,153,255,0.5);">
                    <h2 class="text-base font-heading font-semibold text-primary-content mb-5 flex items-center gap-2">
                        <i class="fas fa-sliders-h text-accent-bright text-sm"></i> Centro de Control Maestro
                    </h2>
                    <div class="flex flex-col gap-4">
                        <div class="flex items-center justify-between p-4 rounded-xl gap-4"
                            style="background:rgba(0,153,255,0.05); border:1px solid rgba(0,153,255,0.1);">
                            <div>
                                <div class="text-sm font-heading font-semibold text-primary-content mb-1">Estado Global del Bot (IA)</div>
                                <div class="text-xs info-text">Cuando esta desactivado, el bot no respondera a ningun mensaje.</div>
                            </div>
                            <label class="switch flex-shrink-0">
                                <input type="checkbox" id="global-bot-toggle" checked>
                                <span class="slider round"></span>
                            </label>
                        </div>
                        <div class="flex items-center justify-between p-4 rounded-xl gap-4"
                            style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.1);">
                            <div>
                                <div class="text-sm font-heading font-semibold text-emerald-400 mb-1">Recargar Motor del Bot</div>
                                <div class="text-xs info-text">Aplica cambios de Meta o Google Sheets sin entrar a Railway. (Downtime: 30-45s)</div>
                            </div>
                            <button id="system-reload-btn"
                                class="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl font-heading font-semibold text-sm text-white transition-all hover:brightness-110"
                                style="background:linear-gradient(135deg,#10b981,#059669);">
                                <i class="fas fa-sync-alt"></i> Reiniciar
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Card Zona de Peligro -->
                <div class="card animate-reveal-up text-center" style="border-top:3px solid rgba(239,68,68,0.5);">
                    <h2 class="text-base font-heading font-semibold text-red-400 mb-3 flex items-center justify-center gap-2">
                        <i class="fas fa-triangle-exclamation"></i> Zona de Peligro
                    </h2>
                    <p class="info-text text-sm mb-5">
                        Si el bot no responde o falla la conexion, podes forzar un cierre de sesion para generar un QR, o desvincular Meta por completo.
                    </p>
                    <div class="flex flex-col gap-3 items-center">
                        <button id="go-reset" class="btn btn-danger w-full max-w-xs justify-center">
                            <i class="fas fa-trash-alt"></i> Reiniciar Sesion Completamente
                        </button>
                        <button id="go-unlink-meta" class="btn w-full max-w-xs justify-center"
                            style="background:linear-gradient(135deg,#dc2626,#b91c1c);">
                            <i class="fab fa-meta"></i> Desvincular Meta
                        </button>
                    </div>
                </div>
            </div>
        </main>

        <!-- Modal Reinicio -->
        <div id="resetModal" class="hidden fixed inset-0 z-50 flex items-center justify-center"
            style="background:rgba(5,10,20,0.8); backdrop-filter:blur(8px);">
            <div class="glass-strong w-full max-w-sm mx-4 p-8 text-center animate-pop-in">
                <i class="fas fa-exclamation-triangle text-4xl text-red-400 mb-5 block"></i>
                <h3 class="text-xl font-heading font-bold text-red-400 mb-3">Estas seguro?</h3>
                <p class="info-text text-sm mb-6">Se borraran las credenciales actuales y el bot se reiniciara completamente. Tendras que escanear el QR de nuevo.</p>
                <div class="flex gap-3 justify-center">
                    <button id="confirmNo" class="btn-outline px-5 py-2.5 text-sm">Cancelar</button>
                    <button id="confirmSi" class="btn btn-danger px-5 py-2.5 text-sm">
                        <i class="fas fa-check"></i> Si, reiniciar
                    </button>
                </div>
            </div>
        </div>

        <!-- Modal Desvincular Meta -->
        <div id="unlinkMetaModal" class="hidden fixed inset-0 z-50 flex items-center justify-center"
            style="background:rgba(5,10,20,0.8); backdrop-filter:blur(8px);">
            <div class="glass-strong w-full max-w-sm mx-4 p-8 text-center animate-pop-in" style="border-top:3px solid #ef4444;">
                <i class="fab fa-meta text-5xl text-red-400 mb-5 block"></i>
                <h3 class="text-xl font-heading font-bold text-red-400 mb-3">Desvincular Meta?</h3>
                <p class="info-text text-sm mb-6">Se desvinculara permanentemente el numero de telefono y la app en los servidores de Meta, y se limpiara el onboarding en la base de datos. El bot se reiniciara automaticamente.</p>
                <div class="flex gap-3 justify-center">
                    <button id="confirmUnlinkNo" class="btn-outline px-5 py-2.5 text-sm">Cancelar</button>
                    <button id="confirmUnlinkSi" class="btn btn-danger px-5 py-2.5 text-sm">
                        <i class="fas fa-check"></i> Si, desvincular
                    </button>
                </div>
            </div>
        </div>`;
    },

    async init() {
        await loadViewScript('/js/conexion.js');
        if (typeof window.initConexionView === 'function') window.initConexionView();
    },

    destroy() {
        if (typeof window.destroyConexionView === 'function') window.destroyConexionView();
    }
};
