import fs from 'fs';
import path from 'path';

/**
 * Middleware para manejar la ruta raíz /
 * Redirige a /webchat si hay sesión activa, sino muestra página de inicio
 */
export function handleRootRoute(req: any, res: any) {
    // Verificar si existe el archivo de credenciales
    const credsPath = path.join('bot_sessions', 'creds.json');
    
    if (fs.existsSync(credsPath)) {
        // Si hay sesión, redirigir a webchat
        console.log('[RootRoute] Sesión activa detectada, redirigiendo a /webchat');
        res.writeHead(302, { 'Location': '/webchat' });
        res.end();
    } else {
        // Si no hay sesión, mostrar mensaje simple
        console.log('[RootRoute] Sin sesión, mostrando página de inicio');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Bot WhatsApp</title>
                <meta charset="utf-8">
                <meta http-equiv="refresh" content="5">
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; background: #f0f0f0; }
                    .container { background: white; padding: 40px; border-radius: 10px; display: inline-block; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    h1 { color: #128C7E; }
                    .loader { border: 5px solid #f3f3f3; border-top: 5px solid #128C7E; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 20px auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 Bot de WhatsApp</h1>
                    <div class="loader"></div>
                    <p>El bot se está iniciando...</p>
                    <p>Revisa los logs de Railway para ver el código QR</p>
                    <p><small>Esta página se actualiza automáticamente cada 5 segundos</small></p>
                    <p><a href="/webchat">Ir al Webchat</a> | <a href="/webreset">Configuración</a></p>
                </div>
            </body>
            </html>
        `);
    }
}
