/* global loadViewScript */
window.webchatView = {
    title: 'Webchat - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <div class="flex flex-col flex-1" style="position:relative; z-index:10;">
            <div id="container" class="flex flex-col w-full max-w-2xl mx-auto h-screen">

                <!-- Header del bot -->
                <div id="header" class="flex items-center gap-4 px-5 py-4 flex-shrink-0 glass-strong rounded-none"
                    style="border-bottom:1px solid rgba(0,153,255,0.1);">
                    <img id="avatar"
                        src="https://img.freepik.com/vector-gratis/robot-vectorial-graident-ai_78370-4114.jpg?semt=ais_hybrid&w=740&q=80"
                        alt="Bot"
                        class="w-11 h-11 rounded-full object-cover flex-shrink-0 ring-2 ring-accent/30">
                    <div>
                        <div class="text-sm font-heading font-bold text-primary-content" id="assistantName">Asistente</div>
                        <div class="text-xs text-emerald-400 flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot"></span>
                            en linea
                        </div>
                    </div>
                </div>

                <!-- Area de mensajes -->
                <div id="chat"
                    class="flex-1 overflow-y-auto flex flex-col gap-2 px-4 py-5"
                    style="background: rgba(5,10,20,0.4);">
                </div>

                <!-- Input -->
                <div id="inputRow"
                    class="flex items-end gap-3 px-4 py-3 flex-shrink-0 glass-strong rounded-none"
                    style="border-top:1px solid rgba(0,153,255,0.1);">
                    <div class="inputWrapper flex-1 flex items-end gap-2 rounded-2xl px-4 py-2"
                        style="background:rgba(255,255,255,0.06); border:1px solid rgba(0,153,255,0.12);">
                        <button id="attach"
                            class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-secondary-content
                                   bg-transparent border-0 cursor-pointer transition-colors hover:text-accent-bright text-lg"
                            title="Adjuntar archivo">
                            <i class="fas fa-paperclip text-sm"></i>
                        </button>
                        <textarea id="input"
                            placeholder="Escribe un mensaje..."
                            rows="1"
                            class="flex-1 bg-transparent border-0 outline-none text-sm text-primary-content
                                   placeholder-white/30 py-1 leading-relaxed"
                            style="min-height:24px; max-height:120px;"></textarea>
                    </div>
                    <button id="send"
                        class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
                               text-white border-0 cursor-pointer transition-all hover:brightness-110 hover:scale-105"
                        title="Enviar"
                        style="background:linear-gradient(135deg,#0078D4,#0099FF); box-shadow:0 4px 12px rgba(0,120,212,0.35);">
                        <i class="fas fa-paper-plane text-sm"></i>
                    </button>
                    <input type="file" id="fileInput" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx">
                </div>
            </div>
        </div>`;
    },

    async init() {
        await loadViewScript('/js/main.js?v=2.1');
        if (typeof window.initWebchatView === 'function') window.initWebchatView();
    },

    destroy() {}
};
