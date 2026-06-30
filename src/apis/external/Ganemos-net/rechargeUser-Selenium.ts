import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from './loginAdmin-Selenium.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Servicio para recargar fichas/saldo a un usuario en Ganemosnet utilizando Selenium.
 * 
 * @param username Nombre de usuario a recargar.
 * @param amount Monto a depositar.
 * @param driver Instancia existente de WebDriver (opcional). Si no se provee, se creará una nueva y se iniciará sesión.
 */
export async function rechargeUserSelenium(
    username: string,
    amount: number,
    driver?: WebDriver
): Promise<boolean> {
    console.log(`[Ganemos-net] Iniciando recarga de saldo de ${amount} para: ${username}...`);

    let localDriver: WebDriver | undefined = driver;
    let shouldQuit = true; // Por defecto cerramos al final: "y listo, cerramos navegador"

    // Si no se pasa un driver activo, creamos uno nuevo y nos logueamos
    if (!localDriver) {
        console.log("[Ganemos-net] No se proveyó WebDriver. Iniciando nueva instancia...");
        const options = new chrome.Options();
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');

        localDriver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        try {
            const authenticator = new LoginAdminSelenium(localDriver);
            const adminUser = process.env.GANAMOSNET_USER || '';
            const adminPass = process.env.GANAMOSNET_PASS || '';

            const logged = await authenticator.login(adminUser, adminPass);
            if (!logged) {
                console.error("❌ [Ganemos-net] Fallo en la autenticación del administrador para recarga.");
                await localDriver.quit();
                return false;
            }
        } catch (authErr: any) {
            console.error("❌ [Ganemos-net] Excepción durante el login para recarga:", authErr.message || authErr);
            if (localDriver) {
                try { await localDriver.quit(); } catch (e) {}
            }
            return false;
        }
    }

    try {
        // 1. Navegar a /users/all si no estamos allí
        const usersListUrl = "https://agents.ganamosnet.org/users/all";
        const currentUrl = await localDriver.getCurrentUrl();
        if (currentUrl !== usersListUrl) {
            console.log(`[Ganemos-net] Navegando a ${usersListUrl}...`);
            await localDriver.get(usersListUrl);
            await localDriver.wait(until.urlIs(usersListUrl), 10000);
        }

        // 2. Ingresar usuario en el campo de búsqueda
        const searchInputXPath = "/html/body/div[3]/div/div[2]/main/div[3]/div[1]/div[1]/form/div[1]/div[2]/div[1]/input";
        console.log(`[Ganemos-net] Escribiendo usuario a buscar: ${username}...`);
        const searchInput = await localDriver.wait(
            until.elementLocated(By.xpath(searchInputXPath)),
            10000
        );
        await searchInput.clear();
        await searchInput.sendKeys(username);

        // 3. Clic en el botón Buscar
        const searchBtnXPath = "/html/body/div[3]/div/div[2]/main/div[3]/div[1]/div[1]/form/div[5]/div[2]/button";
        const searchBtn = await localDriver.findElement(By.xpath(searchBtnXPath));
        await searchBtn.click();

        // Esperar a que carguen los resultados
        console.log("[Ganemos-net] Buscando usuario...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. Buscar el botón "Depositar" (se busca el elemento enlace por su texto literal en DOM)
        console.log("[Ganemos-net] Buscando enlace 'Depositar' en la lista...");
        const depositBtnXPath = "//a[text()='Depositar']";
        const depositBtn = await localDriver.wait(
            until.elementLocated(By.xpath(depositBtnXPath)),
            10000
        );
        await depositBtn.click();

        // 5. Esperar a que redirija a la página de depósito (/user/deposit/{id})
        await localDriver.wait(until.urlContains('/user/deposit/'), 10000);
        console.log("[Ganemos-net] Redirección a la página de depósito confirmada.");

        // 6. Ingresar el monto en el input de depósito
        const amountInputXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/div/div[1]/div[5]/div[1]/div/div/div/div/input";
        const amountInput = await localDriver.wait(
            until.elementLocated(By.xpath(amountInputXPath)),
            10000
        );
        await amountInput.sendKeys(amount.toString());

        // 7. Clic en el botón de depósito final
        const submitDepositBtnXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/div/div[3]/button[2]";
        const submitDepositBtn = await localDriver.findElement(By.xpath(submitDepositBtnXPath));
        await submitDepositBtn.click();

        // Esperar a que se procese la operación y redirija a /users/all o similar
        console.log("[Ganemos-net] Enviando depósito y esperando confirmación...");
        
        const result: any = await localDriver.wait(async (d) => {
            const currUrl = await d.getCurrentUrl();
            if (currUrl.includes('/users/all')) {
                return { success: true };
            }
            
            // Buscar cartel de error en pantalla
            const errorElements = await d.findElements(By.xpath("//*[contains(text(), 'Error') or contains(text(), 'error') or contains(text(), 'insuficiente') or contains(text(), 'inválido')]"));
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
                        // Elemento obsoleto o inexistente
                    }
                }
            }
            return false;
        }, 15000);

        if (result && !result.success) {
            console.error(`❌ [Ganemos-net] Error al realizar depósito: "${result.error}"`);
            
            try {
                const screenshot = await localDriver.takeScreenshot();
                const screenshotPath = path.join(process.cwd(), 'recharge_failure.png');
                fs.writeFileSync(screenshotPath, screenshot, 'base64');
                console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
            } catch (e) {}

            if (shouldQuit && localDriver) {
                await localDriver.quit();
            }
            return false;
        }

        console.log(`🎉 [Ganemos-net] Recarga de saldo completada con éxito para ${username}.`);
        
        // Cerrar el navegador al finalizar la operación en todos los casos
        if (shouldQuit && localDriver) {
            await localDriver.quit();
            console.log("[Ganemos-net] Navegador cerrado correctamente.");
        }
        return true;

    } catch (error: any) {
        console.error("❌ Error en el proceso de recarga de usuario de Selenium:", error.message || error);
        
        if (localDriver) {
            try {
                const screenshot = await localDriver.takeScreenshot();
                const screenshotPath = path.join(process.cwd(), 'recharge_failure.png');
                fs.writeFileSync(screenshotPath, screenshot, 'base64');
                console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
            } catch (e) {}

            try { await localDriver.quit(); } catch (e) {}
        }
        return false;
    }
}
