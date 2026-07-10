import { Builder, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from '../apis/external/Ganemos-net/loginAdmin-Selenium.js';

async function runLoginTest() {
    console.log("🚀 Iniciando prueba local de login con Selenium...");

    const options = new chrome.Options();
    // TIP: Dejamos el modo headless DESACTIVADO por defecto para que puedas ver la ventana del navegador abrirse,
    // escribir las credenciales y hacer clic. Esto facilita mucho la depuración visual.
    // Para entornos de servidor (producción/headless), descomenta la siguiente línea:
    // options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');

    console.log("🔌 Iniciando instancia de Chrome...");
    const driver: WebDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        const authenticator = new LoginAdminSelenium(driver);

        // Reemplaza estas credenciales de prueba con las de tu panel si es necesario
        const adminUser = "turbobt";
        const adminPass = "coco1234";

        const result = await authenticator.login(adminUser, adminPass);
        
        if (result) {
            console.log("🎉 TEST EXITOSO: El login fue completado y validado correctamente.");
        } else {
            console.log("❌ TEST FALLIDO: El login no se pudo completar o el elemento de éxito post-login no se encontró.");
            console.log("📸 Tomando captura de pantalla por fallo...");
            const screenshot = await driver.takeScreenshot();
            const fs = await import('fs');
            const path = await import('path');
            const screenshotPath = path.join(process.cwd(), 'login_failure.png');
            fs.writeFileSync(screenshotPath, screenshot, 'base64');
            console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
        }
    } catch (e: any) {
        console.error("💥 Error durante la ejecución del test:", e.message || e);
    } finally {
        // Mantenemos el navegador abierto 5 segundos para que puedas observar la pantalla final
        console.log("⏱️ Esperando 5 segundos antes de cerrar el navegador...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await driver.quit();
        console.log("🔒 Navegador cerrado.");
    }
}

runLoginTest();
