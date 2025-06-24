# WhatsApp AI Assistant Bot (BuilderBot.app)

<p align="center">
  <img src="https://builderbot.vercel.app/assets/thumbnail-vector.png" height="80">
</p>

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new?repository=https://github.com/pereyrahugor/Bot-RialWay.git&envs=ASSISTANT_ID,OPENAI_API_KEY,ID_GRUPO_RESUMEN,PORT&optionalEnvs=PORT)

This project creates a WhatsApp bot that integrates with an AI assistant using BuilderBot technology. It allows for automated conversations and intelligent responses powered by OpenAI's assistant API.

## Features

- WhatsApp bot powered by BuilderBot and OpenAI Assistant API
- Conversational flows and intelligent responses configurable via your own OpenAI Assistant
- Flexible integration: adapts to the logic y comportamiento del asistente definido en las variables de entorno
- Respuestas automáticas a preguntas frecuentes y consultas personalizadas
- Consulta de información y acciones según los datos y archivos que definas
- Fácil despliegue en Railway y Docker
- Integración con archivos de productos, precios u otros recursos según tu caso de uso

## Getting Started

1. Clone this repository
2. Install dependencies:
   ```
   pnpm install
   ```
3. Set up your environment variables in a `.env` file:
   ```
   ASSISTANT_ID=your_openai_assistant_id
   OPENAI_API_KEY=your_openai_api_key
   ID_GRUPO_RESUMEN=your_group_id
   PORT=3008
   ```
4. Run the development server:
   ```
   pnpm run dev
   ```

### Using Docker (Recommended)

This project includes a Dockerfile for easy deployment and consistent environments. To use Docker:

1. Build the Docker image:
   ```
   docker build -t whatsapp-ai-assistant .
   ```
2. Run the container:
   ```
   docker run -p 3008:3008 --env-file .env whatsapp-ai-assistant
   ```

---

## 🚀 Despliegue en Railway

1. Haz público tu repositorio en GitHub (Settings > Danger Zone > Make Public).
2. Agrega un archivo `.env.example` con las siguientes variables:
   ```
   ASSISTANT_ID=
   OPENAI_API_KEY=
   ID_GRUPO_RESUMEN=
   PORT=3008
   ```
3. Haz clic en el botón de arriba para desplegar automáticamente en Railway.
4. Railway detectará el stack y ejecutará tu proyecto.

---

## Usage

The bot is configured in the `src/app.ts` file. It uses the BuilderBot library to create flows and handle messages. The main welcome flow integrates with the OpenAI assistant to generate responses.

## Documentation

For more detailed information on how to use and extend this bot, please refer to the [BuilderBot documentation](https://builderbot.vercel.app/).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open-source and available under the [MIT License](LICENSE).

## Contact

Desarrollado por Pereyra Hugo - pereyrahugor@gmail.com  
Contactos de Empresa: https://clientesneurolinks.com/

---

Built with [BuilderBot](https://www.builderbot.app/en) - Empowering conversational AI for WhatsApp


## Custom

This code is developed for Pereyra Hugo from DusckCodes.

