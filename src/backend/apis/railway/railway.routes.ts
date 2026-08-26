import { backofficeAuth, systemConfigAuth } from "../../backoffice/middleware/auth";
import { deleteSessionFromDb } from "../../providers/sessionSync";

/**
 * Registra las rutas de Railway en la instancia de Polka.
 */
export const registerRailwayRoutes = (app: any, { RailwayApi }: any) => {
    
    app.post("/api/restart-bot", backofficeAuth, async (req: any, res: any) => {
        console.log('POST /api/restart-bot recibido - Solicitando reinicio del contenedor');
        try {
            // 1. Intentar solicitar reinicio formal en Railway vía GraphQL API si está disponible
            let railwayResult: any = null;
            try {
                railwayResult = await RailwayApi.restartActiveDeployment();
            } catch (rErr: any) {
                console.warn('[RailwayRoutes] No se pudo reiniciar vía Railway GraphQL API (se reiniciará por proceso):', rErr?.message || rErr);
            }

            // 2. Responder exitosamente al cliente
            res.json({
                success: true,
                message: "Reinicio del contenedor solicitado correctamente.",
                railwayApiRestart: railwayResult?.success || false
            });

            // 3. Programar salida limpia del proceso para que el supervisor de Docker/Railway lo reinicie de inmediato
            setTimeout(() => {
                console.log('🔄 [SYSTEM] Reiniciando proceso/contenedor a solicitud del usuario...');
                process.exit(0);
            }, 1000);
        } catch (err: any) {
            console.error('Error en /api/restart-bot:', err);
            try {
                res.json({ success: true, message: "Reinicio forzado del proceso." });
                setTimeout(() => process.exit(0), 1000);
            } catch (_) {
                res.status(500).json({ success: false, error: err.message });
            }
        }
    });

    app.get("/api/variables", systemConfigAuth, async (req: any, res: any) => {
        try {
            const variables = await RailwayApi.getVariables();
            if (variables) {
                res.json({ success: true, variables });
            } else {
                res.status(500).json({ success: false, error: "No se pudieron obtener las variables de Railway" });
            }
        } catch (err: any) {
            console.error('Error en GET /api/variables:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post("/api/update-variables", systemConfigAuth, async (req: any, res: any) => {
        try {
            const { variables } = req.body;
            if (!variables || typeof variables !== 'object') {
                return res.status(400).json({ success: false, error: "Variables no proporcionadas o formato inválido" });
            }

            console.log("[API] Actualizando variables en Railway...");
            const updateResult = await RailwayApi.updateVariables(variables);

            if (!updateResult.success) {
                return res.status(500).json({ success: false, error: updateResult.error });
            }

            console.log("[API] Variables actualizadas. Solicitando reinicio...");
            const restartResult = await RailwayApi.restartActiveDeployment();

            if (restartResult.success) {
                res.json({ success: true, message: "Variables actualizadas y reinicio solicitado." });
            } else {
                res.json({ success: true, message: "Variables actualizadas, pero falló el reinicio automático.", warning: restartResult.error });
            }
        } catch (err: any) {
            console.error('Error en POST /api/update-variables:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });
};
