import axios from 'axios';

interface LoginResponse {
    success?: boolean;
    token?: string;
    [key: string]: any;
}

const delay = (min: number, max: number): Promise<void> => {
    const ms = (Math.random() * (max - min) + min) * 1000;
    return new Promise(resolve => setTimeout(resolve, ms));
};

export async function executeAgentLogin(): Promise<LoginResponse | null> {
    const baseUrl = "https://agents.ganamosnet.org";
    const username = "turbobt";
    const password = "coco1234";

    try {
        console.log("Esperando antes de iniciar sesión para simular flujo natural...");
        await delay(1, 2);

        const response = await axios.post<LoginResponse>(
            `${baseUrl}/api/user/login/?request_from=agent`,
            {
                username,
                password
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log("Respuesta de autenticación recibida exitosamente:");
        console.log(JSON.stringify(response.data, null, 2));
        return response.data;

    } catch (error: any) {
        console.error("❌ Error en la autenticación del agente:", error.response?.data || error.message);
        return null;
    }
}

// Ejecutar la función
executeAgentLogin();
