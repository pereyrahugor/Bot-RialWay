
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const WABA_ID = "1429916385161257";
const TOKEN = "EAAVOfFTMb0YBRMHdE2rUGiz978rZBgZBScSmRZAk8xg6Etl7eoh40qB9eG0gZCDUJ98hlnyWPc5N9ywqAU8WG4CZAJ3oZAqVDNHeucs7Q7nR8gtXb8yT4nsGxDki8goEC39Jnly9rZAQaSYDYqSQ8b0wjFbeksgZB1oZA3eS6BKalKubgOXYeeZAV9cOB7ryFyPRS0gAZDZD";

async function updateToken() {
    console.log("💾 Actualizando base de datos con el nuevo TOKEN ADMINISTRATIVO...");
    
    const { error } = await supabase
        .from('meta_onboarding')
        .update({
            access_token: TOKEN,
            updated_at: new Date().toISOString()
        })
        .eq('waba_id', WABA_ID);

    if (error) {
        console.error("❌ Error actualizando token:", error.message);
    } else {
        console.log("✅ Base de datos actualizada con éxito.");
    }
}

updateToken();
