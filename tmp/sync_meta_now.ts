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
const META_TOKEN = "EAAVOfFTMb0YBROyHxHSCYkDC49ZBKdLZCs7G5ylW3g7UOuMCWw6o6ZB7WU7pgauHSikQd5UrDNmvLs0QPtyehlUhCYWCLDevAFqJaBPgRn6PZAwkHP6Kp15obyp93GzAcCHT2zheVKC6E4DWsjQihQea2Loj28qNxyegjZAR5mMsKkmu8XRq0cF9k7OBCZC1locwZDZD";

async function runSync() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error("❌ Faltan credenciales de Supabase en .env");
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        console.log('📡 [Sync] Iniciando descubrimiento con Meta...');

        // 1. Descubrir que tenemos
        const debugRes = await axios.get(`https://graph.facebook.com/v22.0/me?fields=id,name,accounts,whatsapp_business_accounts`, {
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        console.log('🔍 [DEBUG] Respuesta "me":', JSON.stringify(debugRes.data, null, 2));

        const wabaData = debugRes.data.whatsapp_business_accounts?.data?.[0];
        if (!wabaData) {
            console.error('❌ No se encontraron WABAs asociados a este token.');
            return;
        }

        const wabaId = wabaData.id;
        console.log(`✅ WABA ID: ${wabaId}`);

        // 2. Descubrir Phone ID
        const phoneResponse = await axios.get(`https://graph.facebook.com/v22.0/${wabaId}/phone_numbers`, {
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });

        const phoneData = phoneResponse.data.data?.[0];
        if (!phoneData) {
            console.error(`❌ No se encontraron números en la WABA ${wabaId}`);
            return;
        }

        const phoneId = phoneData.id;
        console.log(`✅ Phone ID: ${phoneId} (${phoneData.verified_name})`);

        // 3. Guardar en Supabase
        const { error } = await supabase
            .from('meta_onboarding')
            .upsert({
                id: 1, // Usamos ID fijo para la config global o manejado por lógica del bot
                waba_id: wabaId,
                phone_number_id: phoneId,
                access_token: META_TOKEN,
                status: 'active',
                updated_at: new Date().toISOString(),
                metadata: { ...phoneData, syncedBy: 'AI-Assistant-Manual-Sync' }
            }, { onConflict: 'id' });

        if (error) throw error;

        console.log('🚀 [Sync] Configuración guardada exitosamente en Supabase.');
        console.log('El bot usará Meta automáticamente en el próximo reinicio.');

    } catch (e: any) {
        console.error('❌ Error durante la sincronización:', e.response?.data || e.message);
    }
}

runSync();
