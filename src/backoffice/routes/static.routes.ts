import path from 'path';
import fs from 'fs';
import serve from 'serve-static';
import { backofficeAuth } from '../middleware/auth'; // auth vive en backoffice/middleware

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

                    // Obtener configuración de visibilidad desde DB en paralelo con safety
                    const [dbWa, dbIg, dbMs, dbCRM] = await Promise.all([
                        getSettingSafe('WHATSAPP_VISIBLE'),
                        getSettingSafe('INSTAGRAM_VISIBLE', 'false'),
                        getSettingSafe('MESSENGER_VISIBLE', 'false'),
                        getSettingSafe('CRM_VISIBLE', 'true')
                    ]);
                    
                    // Si cualquiera de las plataformas está activa, mostrar backoffice
                    const isAnyPlatformActive = (dbWa !== 'false') || (dbIg === 'true') || (dbMs === 'true');
                    const showBackoffice = isAnyPlatformActive ? '' : 'hidden-item';
                    const showCRM = (dbCRM === 'false' || (!dbCRM && process.env.CRM_VISIBLE === 'false')) ? 'hidden-item' : '';

                    // Reemplazo universal de placeholders
                    htmlContent = htmlContent.replace(/{{BOT_NAME}}/g, botName);
                    htmlContent = htmlContent.replace(/{{ASSISTANT_NAME}}/g, botName);
                    htmlContent = htmlContent.replace(/{{SHOW_BACKOFFICE_STYLE}}/g, showBackoffice);
                    htmlContent = htmlContent.replace(/{{SHOW_CRM_STYLE}}/g, showCRM);
                    
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

    // Registrar páginas HTML
    serveHtmlPage("/dashboard", "dashboard.html");
    serveHtmlPage("/conexion", "conexion.html");
    serveHtmlPage("/webchat", "webchat.html");
    serveHtmlPage("/webreset", "webreset.html");
    serveHtmlPage("/system-config", "system-config.html");
    serveHtmlPage("/login", "login.html");
    serveHtmlPage("/backoffice", "backoffice.html");
    serveHtmlPage("/backoffice-preview", "backoffice-preview.html");
    serveHtmlPage("/crm", "crm.html");
    serveHtmlPage("/crm-tareas", "crm-tareas.html");
    serveHtmlPage("/documentacion", "docs.html");
    serveHtmlPage("/docs", "docs.html");

    // Servir archivos estáticos
    app.use("/js", serve(path.join(process.cwd(), "src", "backoffice", "js")));
    app.use("/style", serve(path.join(process.cwd(), "src", "backoffice", "style")));
    app.use("/assets", serve(path.join(process.cwd(), "src", "assets")));
    app.use("/uploads", serve(path.join(process.cwd(), "uploads")));

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
