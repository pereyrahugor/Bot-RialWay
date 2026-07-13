import { Builder, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from '../apis/external/Cas-EPC/loginAdmin-Selenium.js';

async function runLoginTestCasepc() {
    console.log("🚀 [Cas-EPC] Iniciando prueba local de login con Selenium (Modo Visible)...");

    const options = new chrome.Options();
    // NOTA: Para que el navegador sea visible, NO añadimos '--headless=new'
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');

    console.log("🔌 Iniciando instancia de Chrome...");
    const driver: WebDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        const authenticator = new LoginAdminSelenium(driver);

        // Credenciales de prueba configuradas
        const adminUser = process.env.CASEPC_USER || "testercrm2";
        const adminPass = process.env.CASEPC_PASS || "asghs56VGS$AS";

        console.log(`[Cas-EPC] Usando usuario de prueba: "${adminUser}"...`);
        const result = await authenticator.login(adminUser, adminPass);
        
        if (result) {
            console.log("🎉 TEST EXITOSO: El login fue completado y validado correctamente en Cas-EPC (admin.epcbet.net).");
        } else {
            console.log("❌ TEST FALLIDO: El login no se pudo completar o el elemento de éxito post-login no se encontró.");
            console.log("📸 Tomando captura de pantalla por fallo...");
            const screenshot = await driver.takeScreenshot();
            const fs = await import('fs');
            const path = await import('path');
            const screenshotPath = path.join(process.cwd(), 'login_failure_casepc.png');
            fs.writeFileSync(screenshotPath, screenshot, 'base64');
            console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
        }
    } catch (e: any) {
        console.error("💥 Error durante la ejecución del test:", e.message || e);
    } finally {
        // Mantenemos el navegador abierto 10 segundos para observar la pantalla final
        console.log("⏱️ Esperando 10 segundos antes de cerrar el navegador...");
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        await driver.quit();
        console.log("🔒 Navegador cerrado.");
    }
}

runLoginTestCasepc();
