import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from './loginAdmin-Selenium.js';
import * as fs from 'fs';
import * as path from 'path';

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
    console.log(`[Ganemos-net] Iniciando creación de usuario para baseName: ${baseName} | recharge: ${recharge}`);

    const options = new chrome.Options();
    // Headless desactivado por defecto para facilitar depuración visual.
    // options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');

    console.log("🔌 Iniciando instancia de Chrome...");
    const driver: WebDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        // 1. Iniciar sesión usando LoginAdminSelenium
        const authenticator = new LoginAdminSelenium(driver);
        const adminUser = process.env.GANEMOS_ADMIN_USER || 'turbobt';
        const adminPass = process.env.GANEMOS_ADMIN_PASS || 'coco1234';

        const loginSuccess = await authenticator.login(adminUser, adminPass);
        if (!loginSuccess) {
            console.error("❌ [Ganemos-net] No se pudo loguear al administrador. Abortando.");
            await driver.quit();
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
        await createBtn.click();

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

        // 8. Esperar a que se procese la creación (generalmente redirige de vuelta a /users/all)
        console.log("[Ganemos-net] Enviando formulario de creación final...");
        
        // Esperamos a ver si cambia la URL o aparece un cartel de error
        const result: any = await driver.wait(async (d) => {
            const currentUrl = await d.getCurrentUrl();
            if (currentUrl.includes('/users/all')) {
                return { success: true };
            }
            
            // Buscar cartel de error en pantalla
            const errorElements = await d.findElements(By.xpath("//*[contains(text(), 'Error') or contains(text(), 'error') or contains(text(), 'ya existe') or contains(text(), 'inválido')]"));
            if (errorElements.length > 0) {
                for (const el of errorElements) {
                    try {
                        if (await el.isDisplayed()) {
                            const text = await el.getText();
                            if (text && text.trim() !== '') {
                                return { success: false, error: text };
                            }
                        }
                    } catch (e) {
                        // Ignorar si el elemento ya no está en el DOM o está obsoleto
                    }
                }
            }
            return false;
        }, 15000);

        if (result && !result.success) {
            console.error(`❌ [Ganemos-net] Error al crear jugador: "${result.error}"`);
            await driver.quit();
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
            return {
                username: usernameGenerated,
                password: defaultPassword
            };
        }

    } catch (error: any) {
        console.error("❌ Error en el proceso de creación de usuario de Selenium:", error.message || error);
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
            try { await driver.quit(); } catch (e) {}
        }
        return null;
    }
}
