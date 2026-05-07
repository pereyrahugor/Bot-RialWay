import { backofficeAuth, systemConfigAuth } from "../middleware/auth";
import { deleteSessionFromDb } from "../db/sessionSync";

/**
 * Registra las rutas de Railway en la instancia de Polka.
 */
export const registerRailwayRoutes = (app: any, { RailwayApi }: any) => {
    
    app.post("/api/restart-bot", backofficeAuth, async (req: any, res: any) => {
        console.log('POST /api/restart-bot recibido - Solicitando limpieza de sesión y reinicio');
        try {
            // 1. Calcular nombres de sesión
            const rawSessionName = process.env.BOT_NAME || process.env.ASSISTANT_NAME || 'bot';
            const sessionId = rawSessionName.replace(/[^a-zA-Z0-9_-]/g, '_');

            // 2. Eliminar sesiones de la base de datos (Supabase)
            console.log(`[RailwayRoutes] 🗑️ Eliminando sesiones '${sessionId}' y '${sessionId}_groups' antes del reinicio...`);
            await deleteSessionFromDb(sessionId);
            await deleteSessionFromDb(`${sessionId}_groups`);

            // 3. Solicitar reinicio en Railway
            const result = await RailwayApi.restartActiveDeployment();
            if (result.success) {
                res.json({ success: true, message: "Sesión eliminada y reinicio solicitado correctamente." });
            } else {
                res.status(500).json({ success: false, error: result.error || "Error al reiniciar en Railway" });
            }
        } catch (err: any) {
            console.error('Error en /api/restart-bot:', err);
            res.status(500).json({ success: false, error: err.message });
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
