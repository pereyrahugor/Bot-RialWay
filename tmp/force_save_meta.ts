import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// DATOS PROPORCIONADOS POR EL USUARIO
const META_TOKEN = "EAAVOfFTMb0YBROyHxHSCYkDC49ZBKdLZCs7G5ylW3g7UOuMCWw6o6ZB7WU7pgauHSikQd5UrDNmvLs0QPtyehlUhCYWCLDevAFqJaBPgRn6PZAwkHP6Kp15obyp93GzAcCHT2zheVKC6E4DWsjQihQea2Loj28qNxyegjZAR5mMsKkmu8XRq0cF9k7OBCZC1locwZDZD";
const PHONE_ID = "1047663671759756";
const WABA_ID = "2940922966117178";

async function forceSave() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error("❌ Faltan credenciales de Supabase en .env");
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        console.log('📡 [ForceSave] Guardando configuración de Meta en Supabase...');

        const { error } = await supabase
            .from('meta_onboarding')
            .upsert({
                project_id: process.env.RAILWAY_PROJECT_ID,
                waba_id: WABA_ID,
                phone_number_id: PHONE_ID,
                access_token: META_TOKEN,
                status: 'active',
                updated_at: new Date().toISOString(),
                onboarding_data: { syncedBy: 'AI-Assistant-Manual-Force-Save' }
            }, { onConflict: 'project_id' });

        if (error) throw error;

        console.log('✅ [ForceSave] ¡Configuración guardada exitosamente!');
        console.log('IDs guardados:', { PHONE_ID, WABA_ID });
        console.log('El mensaje "Falta: Token" debería desaparecer tras el reinicio.');

    } catch (e: any) {
        console.error('❌ Error al guardar en base de datos:', e.message);
    }
}

forceSave();
