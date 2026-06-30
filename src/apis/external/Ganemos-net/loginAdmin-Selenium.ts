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

    private readonly usernameFieldDefault = 'turbobt';
    private readonly passwordFieldDefault = 'coco1234';
    
    /**
     * Realiza el login del administrador utilizando localizadores XPath.
     * 
     * @param username Nombre de usuario del administrador.
     * @param password Contraseña del administrador.
     * @returns Promesa que resuelve a `true` si el login es exitoso o `false` en caso contrario.
     */
    public async login(username: string, password: string): Promise<boolean> {
        console.log(`[SeleniumAuth] Iniciando sesión para el administrador: ${username}...`);

        try {
            // URL genérica para el panel del administrador
            const targetUrl = "https://agents.ganamosnet.org/"; 
            await this.driver.get(targetUrl);

            // XPaths genéricos para los campos del formulario.
            // Puedes reemplazarlos por los de tu plataforma en tu entorno local.
            const userXPath = "/html/body/div[3]/div/section/div/div[2]/div[1]/input";
            const passwordXPath = "/html/body/div[3]/div/section/div/div[2]/div[2]/div[2]/input";
            const submitButtonXPath = "/html/body/div[3]/div/section/div/div[2]/div[3]/button";

            // 1. Localizar y escribir en el campo de usuario
            const userInput = await this.driver.wait(
                until.elementLocated(By.xpath(userXPath)), 
                5000 // Timeout máximo de 10 segundos
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
                console.error(`❌ [SeleniumAuth] Login fallido por error del servidor de Ganamos: "${loginResult.error}"`);
                return false;
            }

            const finalUrl = await this.driver.getCurrentUrl();
            console.log(`[SeleniumAuth] Sesión de administrador iniciada con éxito. URL actual: ${finalUrl}`);
            return true;

        } catch (error: any) {
            console.error("❌ Error en el proceso de inicio de sesión de Selenium:", error.message || error);
            return false;
        }
    }
}
