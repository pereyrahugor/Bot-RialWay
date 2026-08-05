import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { LoginAdminSelenium } from './loginAdmin-Selenium.js';
import * as fs from 'fs';
import * as path from 'path';
import { ProxyManager } from '../../../utils/proxyManager.js';

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

    const maxAttempts = driver ? 1 : 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!driver) {
            console.log(`[Ganemos-net] Intento ${attempt}/${maxAttempts} para realizar retiro...`);
        }
        let localDriver: WebDriver | undefined = driver;
        const shouldQuit = true; // Por defecto cerramos al final: "cerrar navegador"
        let currentRawProxy: string | null = null;

        try {
            // Si no se pasa un driver activo, creamos uno nuevo y nos logueamos
            if (!localDriver) {
                console.log("[Ganemos-net] No se proveyó WebDriver. Iniciando nueva instancia...");
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
                    currentRawProxy = proxySession.rawProxy || null;
                }

                localDriver = await new Builder()
                    .forBrowser('chrome')
                    .setChromeOptions(options)
                    .build();

                // Ahorro de 85% de datos de Proxy: Bloquear recursos pesados (imágenes, fuentes, scripts de rastreo) vía CDP
                try {
                    await (localDriver as any).sendAndGetDevToolsCommand('Network.enable');
                    await (localDriver as any).sendAndGetDevToolsCommand('Network.setBlockedURLs', {
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
                    (localDriver as any)._proxyCleanup = proxySession.cleanup;
                }

                const authenticator = new LoginAdminSelenium(localDriver);
                const adminUser = process.env.GANAMOSNET_USER || '';
                const adminPass = process.env.GANAMOSNET_PASS || '';

                const logged = await authenticator.login(adminUser, adminPass);
                if (!logged) {
                    throw new Error("Fallo en la autenticación del administrador para retiro.");
                }
            }

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
            try {
                await submitWithdrawalBtn.click();
            } catch (clickErr: any) {
                if (clickErr.name === 'ElementClickInterceptedError' || clickErr.message.includes('click intercepted')) {
                    console.log("[Ganemos-net] Click en el botón de retiro final interceptado por spinner/overlay. Reintentando mediante JS Executor...");
                    await localDriver.executeScript("arguments[0].click();", submitWithdrawalBtn);
                } else {
                    throw clickErr;
                }
            }

            // Esperar a que se procese la operación y redirija a /users/all
            console.log("[Ganemos-net] Enviando solicitud de retiro...");
            
            const result: any = await localDriver.wait(async (d) => {
                const currUrl = await d.getCurrentUrl();
                if (currUrl.includes('/users/all')) {
                    return { success: true };
                }
                
                // Buscar cartel de error en pantalla
                const errorElements = await d.findElements(By.xpath(
                    "//*[contains(@class, 'swal') or contains(@class, 'modal') or contains(@class, 'alert') or contains(@class, 'toast') or contains(@class, 'popup') or contains(@class, 'notification') or contains(@class, 'dialog')]" +
                    "//*[contains(text(), 'Error') or contains(text(), 'error') or contains(text(), 'insuficiente') or contains(text(), 'inválido') or contains(text(), 'límite') or contains(text(), 'no tiene')]"
                ));
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
                throw new Error(`Error al realizar retiro: "${result.error}"`);
            }

            console.log(`🎉 [Ganemos-net] Retiro completado con éxito para ${username} por un monto de ${amount}.`);
            
            // Cerrar el navegador al finalizar la operación
            if (shouldQuit && localDriver) {
                await localDriver.quit();
                if ((localDriver as any)._proxyCleanup) await (localDriver as any)._proxyCleanup();
                console.log("[Ganemos-net] Navegador cerrado correctamente.");
            }
            return true;

        } catch (error: any) {
            console.error(`❌ [Ganemos-net] Intento ${attempt}/${maxAttempts} de retiro fallido:`, error.message || error);
            
            if (currentRawProxy) {
                ProxyManager.markProxyFailed(currentRawProxy);
            }
            
            if (localDriver) {
                try {
                    const screenshot = await localDriver.takeScreenshot();
                    const screenshotPath = path.join(process.cwd(), `withdrawal_failure_attempt_${attempt}.png`);
                    fs.writeFileSync(screenshotPath, screenshot, 'base64');
                    console.log(`📸 Captura de pantalla guardada en: ${screenshotPath}`);
                } catch (e) { /* ignore */ }

                try { 
                    await localDriver.quit(); 
                    if ((localDriver as any)._proxyCleanup) await (localDriver as any)._proxyCleanup();
                } catch (e) { /* ignore */ }
            }

            if (attempt === maxAttempts) {
                return false;
            }
        }
    }
    return false;
}
