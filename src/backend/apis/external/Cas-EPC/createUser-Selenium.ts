import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from './loginAdmin-Selenium.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Genera un nombre de usuario basado en un nombre base + 4 números aleatorios.
 */
function generateUsername(baseName: string): string {
    const cleanBase = baseName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const randomNumbers = Math.floor(1000 + Math.random() * 9000); // 4 dígitos
    return `${cleanBase}${randomNumbers}`;
}

/**
 * Flujo para crear un usuario jugador en Cas-EPC utilizando Selenium.
 * 
 * @param baseName Nombre base del usuario.
 * @param recharge Boolean que indica si se realizará una recarga posterior.
 */
export async function createUserSelenium(
    baseName: string,
    recharge: boolean
): Promise<{ username: string; password?: string; driver?: WebDriver } | null> {
    console.log(`[Cas-EPC] Iniciando creación de usuario para baseName: ${baseName} | recharge: ${recharge}`);

    const options = new chrome.Options();
    if (process.env.SELENIUM_HEADLESS !== 'false') {
        options.addArguments('--headless=new');
    }
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');
    options.addArguments('--window-size=1920,1080');

    console.log("🔌 Iniciando instancia de Chrome...");
    const driver: WebDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        // 1. Iniciar sesión usando LoginAdminSelenium
        const authenticator = new LoginAdminSelenium(driver);
        const adminUser = process.env.CASEPC_USER;
        const adminPass = process.env.CASEPC_PASS;

        const loginSuccess = await authenticator.login(adminUser, adminPass);
        if (!loginSuccess) {
            console.error("❌ [Cas-EPC] No se pudo loguear al administrador. Abortando.");
            await driver.quit();
            return null;
        }

        // 2. Asegurarse de estar en la URL: https://admin.epcbet.net/index.php
        const usersListUrl = "https://admin.epcbet.net/index.php";
        const currentUrl = await driver.getCurrentUrl();
        if (!currentUrl.includes('/index.php')) {
            console.log(`[Cas-EPC] Navegando a ${usersListUrl}...`);
            await driver.get(usersListUrl);
            await driver.wait(until.urlContains('/index.php'), 10000);
        }

        // Detectar y cambiar contexto al iframe si está presente en la página
        const iframes = await driver.findElements(By.tagName("iframe"));
        console.log(`[Cas-EPC] Cantidad de iframes en la página: ${iframes.length}`);
        if (iframes.length > 0) {
            console.log("[Cas-EPC] Cambiando contexto al primer iframe (index 0)...");
            await driver.switchTo().frame(0);
        }

        // 3. Buscar el botón de crear y hacer click
        const createButtonXPath = "//a[contains(@class, 'btn-create-terminal')] | /html/body/div[6]/div[2]/div/div[2]/div[1]/div[2]/a[1]";
        console.log("[Cas-EPC] Buscando y haciendo click en el botón de creación...");
        const createBtn = await driver.wait(
            until.elementLocated(By.xpath(createButtonXPath)),
            10000
        );
        await driver.executeScript("arguments[0].click();", createBtn);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar a que la animación de apertura del modal se complete

        // 4. Esperar a que el formulario de creación aparezca
        const userInputXPath = "/html/body/div[8]/div/div/form/div[2]/div[1]/div[2]/input";
        console.log("[Cas-EPC] Esperando a que el formulario de creación sea visible...");
        const userInput = await driver.wait(
            until.elementLocated(By.xpath(userInputXPath)),
            10000
        );

        // 5. Generar usuario aleatorio
        const usernameGenerated = generateUsername(baseName);
        const defaultPassword = "suerte123";
        console.log(`[Cas-EPC] Usuario generado: ${usernameGenerated}`);

        // 6. Cargar datos en los inputs correspondientes
        const nickInputXPath = "/html/body/div[8]/div/div/form/div[2]/div[2]/div[2]/input";
        const passwordInputXPath = "/html/body/div[8]/div/div/form/div[2]/div[3]/div[2]/input";
        const zeroInputXPath = "/html/body/div[8]/div/div/form/div[2]/div[5]/div[2]/input";
        const submitBtnXPath = "//form//button[contains(text(), 'Crear')] | //button[text()='Crear'] | //form//button[@type='submit']";

        // Cargar Nombre de Usuario (div 1)
        await userInput.sendKeys(usernameGenerated);

        // Cargar Nickname (div 2)
        const nickInput = await driver.findElement(By.xpath(nickInputXPath));
        await nickInput.sendKeys(usernameGenerated);

        // Cargar Contraseña (div 3 o fallback)
        let passwordInput;
        try {
            passwordInput = await driver.findElement(By.xpath(passwordInputXPath));
        } catch (e) {
            console.log("[Cas-EPC] XPath de contraseña directo no hallado. Buscando input de tipo password...");
            passwordInput = await driver.findElement(By.xpath("//form//input[@type='password']"));
        }
        await passwordInput.sendKeys(defaultPassword);

        // Cargar Valor 0 (div 5)
        const zeroInput = await driver.findElement(By.xpath(zeroInputXPath));
        await zeroInput.clear();
        await zeroInput.sendKeys("0");

        // 7. Hacer click en el botón de confirmación/crear
        const submitBtn = await driver.wait(
            until.elementLocated(By.xpath(submitBtnXPath)),
            10000
        );
        await new Promise(resolve => setTimeout(resolve, 1500)); // Esperar a que la animación de la interfaz se complete
        await driver.executeScript("arguments[0].click();", submitBtn);

        // 7.1 Opcional: Hacer click en el botón del modal de confirmación emergente si existiese
        try {
            const confirmBtnXPath = "//button[contains(@class, 'confirm') or contains(@class, 'swal2-confirm') or contains(text(), 'Aceptar') or contains(text(), 'Sí') or contains(text(), 'Confirmar') or contains(text(), 'Si')] | /html/body/div[2]/div/div/div/div/div[2]/button[1]";
            const confirmBtn = await driver.wait(
                until.elementLocated(By.xpath(confirmBtnXPath)),
                3000
            );
            await driver.executeScript("arguments[0].click();", confirmBtn);
            console.log("[Cas-EPC] Confirmación emergente clickeada con éxito.");
        } catch (e) {
            console.log("[Cas-EPC] Sin ventana emergente de confirmación requerida o no se pudo hacer click.");
        }

        // 8. Esperar a que se procese la creación (generalmente redirige de vuelta a /users/all)
        console.log("[Cas-EPC] Enviando formulario de creación final...");
        
        const result: any = await driver.wait(async (d) => {
            try {
                // 1. Verificar si hay un mensaje de éxito ("Exito" o "Éxito") en la pantalla
                const pageSource = await d.getPageSource();
                if (pageSource.includes("Exito") || pageSource.includes("Éxito") || pageSource.includes("exito")) {
                    console.log("[Cas-EPC] ¡Mensaje de éxito detectado en el modal!");
                    
                    // Intentar cerrar el modal haciendo click en el botón 'X'
                    const closeBtnXPath = "//button[contains(@class, 'close')] | //a[contains(@class, 'close')] | //*[contains(@class, 'close-icon')] | //button[@data-dismiss='modal']";
                    try {
                        const closeBtn = await d.findElement(By.xpath(closeBtnXPath));
                        await d.executeScript("arguments[0].click();", closeBtn);
                        console.log("[Cas-EPC] Botón de cerrar modal clickeado.");
                    } catch (e) {
                        console.log("[Cas-EPC] No se pudo hacer click en el botón de cerrar modal.");
                    }
                    return { success: true };
                }

                // 2. Verificar si el usuario ya aparece listado en la tabla (fuera del modal)
                const cells = await d.findElements(By.xpath(`//table//td[contains(text(), '${usernameGenerated}')]`));
                if (cells.length > 0) {
                    console.log(`[Cas-EPC] ¡Usuario ${usernameGenerated} detectado en la tabla de resultados!`);
                    return { success: true };
                }

                // 3. Verificar si el modal ya se cerró por sí solo (fallback)
                const modal = await d.findElement(By.xpath("/html/body/div[8]"));
                const isDisplayed = await modal.isDisplayed();
                if (!isDisplayed) {
                    return { success: true };
                }
            } catch (e) {
                // Si el modal ya no existe o da error de stale, es que se cerró
                return { success: true };
            }
            
            // Buscar cartel de error en pantalla (restringido a contenedores de alertas/modales para evitar falsos positivos con textos estáticos de la página)
            const errorElements = await d.findElements(By.xpath(
                "//*[contains(@class, 'swal') or contains(@class, 'modal') or contains(@class, 'alert') or contains(@class, 'toast') or contains(@class, 'popup') or contains(@class, 'notification') or contains(@class, 'dialog')]" +
                "//*[contains(text(), 'Error') or contains(text(), 'error') or contains(text(), 'ya existe') or contains(text(), 'inválido')]"
            ));
            if (errorElements.length > 0) {
                for (const el of errorElements) {
                    try {
                        if (await el.isDisplayed()) {
                            const text = await el.getText();
                            if (text && text.trim() !== '' && !text.includes("Exito") && !text.includes("Éxito")) {
                                return { success: false, error: text };
                            }
                        }
                    } catch (e) {
                        // Ignorar si el elemento ya no está en el DOM
                    }
                }
            }
            return false;
        }, 15000);

        if (result && !result.success) {
            console.error(`❌ [Cas-EPC] Error al crear jugador: "${result.error}"`);
            await driver.quit();
            return null;
        }

        console.log(`🎉 [Cas-EPC] Jugador creado con éxito: ${usernameGenerated}`);

        // 9. Lógica condicional del boolean recharge
        if (recharge) {
            console.log("[Cas-EPC] recharge es true. Dejando el navegador abierto para la posterior recarga.");
            return {
                username: usernameGenerated,
                password: defaultPassword,
                driver
            };
        } else {
            console.log("[Cas-EPC] recharge es false. Cerrando navegador...");
            await driver.quit();
            return {
                username: usernameGenerated,
                password: defaultPassword
            };
        }

    } catch (error: any) {
        console.error("❌ Error en el proceso de creación de usuario de Selenium para Cas-EPC:", error.message || error);
        if (driver) {
            try {
                console.log("📸 Tomando captura de pantalla por fallo de creación...");
                const screenshot = await driver.takeScreenshot();
                const screenshotPath = path.join(process.cwd(), 'create_user_failure_casepc.png');
                fs.writeFileSync(screenshotPath, screenshot, 'base64');
                console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
            } catch (screenErr: any) {
                console.error("⚠️ No se pudo tomar la captura de pantalla:", screenErr.message);
            }
            try { await driver.quit(); } catch (e) { /* ignore */ }
        }
        return null;
    }
}
