import { WebDriver, By, until } from 'selenium-webdriver';

/**
 * Clase para manejar la autenticación del administrador utilizando Selenium.
 * Esta clase recibe una instancia del WebDriver activa y realiza el inicio de sesión.
 */
export class LoginAdminSelenium {
    private driver: WebDriver;

    constructor(driver: WebDriver) {
        this.driver = driver;
    }

    /**
     * Realiza el login del administrador utilizando localizadores XPath.
     * 
     * @param username Nombre de usuario del administrador.
     * @param password Contraseña del administrador.
     * @returns Promesa que resuelve a `true` si el login es exitoso o `false` en caso contrario.
     */
    public async login(username: string, password: string): Promise<boolean> {
        if (!username || !password) {
            console.error("❌ [SeleniumAuth] Las credenciales de administrador (CASEPC_USER / CASEPC_PASS) no están configuradas.");
            return false;
        }
        console.log(`[SeleniumAuth] Iniciando sesión para el administrador de Cas-EPC: ${username}...`);

        try {
            // URL para el panel del administrador de Cas-EPC
            const targetUrl = "https://admin.epcbet.net/index.php?act=admin&area=login"; 
            await this.driver.get(targetUrl);

            // XPaths para los campos del formulario provistos por el usuario.
            const userXPath = "/html/body/div/div/div/div[2]/form/fieldset/div[1]/input";
            const passwordXPath = "/html/body/div/div/div/div[2]/form/fieldset/div[2]/input";
            const submitButtonXPath = "/html/body/div/div/div/div[2]/form/fieldset/button";

            // 1. Localizar y escribir en el campo de usuario
            const userInput = await this.driver.wait(
                until.elementLocated(By.xpath(userXPath)), 
                5000 
            );
            await userInput.sendKeys(username);

            // 2. Localizar y escribir en el campo de contraseña
            const passwordInput = await this.driver.findElement(By.xpath(passwordXPath));
            await passwordInput.sendKeys(password);

            // 3. Localizar y hacer click en el botón de ingreso
            const submitButton = await this.driver.findElement(By.xpath(submitButtonXPath));
            await submitButton.click();

            // 4. Esperar a que la URL cambie tras hacer clic o aparezca un mensaje de error en pantalla
            const loginResult: any = await this.driver.wait(async (d) => {
                const currentUrl = await d.getCurrentUrl();
                if (currentUrl !== targetUrl) {
                    return { success: true };
                }

                // Buscar elementos que contengan texto de error en la interfaz
                const errorElements = await d.findElements(By.xpath("//*[contains(text(), 'Error') or contains(text(), 'error') or contains(text(), '504')]"));
                if (errorElements.length > 0) {
                    for (const el of errorElements) {
                        try {
                            const text = await el.getText();
                            if (text && (text.includes('504') || text.toLowerCase().includes('error'))) {
                                return { success: false, error: text };
                            }
                        } catch (e) {
                            // Ignorar si el elemento ya no está en el DOM
                        }
                    }
                }
                return false;
            }, 15000);

            if (loginResult && !loginResult.success) {
                console.error(`❌ [SeleniumAuth] Login fallido por error del servidor de Cas-EPC: "${loginResult.error}"`);
                return false;
            }

            const finalUrl = await this.driver.getCurrentUrl();
            console.log(`[SeleniumAuth] Sesión de administrador iniciada con éxito. URL actual: ${finalUrl}`);
            return true;

        } catch (error: any) {
            console.error("❌ Error en el proceso de inicio de sesión de Selenium para Cas-EPC:", error.message || error);
            return false;
        }
    }
}
