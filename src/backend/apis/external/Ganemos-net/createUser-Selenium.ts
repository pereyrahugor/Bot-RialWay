import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from './loginAdmin-Selenium.js';
import * as fs from 'fs';
import * as path from 'path';
import { ProxyManager } from '../../../utils/proxyManager.js';

/**
 * Genera un nombre de usuario basado en un nombre base + 1 letra aleatoria + 4 números aleatorios.
 */
function generateUsername(baseName: string): string {
    const cleanBase = baseName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
    const randomNumbers = Math.floor(1000 + Math.random() * 9000); // 4 dígitos
    return `${cleanBase}${randomLetter}${randomNumbers}`;
}

/**
 * Flujo para crear un usuario jugador en Ganemosnet utilizando Selenium.
 * 
 * @param baseName Nombre base del usuario.
 * @param recharge Boolean que indica si se realizará una recarga posterior.
 */
export async function createUserSelenium(
    baseName: string,
    recharge: boolean
): Promise<{ username: string; password?: string; driver?: WebDriver } | null> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`[Ganemos-net] Intento ${attempt}/${maxAttempts} para crear usuario (baseName: ${baseName})...`);

        const options = new chrome.Options();
        
        // Configuración Anti-Detección Bot (Stealth Mode) y Bloqueo de Tráfico en Segundo Plano
        options.addArguments('--disable-blink-features=AutomationControlled');
        options.excludeSwitches('enable-automation');
        options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        options.addArguments('--window-size=1920,1080');
        options.addArguments('--start-maximized');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu');

        // Bloquear conexiones secundarias e innecesarias de Chrome (GCM puerto 5228, Sync, métricas)
        options.addArguments('--disable-background-networking');
        options.addArguments('--disable-default-apps');
        options.addArguments('--disable-extensions');
        options.addArguments('--disable-sync');
        options.addArguments('--disable-translate');
        options.addArguments('--metrics-recording-only');
        options.addArguments('--no-first-run');
        options.addArguments('--safebrowsing-disable-auto-update');

        // Optimización de ancho de banda: Bloquear descarga de imágenes por preferencias de Chrome
        options.setUserPreferences({
            'profile.managed_default_content_settings.images': 2,
            'profile.managed_default_content_settings.media_stream': 2,
            'profile.managed_default_content_settings.popups': 2,
            'profile.managed_default_content_settings.plugins': 2
        });

        if (process.env.DISABLE_HEADLESS !== 'true') {
            options.addArguments('--headless=new');
        }

        const proxySession = await ProxyManager.getProxySession('ganemos-net');
        if (proxySession) {
            console.log(`🔌 [Ganemos-net] Aplicando proxy a Chrome (Intento ${attempt}): ${proxySession.proxyUrl}`);
            options.addArguments(`--proxy-server=${proxySession.proxyUrl}`);
        }

        console.log("🔌 Iniciando instancia de Chrome...");
        const driver: WebDriver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        // Ahorro de 85% de datos de Proxy: Bloquear recursos pesados (imágenes, fuentes, scripts de rastreo) vía CDP
        try {
            await (driver as any).sendAndGetDevToolsCommand('Network.enable');
            await (driver as any).sendAndGetDevToolsCommand('Network.setBlockedURLs', {
                urls: [
                    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.webp', '*.ico',
                    '*.woff', '*.woff2', '*.ttf', '*.eot',
                    '*clarity.ms*', '*googletagmanager.com*', '*google-analytics.com*', '*facebook.net*'
                ]
            });
            console.log("⚡ [Ganemos-net] Optimización de red activada: Imágenes, fuentes y analíticas bloqueadas en el proxy.");
        } catch (cdpErr) {
            /* CDP no soportado en este entorno */
        }

        if (proxySession) {
            (driver as any)._proxyCleanup = proxySession.cleanup;
        }

        try {
            const authenticator = new LoginAdminSelenium(driver);
            const adminUser = process.env.GANAMOSNET_USER || '';
            const adminPass = process.env.GANAMOSNET_PASS || '';

            const loginSuccess = await authenticator.login(adminUser, adminPass);
            if (!loginSuccess) {
                console.warn(`⚠️ [Ganemos-net] Login no exitoso en intento ${attempt}. Reintentando con nueva IP...`);
                await driver.quit();
                if ((driver as any)._proxyCleanup) await (driver as any)._proxyCleanup();
                if (attempt < maxAttempts) {
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
                console.error("❌ [Ganemos-net] No se pudo loguear al administrador tras múltiples intentos. Abortando.");
                return null;
            }

        // 2. Asegurarse de estar en la URL: https://agents.ganamosnet.org/users/all
        const usersListUrl = "https://agents.ganamosnet.org/users/all";
        const currentUrl = await driver.getCurrentUrl();
        if (currentUrl !== usersListUrl) {
            console.log(`[Ganemos-net] Navegando a ${usersListUrl}...`);
            await driver.get(usersListUrl);
            await driver.wait(until.urlIs(usersListUrl), 10000);
        }

        // 3. Buscar el botón de crear y hacer click
        // Path: /html/body/div[3]/div/div[2]/main/div[2]/div[2]/a[2]
        const createButtonXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div[2]/a[2]";
        console.log("[Ganemos-net] Buscando y haciendo click en el botón de creación...");
        const createBtn = await driver.wait(
            until.elementLocated(By.xpath(createButtonXPath)),
            10000
        );
        // Hacemos click usando Javascript para evitar que banners o notificaciones de carga intercepten el click visual
        await driver.executeScript("arguments[0].click();", createBtn);

        // 4. Esperar a estar en la URL: https://agents.ganamosnet.org/user/create-player
        const createPlayerUrl = "https://agents.ganamosnet.org/user/create-player";
        await driver.wait(until.urlIs(createPlayerUrl), 10000);
        console.log("[Ganemos-net] En la página de creación de jugador.");

        // 5. Generar usuario aleatorio
        const usernameGenerated = generateUsername(baseName);
        const defaultPassword = "hola123";
        console.log(`[Ganemos-net] Usuario generado: ${usernameGenerated}`);

        // 6. Cargar datos en los inputs correspondientes
        const userInputXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/form/div[2]/div[1]/div/input";
        const passwordInputXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/form/div[2]/div[3]/div/div/input";
        const confirmPasswordInputXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/form/div[2]/div[5]/div/div/input";
        const submitBtnXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/form/div[3]/button[2]";

        const userInput = await driver.findElement(By.xpath(userInputXPath));
        await userInput.sendKeys(usernameGenerated);

        const passwordInput = await driver.findElement(By.xpath(passwordInputXPath));
        await passwordInput.sendKeys(defaultPassword);

        const confirmPasswordInput = await driver.findElement(By.xpath(confirmPasswordInputXPath));
        await confirmPasswordInput.sendKeys(defaultPassword);

        // 7. Hacer click en el botón de confirmación inicial
        const submitBtn = await driver.findElement(By.xpath(submitBtnXPath));
        await submitBtn.click();

        // 7.1 Hacer click en el botón "Crear Jugador" de la ventana emergente de confirmación
        const confirmBtnXPath = "/html/body/div[2]/div/div/div/div/div[2]/button[1]";
        console.log("[Ganemos-net] Esperando y haciendo click en el botón del modal de confirmación...");
        const confirmBtn = await driver.wait(
            until.elementLocated(By.xpath(confirmBtnXPath)),
            5000
        );
        await confirmBtn.click();

        // 8. Esperar a que se procese la creación
        console.log("[Ganemos-net] Enviando formulario de creación final...");
        await driver.sleep(3000); // Esperar procesamiento del formulario

        const currentUrlAfterSubmit = await driver.getCurrentUrl();

        // Buscar cartel explícito de error real (evitando falsos positivos con modales neutros o de éxito)
        const errorElements = await driver.findElements(By.xpath(
            "//*[contains(@class, 'swal2-icon-error') or contains(@class, 'alert-danger') or contains(@class, 'toast-error')]" +
            "//*[contains(text(), 'ya existe') or contains(text(), 'inválido') or contains(text(), 'incorrecto')]"
        ));

        let hasRealError = false;
        let errorMessage = '';
        for (const el of errorElements) {
            try {
                if (await el.isDisplayed()) {
                    const text = await el.getText();
                    if (text && text.trim() !== '' && !text.includes('None')) {
                        hasRealError = true;
                        errorMessage = text;
                        break;
                    }
                }
            } catch (e) {
                // Ignorar elementos obsoletos
            }
        }

        if (hasRealError && !currentUrlAfterSubmit.includes('/users/all')) {
            console.error(`❌ [Ganemos-net] Error al crear jugador: "${errorMessage}"`);
            await driver.quit();
            if ((driver as any)._proxyCleanup) await (driver as any)._proxyCleanup();
            return null;
        }

        console.log(`🎉 [Ganemos-net] Jugador creado con éxito: ${usernameGenerated}`);

        // 9. Lógica condicional del boolean recharge
        if (recharge) {
            console.log("[Ganemos-net] recharge es true. Dejando el navegador abierto para la posterior recarga.");
            return {
                username: usernameGenerated,
                password: defaultPassword,
                driver
            };
        } else {
            console.log("[Ganemos-net] recharge es false. Cerrando navegador...");
            await driver.quit();
            if ((driver as any)._proxyCleanup) await (driver as any)._proxyCleanup();
            return {
                username: usernameGenerated,
                password: defaultPassword
            };
        }

        } catch (error: any) {
            console.error(`❌ Error en el intento ${attempt} de creación de usuario de Selenium:`, error.message || error);
            if (driver) {
                try {
                    console.log("📸 Tomando captura de pantalla por fallo de creación...");
                    const screenshot = await driver.takeScreenshot();
                    const screenshotPath = path.join(process.cwd(), 'create_user_failure.png');
                    fs.writeFileSync(screenshotPath, screenshot, 'base64');
                    console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
                } catch (screenErr: any) {
                    console.error("⚠️ No se pudo tomar la captura de pantalla:", screenErr.message);
                }
                try { 
                    await driver.quit(); 
                    if ((driver as any)._proxyCleanup) await (driver as any)._proxyCleanup();
                } catch (e) { /* ignore */ }
            }
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }
        }
    }
    return null;
}
