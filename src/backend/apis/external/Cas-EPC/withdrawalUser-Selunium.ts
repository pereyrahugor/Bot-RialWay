import { Builder, By, until, WebDriver, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from './loginAdmin-Selenium.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Servicio para procesar retiros de saldo/fichas de un usuario en Cas-EPC utilizando Selenium.
 * 
 * @param username Nombre de usuario del cual retirar.
 * @param amount Monto a retirar.
 * @param driver Instancia existente de WebDriver (opcional). Si no se provee, se creará una nueva y se iniciará sesión.
 */
export async function withdrawalUser(
    username: string,
    amount: number,
    driver?: WebDriver
): Promise<boolean> {
    console.log(`[Cas-EPC] Iniciando retiro de saldo de ${amount} para: ${username}...`);

    let localDriver: WebDriver | undefined = driver;
    const shouldQuit = true; 

    // Si no se pasa un driver activo, creamos uno nuevo y nos logueamos
    if (!localDriver) {
        console.log("[Cas-EPC] No se proveyó WebDriver. Iniciando nueva instancia...");
        const options = new chrome.Options();
        if (process.env.SELENIUM_HEADLESS !== 'false') {
            options.addArguments('--headless=new');
        }
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu');
        options.addArguments('--window-size=1920,1080');

        localDriver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        try {
            const authenticator = new LoginAdminSelenium(localDriver);
            const adminUser = process.env.CASEPC_USER || 'testercrm2';
            const adminPass = process.env.CASEPC_PASS || 'asghs56VGS$AS';

            const logged = await authenticator.login(adminUser, adminPass);
            if (!logged) {
                console.error("❌ [Cas-EPC] Fallo en la autenticación del administrador para retiro.");
                await localDriver.quit();
                return false;
            }
        } catch (authErr: any) {
            console.error("❌ [Cas-EPC] Excepción durante el login para retiro:", authErr.message || authErr);
            if (localDriver) {
                try { await localDriver.quit(); } catch (e) { /* ignore */ }
            }
            return false;
        }
    }

    try {
        // 1. Asegurarse de estar en la URL: https://admin.epcbet.net/index.php
        const usersListUrl = "https://admin.epcbet.net/index.php";
        const currentUrl = await localDriver.getCurrentUrl();
        if (!currentUrl.includes('/index.php')) {
            console.log(`[Cas-EPC] Navegando a ${usersListUrl}...`);
            await localDriver.get(usersListUrl);
            await localDriver.wait(until.urlContains('/index.php'), 10000);
        }

        // Detectar y cambiar contexto al iframe si está presente en la página
        const iframes = await localDriver.findElements(By.tagName("iframe"));
        console.log(`[Cas-EPC] Cantidad de iframes en la página: ${iframes.length}`);
        if (iframes.length > 0) {
            console.log("[Cas-EPC] Cambiando contexto al primer iframe (index 0)...");
            await localDriver.switchTo().frame(0);
        }

        // Esperar a que la página cargue y estabilice su grid inicial antes de buscar
        console.log("[Cas-EPC] Esperando a que el grid de usuarios se estabilice...");
        await new Promise(resolve => setTimeout(resolve, 3500));

        // Hacer click en el botón "Mostrar" para forzar la recarga/actualización de la base de datos de usuarios
        try {
            console.log("[Cas-EPC] Ampliando el rango de fechas en 'from-date'...");
            const fromDateInput = await localDriver.findElement(By.id("from-date"));
            await localDriver.executeScript("arguments[0].value = '01.07.2026';", fromDateInput);
            console.log("[Cas-EPC] Rango de fecha cambiado a '01.07.2026'.");
        } catch (e: any) {
            console.log("[Cas-EPC] No se pudo cambiar el input 'from-date':", e.message);
        }

        try {
            console.log("[Cas-EPC] Haciendo click en Mostrar para actualizar la lista...");
            const mostrarBtn = await localDriver.findElement(By.xpath("//button[contains(text(), 'Mostrar')]"));
            await mostrarBtn.click();
            await new Promise(resolve => setTimeout(resolve, 4500)); // Esperar a que la recarga de datos termine
        } catch (e) {
            console.log("[Cas-EPC] No se encontró el botón Mostrar o falló el click, continuando...");
        }

        // 2. Ingresar usuario en el campo de búsqueda
        const searchInputXPath = "//*[@id=\"bets_find_user\"]";
        console.log(`[Cas-EPC] Escribiendo usuario a buscar: ${username}...`);
        const searchInput = await localDriver.wait(
            until.elementLocated(By.xpath(searchInputXPath)),
            10000
        );
        await localDriver.wait(until.elementIsVisible(searchInput), 5000);
        await searchInput.clear();
        await searchInput.sendKeys(username);

        // 3. Clic en el botón Buscar
        console.log("[Cas-EPC] Haciendo click en el botón Buscar...");
        try {
            const searchBtn = await localDriver.findElement(By.xpath("//button[contains(text(), 'Buscar')] | //input[@value='Buscar'] | //button[@type='submit']"));
            await localDriver.executeScript("arguments[0].click();", searchBtn);
        } catch (e) {
            console.log("[Cas-EPC] Botón Buscar falló, intentando enviar ENTER...");
            await searchInput.sendKeys(Key.ENTER);
        }

        // Esperar a que carguen los resultados
        console.log("[Cas-EPC] Esperando a que el usuario aparezca en la lista...");
        await new Promise(resolve => setTimeout(resolve, 2500));

        // 4. Ingresar el monto en el input de depósito de la fila correspondiente (mismo campo que recarga)
        const amountInputXPath = "/html/body/div[7]/div[2]/div/div[2]/div[2]/div[3]/div[2]/div[2]/table/tbody/tr[1]/td[5]/div/form/input";
        const amountInput = await localDriver.wait(
            until.elementLocated(By.xpath(amountInputXPath)),
            10000
        );
        await amountInput.clear();
        await amountInput.sendKeys(amount.toString());

        // 5. Clic en el botón de retiro (button[2])
        const submitWithdrawalBtnXPath = "/html/body/div[7]/div[2]/div/div[2]/div[2]/div[3]/div[2]/div[2]/table/tbody/tr[1]/td[5]/div/form/button[2]";
        const submitWithdrawalBtn = await localDriver.findElement(By.xpath(submitWithdrawalBtnXPath));
        await submitWithdrawalBtn.click();

        // Esperar a que se procese la operación y confirmar que no haya errores
        console.log("[Cas-EPC] Enviando retiro y esperando confirmación...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Buscar cartel de error en pantalla si lo hubiera (restringido a contenedores de alertas/modales para evitar falsos positivos con textos estáticos de la página)
        const errorElements = await localDriver.findElements(By.xpath(
            "//*[contains(@class, 'swal') or contains(@class, 'modal') or contains(@class, 'alert') or contains(@class, 'toast') or contains(@class, 'popup') or contains(@class, 'notification') or contains(@class, 'dialog')]" +
            "//*[contains(text(), 'Error') or contains(text(), 'error') or contains(text(), 'insuficiente') or contains(text(), 'inválido') or contains(text(), 'límite') or contains(text(), 'no tiene')]"
        ));
        if (errorElements.length > 0) {
            for (const el of errorElements) {
                try {
                    if (await el.isDisplayed()) {
                        const text = await el.getText();
                        if (text && text.trim() !== '') {
                            console.error(`❌ [Cas-EPC] Error al realizar retiro: "${text}"`);
                            
                            try {
                                const screenshot = await localDriver.takeScreenshot();
                                const screenshotPath = path.join(process.cwd(), 'withdrawal_failure_casepc.png');
                                fs.writeFileSync(screenshotPath, screenshot, 'base64');
                                console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
                            } catch (e) { /* ignore */ }

                            if (shouldQuit && localDriver) {
                                await localDriver.quit();
                            }
                            return false;
                        }
                    }
                } catch (err) {
                    // Elemento obsoleto
                }
            }
        }

        console.log(`🎉 [Cas-EPC] Retiro completado con éxito para ${username} por un monto de ${amount}.`);
        
        // Cerrar el navegador al finalizar la operación
        if (shouldQuit && localDriver) {
            await localDriver.quit();
            console.log("[Cas-EPC] Navegador cerrado correctamente.");
        }
        return true;

    } catch (error: any) {
        console.error("❌ Error en el proceso de retiro de usuario de Selenium para Cas-EPC:", error.message || error);
        
        if (localDriver) {
            try {
                const screenshot = await localDriver.takeScreenshot();
                const screenshotPath = path.join(process.cwd(), 'withdrawal_failure_casepc.png');
                fs.writeFileSync(screenshotPath, screenshot, 'base64');
                console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
            } catch (e) { /* ignore */ }

            try { await localDriver.quit(); } catch (e) { /* ignore */ }
        }
        return false;
    }
}
