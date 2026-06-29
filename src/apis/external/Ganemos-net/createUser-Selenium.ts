import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

/**
 * Servicio genérico para automatización headless con Selenium.
 * Muestra el flujo estándar de inicialización, navegación, interacción con campos de texto,
 * clicks en botones de envío y espera de respuestas.
 * 
 * @param username Nombre de usuario a procesar.
 * @param email Correo electrónico a registrar.
 */
export async function createUserSelenium(username: string, email: string): Promise<boolean> {
    console.log(`[Ganemos-net] Iniciando flujo de automatización Selenium para el usuario: ${username}...`);

    // 1. Configurar opciones para ejecución Headless (sin interfaz gráfica)
    const options = new chrome.Options();
    options.addArguments('--headless=new'); // Activa el modo headless moderno de Chrome
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');

    // 2. Inicializar el WebDriver
    const driver: WebDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        const targetUrl = "https://example.com/register"; // Reemplazar con la URL real de registro
        console.log(`[Selenium] Navegando a ${targetUrl}...`);
        await driver.get(targetUrl);

        // 3. Esperar que los campos de formulario estén cargados e interactuar con ellos
        // Reemplaza 'username-field-id' e 'email-field-id' por los identificadores reales de la web
        const userInput = await driver.wait(
            until.elementLocated(By.id('username-field-id')), 
            10000 // 10 segundos de timeout máximo
        );
        await userInput.sendKeys(username);

        const emailInput = await driver.findElement(By.id('email-field-id'));
        await emailInput.sendKeys(email);

        // 4. Hacer clic en el botón de enviar
        // Reemplaza el selector CSS con el adecuado (ej. 'button.submit-btn' o por ID)
        const submitButton = await driver.findElement(By.css('button[type="submit"]'));
        await submitButton.click();

        // 5. Esperar a la confirmación de la operación (ej. redirigir a una página de éxito o un modal)
        await driver.wait(
            until.elementLocated(By.className('success-indicator')),
            15000 // 15 segundos de timeout para la carga de respuesta
        );

        console.log(`[Selenium] Automatización de registro de ${username} completada con éxito.`);
        return true;

    } catch (error: any) {
        console.error("❌ Error durante la ejecución de Selenium:", error.message || error);
        return false;
    } finally {
        // 6. Asegurar el cierre del navegador para no dejar procesos huérfanos en segundo plano
        if (driver) {
            await driver.quit();
            console.log("[Selenium] Navegador cerrado correctamente.");
        }
    }
}
