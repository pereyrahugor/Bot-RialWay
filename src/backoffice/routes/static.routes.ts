import path from 'path';
import fs from 'fs';
import serve from 'serve-static';
import { backofficeAuth } from '../middleware/auth'; // auth vive en backoffice/middleware

let _visibilityCache: { wa: string; ig: string; ms: string; crm: string; sysConfig: string } | null = null;
let _visibilityCacheAt = 0;
const VISIBILITY_TTL = 60 * 1000;

/**
 * Registra las rutas de servicio de HTML y archivos estáticos.
 */
export const registerStaticRoutes = (app: any, { __dirname, provider, groupProvider }: { __dirname: string, provider?: any, groupProvider?: any }) => {

    const serveHtmlPage = (route: string, filename: string, middlewares: any[] = []) => {
        const handler = async (req: any, res: any) => {
            try {
                const { HistoryHandler } = await import('../db/historyHandler');
                const possiblePaths = [
                    path.join(process.cwd(), 'src', 'backoffice', 'html', filename),
                    path.join(process.cwd(), 'src', 'html', filename),
                    path.join(process.cwd(), filename),
                    path.join(process.cwd(), 'src', filename),
                    path.join(__dirname, 'backoffice', 'html', filename),
                    path.join(__dirname, 'html', filename),
                    path.join(__dirname, filename),
                    path.join(__dirname, '..', 'src', 'backoffice', 'html', filename)
                ];

                let htmlPath = null;
                for (const p of possiblePaths) {
                    if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
                        htmlPath = p;
                        break;
                    }
                }

                if (htmlPath) {
                    let htmlContent = fs.readFileSync(htmlPath, 'utf8');
                    const botName = process.env.ASSISTANT_NAME || process.env.RAILWAY_PROJECT_NAME || "Neurolinks";
                    
                    console.log(`[Static] 🟢 Sirviendo ${filename} para ${route}. botName=${botName}`);

                    // Helper con timeout para evitar bloqueos por red hacia Supabase
                    const getSettingSafe = async (key: string, defaultValue: string = 'true'): Promise<string> => {
                        try {
                            const timeoutPromise = new Promise<string>((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), 2500)
                            );
                            const result = await Promise.race([
                                HistoryHandler.getSetting(key),
                                timeoutPromise
                            ]) as string | null;
                            return result !== null ? result : defaultValue;
                        } catch (e) {
                            console.warn(`[Static] ⚠️ Timeout/Error obteniendo setting ${key}, usando default: ${defaultValue}`);
                            return defaultValue;
                        }
                    };

                    // Obtener configuración de visibilidad (cacheada para evitar queries en cada navegación)
                    const now = Date.now();
                    if (!_visibilityCache || (now - _visibilityCacheAt) > VISIBILITY_TTL) {
                        const [dbWa, dbIg, dbMs, dbCRM] = await Promise.all([
                            getSettingSafe('WHATSAPP_VISIBLE'),
                            getSettingSafe('INSTAGRAM_VISIBLE', 'false'),
                            getSettingSafe('MESSENGER_VISIBLE', 'false'),
                            getSettingSafe('CRM_VISIBLE', 'true')
                        ]);
                        _visibilityCache = { wa: dbWa, ig: dbIg, ms: dbMs, crm: dbCRM, sysConfig: '' };
                        _visibilityCacheAt = now;
                    }
                    const cache = _visibilityCache!;
                    const [dbWa, dbIg, dbMs, dbCRM] = [cache.wa, cache.ig, cache.ms, cache.crm];

                    // Si cualquiera de las plataformas está activa, mostrar backoffice
                    const isAnyPlatformActive = (dbWa !== 'false') || (dbIg === 'true') || (dbMs === 'true');
                    const showBackoffice = isAnyPlatformActive ? '' : 'hidden-item';
                    const showCRM = (dbCRM === 'false' || (!dbCRM && process.env.CRM_VISIBLE === 'false')) ? 'hidden-item' : '';
                    const _sysCfgRaw = (process.env.SYSTEM_CONFIG_VISIBLE ?? 'true').trim();
                    const systemConfigVisible = _sysCfgRaw !== 'false';
                    console.log('[Static] SYSTEM_CONFIG_VISIBLE raw:', JSON.stringify(_sysCfgRaw), '→ hidden:', !systemConfigVisible);
                    const showSystemConfig = systemConfigVisible ? '' : 'hidden-item';
                    const systemConfigVisibleJs = systemConfigVisible ? 'true' : 'false';

                    // Reemplazo universal de placeholders
                    htmlContent = htmlContent.replace(/{{BOT_NAME}}/g, botName);
                    htmlContent = htmlContent.replace(/{{ASSISTANT_NAME}}/g, botName);
                    htmlContent = htmlContent.replace(/{{SHOW_BACKOFFICE_STYLE}}/g, showBackoffice);
                    htmlContent = htmlContent.replace(/{{SHOW_CRM_STYLE}}/g, showCRM);
                    htmlContent = htmlContent.replace(/{{SHOW_SYSTEM_CONFIG_STYLE}}/g, showSystemConfig);
                    htmlContent = htmlContent.replace(/{{SYSTEM_CONFIG_VISIBLE_JS}}/g, systemConfigVisibleJs);
                    
                    res.setHeader('Content-Type', 'text/html');
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    console.log(`[Static] ✅ ${filename} procesado y enviado.`);
                    res.end(htmlContent);
                } else {
                    console.warn(`[Static] ❌ Archivo ${filename} no encontrado para la ruta ${route}`);
                    res.status(404).send('HTML no encontrado en el servidor');
                }
            } catch (err) {
                console.error(`Error sirviendo ${filename}:`, err);
                res.status(500).send('Error interno al servir HTML');
            }
        };
        
        // Registrar rutas con opcionalmente middlewares
        if (middlewares.length > 0) {
            app.get(route, ...middlewares, handler);
            if (route !== "/") app.get(route + '/', ...middlewares, handler);
        } else {
            app.get(route, handler);
            if (route !== "/") app.get(route + '/', handler);
        }
    };

    // Paginas standalone (no forman parte del SPA shell)
    serveHtmlPage("/login", "login.html");
    serveHtmlPage("/webreset", "webreset.html");

    // Rutas SPA: todas sirven shell.html; el router JS carga la view correspondiente
    serveHtmlPage("/backoffice", "shell.html");
    serveHtmlPage("/dashboard", "shell.html");
    serveHtmlPage("/conexion", "shell.html");
    serveHtmlPage("/webchat", "shell.html");
    serveHtmlPage("/system-config", "shell.html");
    serveHtmlPage("/crm", "shell.html");
    serveHtmlPage("/crm-tareas", "shell.html");
    serveHtmlPage("/documentacion", "shell.html");
    serveHtmlPage("/docs", "shell.html");
    serveHtmlPage("/meta", "shell.html");
    serveHtmlPage("/lista-negra", "shell.html");

    // Favicon directo (browsers lo piden en / automáticamente) — busca en src/assets primero, luego en assets/
    app.get("/favicon.ico", (_req: any, res: any) => {
        const candidates = [
            path.join(process.cwd(), "src", "assets", "favicon.ico"),
            path.join(process.cwd(), "assets", "favicon.ico"),
        ];
        const p = candidates.find(c => fs.existsSync(c));
        if (p) {
            res.setHeader("Content-Type", "image/x-icon");
            res.setHeader("Cache-Control", "public, max-age=86400");
            fs.createReadStream(p).pipe(res);
        } else {
            res.statusCode = 204; res.end();
        }
    });

    // Servir archivos estáticos
    app.use("/js", serve(path.join(process.cwd(), "src", "backoffice", "js")));
    app.use("/style", serve(path.join(process.cwd(), "src", "backoffice", "style")));
    app.use("/assets", serve(path.join(process.cwd(), "src", "assets")));
    app.use("/assets", serve(path.join(process.cwd(), "assets")));
    // Vendor packages instalados localmente
    app.use("/vendor/toast", serve(path.join(process.cwd(), "node_modules", "nextjs-toast-notify", "dist")));
    app.use("/vendor/fontawesome", serve(path.join(process.cwd(), "node_modules", "@fortawesome", "fontawesome-free")));
    app.use("/uploads", serve(path.join(process.cwd(), "uploads")));
    app.use("/temp", serve(path.join(process.cwd(), "tmp")));
    app.use("/app/temp", serve(path.join(process.cwd(), "tmp")));
    app.use("/tmp", serve(path.join(process.cwd(), "tmp")));
    app.use("/app/tmp", serve(path.join(process.cwd(), "tmp")));

    // QR genérico / Principal (Con fallback a memoria para evitar 404)
    app.get("/qr.png", async (req: any, res: any) => {
        try {
            const qrPath = path.join(process.cwd(), 'bot.qr.png');
            if (fs.existsSync(qrPath)) {
                res.setHeader('Content-Type', 'image/png');
                return fs.createReadStream(qrPath).pipe(res);
            }

            // Fallback: Si no hay archivo, usar el provider pasado por config
            if (provider && provider.qrCodeString) {
                console.log("[Static] QR physical file missing, generating from memory...");
                const QRCode = await import('qrcode');
                const imgBuffer = await QRCode.toBuffer(provider.qrCodeString);
                res.setHeader('Content-Type', 'image/png');
                return res.end(imgBuffer);
            }
            
            res.status(404).send('QR not found (no file, no memory)');
        } catch (e) {
            console.error("[Static] Error serving QR:", e);
            res.status(500).send('Error serving QR');
        }
    });

    // QR específico para grupos / motor secundario
    app.get("/bot.groups.qr.png", async (req: any, res: any) => {
        const qrPath = path.join(process.cwd(), 'bot.groups.qr.png');
        if (fs.existsSync(qrPath)) {
            res.setHeader('Content-Type', 'image/png');
            return fs.createReadStream(qrPath).pipe(res);
        }
        
        // Fallback para grupos usando el groupProvider pasado por config
        if (groupProvider && groupProvider.qrCodeString) {
             console.log("[Static] Group QR physical file missing, generating from memory...");
             const QRCode = await import('qrcode');
             const imgBuffer = await QRCode.toBuffer(groupProvider.qrCodeString);
             res.setHeader('Content-Type', 'image/png');
             return res.end(imgBuffer);
        }

        res.status(404).send('QR Groups not found');
    });

};
