import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createBot, createProvider, createFlow, MemoryDB } from "@builderbot/bot";
import { httpInject } from "@builderbot-plugins/openai-assistants";
import { SupabaseBaileysProvider } from "./backend/providers/SupabaseBaileysProvider";
import { MetaCloudProvider } from "./backend/providers/MetaCloudProvider";
import { setAdapterProvider, setGroupProvider, getGroupProvider } from "./backend/providers/instances";
import { isSessionInDb, deleteAllProjectSessionsFromDb } from "./backend/providers/sessionSync";
import { ErrorReporter } from "./backend/bot/errorReporter";
import { updateMain } from "./backend/apis/google/updateMain";
import { HistoryHandler, historyEvents } from "./backend/db/historyHandler";
import { registerProcessCallback, handleQueue, userQueues, userLocks } from "./backend/bot/queueManager";
import { registerBackofficeRoutes, processSendMessage, processBulkTemplate, processImportExcel, processUploadBasePedido } from "./backend/backoffice/routes/backoffice.routes";
import { registerDashboardRoutes } from "./backend/backoffice/routes/dashboard.routes";
import { registerStaticRoutes } from "./backend/backoffice/routes/static.routes";
import { registerWebchatRoutes } from "./backend/backoffice/webchat/routes/webchat.routes";
import { registerRailwayRoutes } from "./backend/apis/railway/railway.routes";
import { upload } from "./backend/middleware/upload";
import { initSocketIO } from "./backend/sockets/socket.manager";
import { registerProviderEvents, hasActiveSession } from "./backend/providers/provider.manager";
import { startHumanInactivityWorker } from "./backend/workers/humanInactivity.worker";
import { startFileCleanupWorker } from "./backend/workers/fileCleanup.worker";
import { DemoResetWorker } from "./backend/workers/demoReset.worker";
import { AiManager } from "./backend/bot/ai.manager";
import { isApiKeyCommand, isAuthorizedApiKeyRequester } from "./backend/utils/authCommands";
import { registerExternalApiRoutes } from "./backend/apis/external/external_api.routes";
import { syncAssistantTools, getOpenAI } from "./backend/apis/openai/openaiHelper";
import { registerWebhookRoutes } from "./backend/webhook/webhook.routes";
import { WebhookDispatcher } from "./backend/webhook/WebhookDispatcher";
import { discoverMetaIds } from "./backend/apis/meta/metaDiscovery";
import { RailwayApi } from "./backend/apis/railway/Railway";
import { smartBodyParser, compatibilityLayer, rootRedirect } from "./backend/middleware/global";
import { backofficeAuth } from "./backend/backoffice/middleware/auth";
import bodyParser from 'body-parser';
import { welcomeFlowTxt } from "./backend/bot/flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./backend/bot/flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./backend/bot/flows/welcomeFlowImg";
import { welcomeFlowVideo } from "./backend/bot/flows/welcomeFlowVideo";
import { welcomeFlowDoc } from "./backend/bot/flows/welcomeFlowDoc";
import { locationFlow } from "./backend/bot/flows/locationFlow";
import { idleFlow } from "./backend/bot/flows/idleFlow";
import { welcomeFlowButton } from "./backend/bot/flows/welcomeFlowButton";
import { reset } from "./backend/bot/timeOut";

// --- Silence Verbose libsignal / session_record logs ---
const originalConsoleInfo = console.info;
console.info = function (...args: any[]) {
    if (args[0] && typeof args[0] === 'string' && (
        args[0].includes('Closing session:') || 
        args[0].includes('Opening session:') || 
        args[0].includes('Removing old closed session:')
    )) {
        return;
    }
    originalConsoleInfo.apply(console, args);
};


const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global instances
export let adapterProvider: any;
export let groupProvider: any;
export let errorReporter: any;
export let aiManagerInstance: AiManager;


// Las instancias de OpenAI se resuelven dinámicamente vía openaiHelper
// const PORT = process.env.PORT || 8080;




// Error handling setup
function registerSafeErrorHandlers() {
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    process.on("uncaughtException", (error) => {
        console.error(`⚠️ [UncaughtException] ${new Date().toISOString()}:`, error);
    });
    process.on("unhandledRejection", (reason) => {
        console.error(`⚠️ [UnhandledRejection] ${new Date().toISOString()}:`, reason);
    });
}

/**
 * Main function for Bot and Server Orchestration
 */
const main = async () => {
    // Interceptar stdout para suprimir el spam de rutas generadas automáticamente
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = function(chunk: any, ...args: any[]) {
        const str = typeof chunk === 'string' ? chunk : (Buffer.isBuffer(chunk) ? chunk.toString() : '');
        if (/\[(GET|POST|PUT|DELETE|PATCH)\]: http/.test(str)) {
            return true; // Suprimir logs de endpoints
        }
        return originalStdoutWrite.apply(process.stdout, [chunk, ...args] as any);
    } as any;

    // 1. Storage cleanup and session restoration
    // Await initDatabase so settings/variables are loaded from DB first
    try {
        await HistoryHandler.initDatabase();
        // Inicializar despachador de webhooks salientes
        WebhookDispatcher.init();
    } catch (err) {
        console.warn('[App] initDatabase error:', err);
    }

    // Proxy central desactivado temporalmente para conexión limpia directa
    const PORT = process.env.PORT || 8080;
    
    // El proceso de sincronización de tools se movió más abajo para asegurar que todas las variables estén recuperadas.
    // await syncAssistantTools(ASSISTANT_ID, HistoryHandler.PROJECT_IDENTIFIER, HistoryHandler.SERVICE_IDENTIFIER); // MOVIDO

    
    // Usar un nombre de sesión consistente para evitar desajustes entre SessionSync y el Provider
    // Sanitizar para evitar caracteres inválidos en rutas (como *)
    const rawSessionName = await HistoryHandler.getConfig('BOT_NAME') || await HistoryHandler.getConfig('ASSISTANT_NAME') || 'bot';
    const SESSION_NAME = rawSessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // await restoreSessionFromDb(SESSION_NAME);
    const qrPath = path.join(process.cwd(), "bot.qr.png");

    // Usar versión fija conocida que funciona
    const baileysVersion: any = [2, 3000, 1043857760]; //Vencimineto = 
    console.log(`📡 [App] Usando versión fija de WhatsApp Web: ${baileysVersion.join('.')}`);

    // 2. Initialize Providers
    const metaConfig = await HistoryHandler.getMetaOnboardingData();
    
    // Fallback: Si no hay config en DB o falta el token, intentamos usar variables de entorno
    const metaToken = (metaConfig?.access_token && metaConfig.access_token !== "PENDING") ? metaConfig.access_token : process.env.META_ACCESS_TOKEN;
    let metaPhoneId = (metaConfig?.phone_number_id && metaConfig.phone_number_id !== "PENDING") ? metaConfig.phone_number_id : process.env.META_PHONE_ID;
    let metaWabaId = (metaConfig?.waba_id && metaConfig.waba_id !== "PENDING") ? metaConfig.waba_id : process.env.META_WABA_ID;

    // --- AUTO-DESCUBRIMIENTO DE META ---
    if (metaToken && (!metaPhoneId || metaPhoneId === 'PENDING' || !metaWabaId || metaWabaId === 'PENDING')) {
        console.log('📡 [App] Detectada configuración de Meta parcial. Iniciando recuperación automática de IDs...');
        try {
            const mainToken = await HistoryHandler.getMainToken();
            const appId = await HistoryHandler.getConfig('META_APP_ID');
            const appSecret = await HistoryHandler.getConfig('META_APP_SECRET');
            const discovery = await discoverMetaIds(metaToken, mainToken, appId, appSecret);
            if (discovery && discovery.data?.phoneNumberId && discovery.data?.wabaId) {
                console.log(`✅ [App] Recuperación exitosa: PhoneID=${discovery.data.phoneNumberId}, WABAID=${discovery.data.wabaId}`);
                metaPhoneId = discovery.data.phoneNumberId;
                metaWabaId = discovery.data.wabaId;
                await HistoryHandler.saveMetaOnboardingData(metaWabaId, metaPhoneId, metaToken, { ...discovery.data, syncedAt: new Date().toISOString() });
            }
        } catch (e: any) {
            console.error('⚠️ [App] Error en auto-descubrimiento de Meta:', e.message);
        }
    }

    const currentServiceId = HistoryHandler.SERVICE_IDENTIFIER;
    const useMeta = !!metaToken && !!metaPhoneId && metaPhoneId !== 'PENDING';

    if (useMeta) {
        console.log('🚀 [App] Modo Dual detectado (Meta API + Baileys Grupos)');
        adapterProvider = createProvider(MetaCloudProvider, {
            waba_id: metaWabaId || "PENDING",
            phone_number_id: metaPhoneId,
            access_token: metaToken,
            verify_token: process.env.META_VERIFY_TOKEN || "BotRialWayVerifyToken2026"
        });
        
        // --- CONFIGURACIÓN DE GRUPOS (AUXILIAR) ---
        // Solo crear proveedor de grupos si hay una configuración de Meta realmente persistida 
        const hasMetaSession = metaConfig && metaConfig.access_token && metaConfig.access_token !== 'PENDING' && metaConfig.phone_number_id !== 'PENDING';
        
        if (hasMetaSession) {
            console.log('🔗 [App] Inicializando conexión auxiliar para grupos...');
            groupProvider = createProvider(SupabaseBaileysProvider, {
                name: `${SESSION_NAME}_groups`, 
                service_id: currentServiceId,
                serviceId: currentServiceId,
                project_id: HistoryHandler.PROJECT_IDENTIFIER,
                projectId: HistoryHandler.PROJECT_IDENTIFIER,
                ...(baileysVersion ? { version: baileysVersion } : {}),
                groupsIgnore: false,
                readStatus: false,
                disableHttpServer: true,
            });
            setGroupProvider(groupProvider);
        } else {
            console.log('⚠️ [App] Meta detectado en env pero no hay sesión activa en DB. Saltando conexión auxiliar de grupos.');
            groupProvider = null;
            setGroupProvider(null);
        }
    } else {
        console.log('🚀 [App] Modo Estándar detectado (Baileys para todo)');
        adapterProvider = createProvider(SupabaseBaileysProvider, {
            name: SESSION_NAME, 
            service_id: currentServiceId,
            serviceId: currentServiceId,
            project_id: HistoryHandler.PROJECT_IDENTIFIER,
            projectId: HistoryHandler.PROJECT_IDENTIFIER,
            ...(baileysVersion ? { version: baileysVersion } : {}),
            groupsIgnore: false,
            readStatus: false,
            disableHttpServer: true,
        });
        groupProvider = null;
        setGroupProvider(null);
    }
    
    setAdapterProvider(adapterProvider);

    // 3. Register Provider Events
    registerProviderEvents(adapterProvider);

    // --- INICIALIZACIÓN DE MOTORES ---
    // Importante: Llamar a initVendor explícitamente solo una vez aquí si existe una sesión previa en la base de datos.
    const hasAdapterSession = await isSessionInDb(SESSION_NAME, currentServiceId);
    if (adapterProvider.initVendor) {
        if (hasAdapterSession) {
            console.log('🚀 [App] Sesión previa detectada. Inicializando Motor Principal (Baileys)...');
            await adapterProvider.initVendor();
        } else {
            console.log('ℹ️ [App] No se detectó sesión previa en base de datos para el Motor Principal (Baileys). Esperando a que el usuario inicie generación de QR desde el Backoffice.');
            adapterProvider.preventAutoStart = true;
        }
    }

    if (groupProvider) {
        registerProviderEvents(groupProvider, true);
        const hasGroupSession = await isSessionInDb(`${SESSION_NAME}_groups`, currentServiceId);
        if (groupProvider.initVendor) {
            if (hasGroupSession) {
                console.log('🚀 [App] Sesión previa detectada. Inicializando Motor de Grupos (Baileys Auxiliar)...');
                await groupProvider.initVendor();
            } else {
                console.log('ℹ️ [App] No se detectó sesión previa en base de datos para el Motor de Grupos (Baileys Auxiliar). Esperando a que el usuario inicie generación de QR desde el Backoffice.');
                groupProvider.preventAutoStart = true;
            }
        }
    }

    // 4. Initialize Database and Configuration (Ya inicializado arriba)

    
    const groupResumenId = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN', HistoryHandler.PROJECT_IDENTIFIER, HistoryHandler.SERVICE_IDENTIFIER) || "";
    errorReporter = new ErrorReporter(adapterProvider, groupResumenId);
    await updateMain();
    
    // 4.1. Sincronizar herramientas con OpenAI Assistant (Ahora que el entorno está listo)
    const ASSISTANT_ID = await HistoryHandler.getConfig('ASSISTANT_ID', HistoryHandler.PROJECT_IDENTIFIER, HistoryHandler.SERVICE_IDENTIFIER);
    if (ASSISTANT_ID) {
        // Auto-sincronizar definición de herramientas del módulo en la DB antes de sincronizar con OpenAI
        const slug = await HistoryHandler.getConfig('CLIENT_SLUG', HistoryHandler.PROJECT_IDENTIFIER, HistoryHandler.SERVICE_IDENTIFIER);
        if (slug) {
            const cleanSlug = slug.trim().toLowerCase();
            try {
                const { moduleRegistry } = await import('./backend/bot/toolRegistry');
                const activeModule = (moduleRegistry as any)[cleanSlug];
                if (activeModule && activeModule.openAiTools) {
                    console.log(`🤖 [App/OpenAI] Sincronizando definición de herramientas para el módulo '${cleanSlug}' en DB...`);
                    await HistoryHandler.saveSetting(
                        'OPENAI_TOOLS_DEFINITION', 
                        JSON.stringify(activeModule.openAiTools), 
                        HistoryHandler.PROJECT_IDENTIFIER, 
                        HistoryHandler.SERVICE_IDENTIFIER
                    );
                }
            } catch (err: any) {
                console.error(`⚠️ [App/OpenAI] Error sincronizando herramientas del módulo en DB al inicio:`, err.message);
            }
        }

        console.log(`[App] 🔄 Iniciando sincronización de tools para Assistant: ${ASSISTANT_ID}`);
        await syncAssistantTools(ASSISTANT_ID, HistoryHandler.PROJECT_IDENTIFIER, HistoryHandler.SERVICE_IDENTIFIER);
    }


    const app = adapterProvider.server;
    if (app) {
        // Remover parsers por defecto con límite de 100kb de Polka/Builderbot para evitar PayloadTooLargeError en peticiones grandes
        if (Array.isArray(app.wares)) {
            app.wares = app.wares.filter((fn: any) => {
                const name = fn.name || '';
                return name !== 'jsonParser' && name !== 'urlencodedParser';
            });
        }

        // 5. Polka/Express Server setup & Early Middlewares
        app.use(compatibilityLayer);
        app.use(rootRedirect);

        // --- MASTER-INTERCEPTOR DE STREAMS (EL PRIMERO SIEMPRE) ---
        app.use((req: any, res: any, next: any) => {
            const normalizedPath = (req.url || '').split('?')[0].replace(/\/+/g, '/');
            const isBulk = normalizedPath.includes('/api/backoffice/whatsapp/send-bulk-template');
            const isSend = normalizedPath.includes('/api/backoffice/send-message');
            const isImport = normalizedPath.includes('/api/backoffice/chats/import');
            const isTrustUpload = normalizedPath.includes('/api/backoffice/trust/upload-base-pedido');

            if ((isSend || isBulk || isImport || isTrustUpload) && req.method === 'POST') {
                req.setTimeout(0);
                console.log(`🛡️ [MASTER-INTERCEPTOR-PRIORITY] Bypass activo para: ${normalizedPath}`);
                
                return backofficeAuth(req, res, async () => {
                    const contentType = req.headers['content-type'] || '';
                    

                    // Sincronizar Meta Provider antes de procesar si es necesario
                    const pId = req.query.projectId || (req.body && req.body.projectId) || req.headers['x-project-id'] || (req.auth && req.auth.projectId) || null;
                    const sId = req.query.serviceId || (req.body && req.body.serviceId) || req.headers['x-service-id'] || (req.auth && req.auth.serviceId) || null;
                    const metaOnboarding = await HistoryHandler.getMetaOnboardingData(pId, false, sId);
                    if (metaOnboarding && adapterProvider && adapterProvider.updateConfig) {
                        adapterProvider.updateConfig({
                            access_token: metaOnboarding.whatsappToken,
                            phone_number_id: metaOnboarding.whatsappNumberId,
                            verify_token: process.env.META_VERIFY_TOKEN,
                            waba_id: metaOnboarding.whatsappBusinessId
                        });
                    }

                    if (contentType.includes('multipart/form-data')) {
                        const multerMiddleware = upload.single('file');
                        
                        return multerMiddleware(req, res, (err: any) => {
                            if (err) {
                                console.error("❌ [MASTER-INTERCEPTOR] Multer Error:", err);
                                res.statusCode = 500;
                                res.setHeader('Content-Type', 'application/json');
                                return res.end(JSON.stringify({ success: false, error: `Error de stream: ${err.message}` }));
                            }
                            if (isSend) {
                                const { chatId, message, replyTo } = req.body;
                                return processSendMessage(req, res, chatId, message, (req as any).file, replyTo);
                            } else if (isImport) {
                                console.log("🚀 [MASTER-INTERCEPTOR] Ejecutando lógica de importación...");
                                return processImportExcel(req, res);
                            } else if (isTrustUpload) {
                                console.log("🚀 [MASTER-INTERCEPTOR] Ejecutando lógica de importación de base de pedidos (bypass stream)...");
                                return processUploadBasePedido(req, res);
                            } else {
                                console.log("🚀 [MASTER-INTERCEPTOR] Ejecutando lógica de envío masivo (bypass total)...");
                                return processBulkTemplate(req, res);
                            }
                        });
                    } else {
                        return bodyParser.json()(req, res, () => {
                            if (isSend) {
                                const { chatId, message, replyTo } = req.body;
                                return processSendMessage(req, res, chatId || '', message || '', null, replyTo);
                            } else if (isImport) {
                                return next();
                            } else {
                                return processBulkTemplate(req, res);
                            }
                        });
                    }
                });
            }
            next();
        });

        app.onError = (err: any, _req: any, res: any) => {
            console.error("🔥 [POLKA ERROR]:", err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message || "Internal Server Error" }));
        };

        
    }

    // 6. Initialize AI Manager and flows
    const flows = { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow, idleFlow, welcomeFlowButton };
    const openaiMain = await getOpenAI(HistoryHandler.PROJECT_IDENTIFIER, HistoryHandler.SERVICE_IDENTIFIER);
    const assistantIdValue = await HistoryHandler.getConfig('ASSISTANT_ID', HistoryHandler.PROJECT_IDENTIFIER, HistoryHandler.SERVICE_IDENTIFIER) || "";

    aiManagerInstance = new AiManager(openaiMain, assistantIdValue, errorReporter, flows);

    registerProcessCallback(async (item: any) => {
        const { ctx, flowDynamic, state, provider, gotoFlow } = item;

        const rawBody = String(ctx.body || '').trim();
        if (isApiKeyCommand(rawBody)) {
            const sender = ctx.from || ctx.key?.remoteJid || '';
            if (isAuthorizedApiKeyRequester(sender)) {
                try {
                    const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
                    const projectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || state?.get?.('dynamicProjectId') || process.env.RAILWAY_PROJECT_ID;
                    const serviceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber) || state?.get?.('dynamicServiceId') || process.env.RAILWAY_SERVICE_ID;
                    const apiKey = await HistoryHandler.getProjectApiKey(projectId, serviceId);
                    const replyMsg = `El API_KEY de la instancia consultada es:\n${apiKey}`;
                    await flowDynamic([{ body: replyMsg }]);
                    await HistoryHandler.saveMessage(ctx.from, 'assistant', replyMsg, 'text', null, ctx.userId, null, ctx.platform, projectId, serviceId);
                } catch (err: any) {
                    console.error("Error en comando #API_KEY#:", err);
                }
                return;
            }
        }

        const normalizedCmd = rawBody.toUpperCase();
        if (normalizedCmd === '#GRUPO_TEST#' || normalizedCmd === '#GRUPO_TEST') {
            try {
                const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
                const projectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || state.get('dynamicProjectId') || process.env.RAILWAY_PROJECT_ID;
                const serviceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber) || state.get('dynamicServiceId') || process.env.RAILWAY_SERVICE_ID;
                const ID_GRUPO_RESUMEN = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN', projectId, serviceId) || '';
                
                console.log(`[GRUPO_TEST] Command received. BotNumber: ${botPhoneNumber} | ProjectId: ${projectId} | GroupJID: ${ID_GRUPO_RESUMEN}`);

                if (!ID_GRUPO_RESUMEN) {
                    await flowDynamic("❌ No hay un grupo de reporte 1 (ID_GRUPO_RESUMEN) configurado para este proyecto.");
                    return;
                }

                const groupProvider = getGroupProvider();
                const isDualMode = !!groupProvider;
                const activeBaileysProvider = isDualMode ? groupProvider : (provider.constructor.name.includes('Baileys') ? provider : null);

                if (!activeBaileysProvider) {
                    await flowDynamic("❌ El bot está corriendo en modo Meta API y no se detectó una sesión auxiliar de Baileys para grupos conectada.");
                    return;
                }

                const vendor = activeBaileysProvider.vendor;
                const isReady = !!(vendor?.authState?.creds?.me?.id || vendor?.user?.id);

                if (!isReady || !vendor) {
                    await flowDynamic("❌ La sesión de Baileys para reportes a grupos no está activa o sincronizada. Escanea el código QR en el Backoffice.");
                    return;
                }

                console.log(`[GRUPO_TEST] Enviando mensaje nativo de Baileys al grupo: ${ID_GRUPO_RESUMEN}`);
                // Usar el método nativo de Baileys para asegurar el envío correcto al grupo sin modificaciones de JID de BuilderBot
                await vendor.sendMessage(ID_GRUPO_RESUMEN, { text: "Msj de test reporte a grupos" });
                
                await flowDynamic(`✅ Mensaje de prueba enviado al grupo: ${ID_GRUPO_RESUMEN}`);
            } catch (err: any) {
                console.error("Error en command #GRUPO_TEST#:", err);
                await flowDynamic(`❌ Error al enviar mensaje: ${err.message}`);
            }
            return;
        }

        const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || state.get('dynamicProjectId') || process.env.RAILWAY_PROJECT_ID;
        const dynamicServiceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber) || state.get('dynamicServiceId') || process.env.RAILWAY_SERVICE_ID;
        const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre', dynamicProjectId, dynamicServiceId) || 15;
        const setTime = Number(timeoutCierreValue) * 60 * 1000;
        reset(ctx, gotoFlow, setTime);
        await aiManagerInstance.processUserMessage(ctx, { flowDynamic, state, provider, gotoFlow });
    });

    // 7. Create flow and bot instance
    const adapterFlow = createFlow([welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow, welcomeFlowButton, idleFlow, welcomeFlowTxt]);
    const adapterDB = new MemoryDB();

    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB
    });

    registerSafeErrorHandlers();
    // startSessionSync(SESSION_NAME);

    // 8. Middlewares y Plugins post-Bot
    if (app) {
        // Plugins y Middlewares Globales de Body-Parsing
        httpInject(app);
        app.use(smartBodyParser);

        // 9. Register Other Routes
        registerBackofficeRoutes(app);
        registerDashboardRoutes(app);
        registerStaticRoutes(app, { __dirname });
        registerWebchatRoutes(app);
        registerWebhookRoutes(app);

        registerExternalApiRoutes(app, { adapterProvider, groupProvider });
        registerRailwayRoutes(app, { RailwayApi });

        // API Health & Info
        app.get("/health", (_req: any, res: any) => res.json({ status: "ok", time: new Date().toISOString() }));
        app.get("/api/test-proxy", async (_req: any, res: any) => {
            try {
                const { SocksProxyAgent } = await import('socks-proxy-agent');
                const { default: axios } = await import('axios');
                const agent = new SocksProxyAgent('socks5://127.0.0.1:1080');
                const results: any = {};
                
                try {
                    const googleRes = await axios.get('https://www.google.com', {
                        httpAgent: agent,
                        httpsAgent: agent,
                        timeout: 8000
                    });
                    results.google = { success: true, status: googleRes.status };
                } catch (err: any) {
                    results.google = { success: false, error: err.message };
                }

                try {
                    const ipRes = await axios.get('https://api.ipify.org?format=json', {
                        httpAgent: agent,
                        httpsAgent: agent,
                        timeout: 8000
                    });
                    results.ipify = { success: true, ip: ipRes.data.ip };
                } catch (err: any) {
                    results.ipify = { success: false, error: err.message };
                }

                try {
                    const wsRes = await axios.get('https://web.whatsapp.com', {
                        httpAgent: agent,
                        httpsAgent: agent,
                        timeout: 8000
                    });
                    results.whatsapp = { success: true, status: wsRes.status };
                } catch (err: any) {
                    results.whatsapp = { success: false, error: err.message };
                }

                res.json(results);
            } catch (globalErr: any) {
                res.status(500).json({ error: globalErr.message });
            }
        });
        app.get("/api/assistant-name", async (_req: any, res: any) => {
            let name = process.env.RAILWAY_SERVICE_NAME || process.env.ASSISTANT_NAME || process.env.BOT_NAME || "Bot";
            const railwayProjectId = HistoryHandler.PROJECT_IDENTIFIER || process.env.RAILWAY_PROJECT_ID || process.env.PROJECT_ID || '';

            if (railwayProjectId) {
                try {
                    const { data, error } = await HistoryHandler.getSupabase()
                        .from('proyectos_railway')
                        .select('nombre_personalizado')
                        .eq('railway_project_id', railwayProjectId)
                        .maybeSingle();

                    if (!error && data?.nombre_personalizado) {
                        name = data.nombre_personalizado;
                    }
                } catch (error: any) {
                    console.warn('[API] No se pudo obtener nombre_personalizado:', error?.message || error);
                }
            }

            res.json({ name });
        });
        app.get("/api/dashboard-status", async (req: any, res: any) => {
            const requestedProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
            const requestedServiceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : null;
            const sessionStatus = await hasActiveSession(adapterProvider, groupProvider, requestedProjectId, requestedServiceId);
            const projectId = sessionStatus.activeProjectId || HistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = requestedServiceId || process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER;
            const clientSlug = await HistoryHandler.getConfig('CLIENT_SLUG', projectId, serviceId);
            res.json({
                ...sessionStatus,
                clientSlug
            });
        });

        // API Session Control
        app.post("/api/delete-session", backofficeAuth, async (_req: any, res: any) => {
            try {
                console.log(`[API] 🗑️ Petición de eliminación de todas las sesiones para el proyecto`);
                
                // 1. Borrar todas las sesiones del proyecto de la base de datos
                await deleteAllProjectSessionsFromDb();

                // 2. Detener los proveedores y limpiar su memoria para que no re-guarden
                // credenciales o sesiones pertenecientes al tenant anterior.
                const providers = [adapterProvider, groupProvider];

                for (const provider of providers) {
                    if (!provider) continue;

                    // Baileys: detener socket, listeners y cualquier posibilidad de
                    // re-persistir la sesión anterior.
                    if (provider.constructor.name === 'SupabaseBaileysProvider') {
                        console.log(
                            `[API] Deteniendo proveedor Baileys: ${provider.globalVendorArgs?.name || 'default'}`
                        );

                        provider.preventAutoStart = true;

                        if (provider.vendor) {
                            try {
                                provider.vendor.ev.removeAllListeners('connection.update');
                                provider.vendor.ev.removeAllListeners('creds.update');
                                provider.vendor.end(undefined);
                            } catch (e: any) {
                                console.warn(
                                    '[API] Error cerrando socket de Baileys:',
                                    e.message
                                );
                            }

                            provider.vendor = null;
                        }

                        provider.initialized = false;
                        provider.qrCodeString = null;
                        provider.pairingCode = null;
                        provider.connectionState = 'close';
                    }

                    // Meta Cloud API: eliminar access_token, phone_number_id y waba_id
                    // pertenecientes al tenant anterior.
                    if (typeof provider.clearTenantConfig === 'function') {
                        console.log(
                            '[API] Invalidando credenciales Meta del tenant actual en memoria...'
                        );

                        provider.clearTenantConfig();
                    }
                }

                // 3. Borrar la carpeta local de sesiones para evitar restauraciones automáticas
                const sessionPath = path.join(process.cwd(), 'bot_sessions');
                if (fs.existsSync(sessionPath)) {
                    try {
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                        console.log(`[API] ✅ Carpeta local de sesiones eliminada.`);
                    } catch (fsErr: any) {
                        console.warn('[API] Error borrando carpeta local bot_sessions:', fsErr.message);
                    }
                }

                historyEvents.emit('whatsapp_line_changed', {
                    projectId: HistoryHandler.PROJECT_IDENTIFIER,
                    project_id: HistoryHandler.PROJECT_IDENTIFIER,
                    serviceId: HistoryHandler.SERVICE_IDENTIFIER,
                    service_id: HistoryHandler.SERVICE_IDENTIFIER,
                    provider: 'baileys',
                    active: false,
                    connection: 'close'
                });

                res.json({ success: true });
            } catch (err: any) {
                console.error('Error en /api/delete-session:', err);
                res.status(500).json({ success: false, error: err.message });
            }
        });
    }
        
    // 10. Workers Initialization
    // Se ejecuta periódicamente verificando inactividad humana según el timeout configurado en minutos (default 30 min)
    if (process.env.ENABLE_HUMAN_INACTIVITY_WORKER === 'true') {
        console.log('🤖 [Worker] ENABLE_HUMAN_INACTIVITY_WORKER=true detectado. Iniciando worker de inactividad humana...');
        startHumanInactivityWorker(30, 1);
    } else {
        console.log('⏸️ [Worker] Worker de inactividad humana desactivado en esta instancia (ENABLE_HUMAN_INACTIVITY_WORKER != true).');
    }
    startFileCleanupWorker(5);
    DemoResetWorker.initCron();

    // 11. Start Server and Sockets
    try {
        httpServer(+PORT);
        console.log(`\n🚀 Servidor local corriendo en http://localhost:${PORT}\n`);
        let checks = 0;
        const checkInterval = setInterval(() => {
            checks++;
            if (app?.server) {
                console.log(`✅ [Socket.IO] app.server detectado, lanzando initSocketIO (Intento ${checks})`);
                initSocketIO(app.server, { processUserMessage: aiManagerInstance.processUserMessage });
                clearInterval(checkInterval);
            } else if (checks >= 20) {
                console.error("❌ [Socket.IO] app.server no detectado tras 10 segundos. Socket.IO falló.");
                clearInterval(checkInterval);
            }
        }, 500);
    } catch (err) {
        console.error("❌ [FATAL] Error starting server:", err);
    }
};

main().catch(err => console.error("❌ [FATAL MAIN]:", err));

export {
    welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow,
    AiManager, handleQueue, userQueues, userLocks
};

export const processUserMessage = async (ctx: any, items: any) => {
    if (!aiManagerInstance) throw new Error("AiManager not initialized");
    return await aiManagerInstance.processUserMessage(ctx, items);
};
// Trigger nodemon reload after implementing custom client lead context in openai helper system prompt
