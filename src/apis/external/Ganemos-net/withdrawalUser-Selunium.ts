import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from './loginAdmin-Selenium.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Servicio para procesar retiros de saldo/fichas de un usuario en Ganemosnet utilizando Selenium.
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
    console.log(`[Ganemos-net] Iniciando retiro de saldo de ${amount} para: ${username}...`);

    let localDriver: WebDriver | undefined = driver;
    let shouldQuit = true; // Por defecto cerramos al final: "cerrar navegador"

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
                console.error("❌ [Ganemos-net] Fallo en la autenticación del administrador para retiro.");
                await localDriver.quit();
                return false;
            }
        } catch (authErr: any) {
            console.error("❌ [Ganemos-net] Excepción durante el login para retiro:", authErr.message || authErr);
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

        // 4. Buscar el botón "Retiro"
        // Intentaremos primero con un selector de texto literal robusto (para evitar fallos por cambio en el DOM),
        // y como fallback usaremos el XPath absoluto provisto por el usuario.
        console.log("[Ganemos-net] Buscando botón 'Retiro'...");
        let withdrawalBtn;
        try {
            withdrawalBtn = await localDriver.wait(
                until.elementLocated(By.xpath("//a[text()='Retiro']")),
                5000
            );
        } catch (e) {
            console.log("[Ganemos-net] Selector literal no encontrado. Usando XPath absoluto de respaldo...");
            const absoluteXPath = "/html/body/div[3]/div/div[2]/main/div[3]/div[1]/div[3]/div[1]/div[2]/div/div[3]/div/a[2]";
            withdrawalBtn = await localDriver.findElement(By.xpath(absoluteXPath));
        }

        await withdrawalBtn.click();

        // 5. Esperar a que redirija a la página de retiro (/user/withdrawal/{id})
        await localDriver.wait(until.urlContains('/user/withdrawal/'), 10000);
        console.log("[Ganemos-net] Redirección a la página de retiro confirmada.");

        // 6. Ingresar el monto en el input de cantidad
        const amountInputXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/div/div[1]/div[5]/div/div[1]/input";
        const amountInput = await localDriver.wait(
            until.elementLocated(By.xpath(amountInputXPath)),
            10000
        );
        await amountInput.sendKeys(amount.toString());

        // 7. Clic en el botón de retiro final
        const submitWithdrawalBtnXPath = "/html/body/div[3]/div/div[2]/main/div[2]/div/div/div[2]/button[2]";
        const submitWithdrawalBtn = await localDriver.findElement(By.xpath(submitWithdrawalBtnXPath));
        await submitWithdrawalBtn.click();

        // Esperar a que se procese la operación y redirija a /users/all
        console.log("[Ganemos-net] Enviando solicitud de retiro...");
        
        const result: any = await localDriver.wait(async (d) => {
            const currUrl = await d.getCurrentUrl();
            if (currUrl.includes('/users/all')) {
                return { success: true };
            }
            
            // Buscar cartel de error en pantalla
            const errorElements = await d.findElements(By.xpath("//*[contains(text(), 'Error') or contains(text(), 'error') or contains(text(), 'insuficiente') or contains(text(), 'inválido') or contains(text(), 'límite')]"));
            if (errorElements.length > 0) {
                for (const el of errorElements) {
                    try {
                        if (await el.isDisplayed()) {
                            const text = await el.getText();
                            if (text && text.trim() !== '') {
                                return { success: false, error: text };
                            }
                        }
                    } catch (err) {
                        // Elemento obsoleto
                    }
                }
            }
            return false;
        }, 15000);

        if (result && !result.success) {
            console.error(`❌ [Ganemos-net] Error al realizar retiro: "${result.error}"`);
            
            try {
                const screenshot = await localDriver.takeScreenshot();
                const screenshotPath = path.join(process.cwd(), 'withdrawal_failure.png');
                fs.writeFileSync(screenshotPath, screenshot, 'base64');
                console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
            } catch (e) {}

            if (shouldQuit && localDriver) {
                await localDriver.quit();
            }
            return false;
        }

        console.log(`🎉 [Ganemos-net] Retiro completado con éxito para ${username} por un monto de ${amount}.`);
        
        // Cerrar el navegador al finalizar la operación
        if (shouldQuit && localDriver) {
            await localDriver.quit();
            console.log("[Ganemos-net] Navegador cerrado correctamente.");
        }
        return true;

    } catch (error: any) {
        console.error("❌ Error en el proceso de retiro de usuario de Selenium:", error.message || error);
        
        if (localDriver) {
            try {
                const screenshot = await localDriver.takeScreenshot();
                const screenshotPath = path.join(process.cwd(), 'withdrawal_failure.png');
                fs.writeFileSync(screenshotPath, screenshot, 'base64');
                console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
            } catch (e) {}

            try { await localDriver.quit(); } catch (e) {}
        }
        return false;
    }
}
