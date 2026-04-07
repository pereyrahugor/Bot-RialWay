import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID;

async function clearMeta() {
    if (!SUPABASE_URL || !SUPABASE_KEY || !PROJECT_ID) {
        console.error("❌ Faltan credenciales o Project ID en .env");
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        console.log(`🧹 [Clear] Eliminando credenciales de Meta para el proyecto: ${PROJECT_ID}...`);

        const { error, count } = await supabase
            .from('meta_onboarding')
            .delete()
            .eq('project_id', PROJECT_ID);

        if (error) throw error;

        console.log('✅ [Clear] ¡Limpieza completada con éxito!');
        console.log('El bot ahora está listo para recibir una nueva conexión desde cero.');

    } catch (e: any) {
        console.error('❌ Error al limpiar la base de datos:', e.message);
    }
}

clearMeta();
