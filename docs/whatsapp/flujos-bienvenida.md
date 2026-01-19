# 🎫 Flujos de Bienvenida

El bot utiliza múltiples flujos de entrada dependiendo del tipo de mensaje recibido por el usuario. Todos estos flujos convergen en el **AssistantResponseProcessor** para interactuar con la IA.

## 📥 Tipos de Flujo Disponibles

### 📝 welcomeFlowTxt
Se activa cuando el usuario envía un mensaje de texto plano.
- **Acción**: Captura el cuerpo del mensaje y lo envía a OpenAI.

### 🎙️ welcomeFlowVoice
Se activa cuando el usuario envía una nota de voz.
- **Acción**: El bot procesa el audio (posiblemente transcripción vía Whisper o similar) y responde como si fuera texto.

### 🖼️ welcomeFlowImg / Video / Doc
Se activan al recibir una imagen, video o documento respectivamente.
- **Acción**: Notifica al asistente sobre la recepción de un archivo y solicita instrucciones sobre cómo proceder.

---

## 🛠 Lógica de Procesamiento
Cada flujo de bienvenida ejecuta los siguientes pasos internos:
1. **Typing**: Activa el estado "escribiendo..." en WhatsApp para simular interacción humana.
2. **Queue Management**: Maneja colas por usuario para evitar que múltiples mensajes rápidos saturen el procesamiento de OpenAI.
3. **OpenAI Handshake**: Envía el contenido al asistente configurado.
4. **Respuesta Dinámica**: Entrega la respuesta generada por la IA al usuario.

---

## 🔗 Enlaces Cruzados
- [Assistant Processor](../modulos/assistant-processor.md)
- [Ubicación y Google Maps](./flujo-ubicacion.md)
