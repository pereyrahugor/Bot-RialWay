
const axios = require('axios');

const TOKEN = "EAAVOfFTMb0YBRMHdE2rUGiz978rZBgZBScSmRZAk8xg6Etl7eoh40qB9eG0gZCDUJ98hlnyWPc5N9ywqAU8WG4CZAJ3oZAqVDNHeucs7Q7nR8gtXb8yT4nsGxDki8goEC39Jnly9rZAQaSYDYqSQ8b0wjFbeksgZB1oZA3eS6BKalKubgOXYeeZAV9cOB7ryFyPRS0gAZDZD";

async function checkPermissions() {
    console.log("🔍 Analizando permisos del token...");

    try {
        const res = await axios.get('https://graph.facebook.com/v20.0/me/permissions', {
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        });

        const permissions = res.data.data;
        console.log("\n✅ Permisos ACTIVOS:");
        permissions.forEach(p => {
            if (p.status === 'granted') {
                console.log(`- ${p.permission}`);
            }
        });

        console.log("\n❌ Permisos FALTANTES o RECHAZADOS:");
        permissions.forEach(p => {
            if (p.status !== 'granted') {
                console.log(`- ${p.permission} (${p.status})`);
            }
        });

        // Verificando si es Admin del BM
        console.log("\n🛡️ Verificando rol en el Business Manager...");
        const resMe = await axios.get('https://graph.facebook.com/v20.0/me?fields=id,name', {
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        });
        console.log(`- Usuario: ${resMe.data.name} (ID: ${resMe.data.id})`);

    } catch (e) {
        console.error("❌ Error analizando el token:", e.response?.data || e.message);
    }
}

checkPermissions();
