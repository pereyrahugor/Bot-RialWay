
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const WABA_ID = "1429916385161257";
const TOKEN = "EAAVOfFTMb0YBRFXZAYZAiG2abTZBP4hRqylYAZAl9MR54cyZBS8LY1k1YwnsZAeglk2xCrwsRrPvF1SZCZBXslRgNZCeSpm4ZCXtPebtoIv8nu8xhPTUp7X1JueF8dhvib4i9i8JApcnWBWQLOaSgk9BaMWxo8K7Mmli6Lsfxj5dcZAuXXV0C9WwMvBb8o1VpZAUCoGuxwZDZD";
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "79cbfba7-d278-4298-84d3-a29ad021b579";

async function saveToken() {
    console.log(`💾 Guardando token en meta_onboarding para proyecto: ${PROJECT_ID}...`);
    
    const { data, error } = await supabase
        .from('meta_onboarding')
        .upsert({
            project_id: PROJECT_ID,
            waba_id: WABA_ID,
            access_token: TOKEN,
            status: 'active',
            updated_at: new Date().toISOString()
        }, { onConflict: 'project_id' });

    if (error) {
        console.error("❌ Error guardando token:", error.message);
    } else {
        console.log("✅ Token guardado correctamente en la base de datos.");
    }
}

saveToken();
