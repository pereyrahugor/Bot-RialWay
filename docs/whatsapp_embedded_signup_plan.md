# Plan de Implementación: WhatsApp Embedded Signup (Coexistencia)

Este documento detalla los pasos técnicos para integrar el flujo de **Embedded Signup** de WhatsApp en la plataforma, permitiendo que los clientes den de alta sus números de **WhatsApp Business App** en nuestra API de forma oficial, manteniendo el uso de su aplicación móvil (coexistencia).

---

## 🚀 Fase 1: Configuración en Meta for Developers

1.  **Creación de la App**:
    *   Tipo de App: **Negocios** (Business).
    *   Nombre: `Bot-RialWay-Onboarding` (o similar).
2.  **Configuración de Productos**:
    *   Agregar el producto **WhatsApp**.
    *   Agregar el producto **Facebook Login for Business**.
3.  **Permisos y Accesos Directos (App Review)**:
    *   Solicitar acceso avanzado para los siguientes permisos:
        *   `whatsapp_business_management` (Gestionar WABA).
        *   `whatsapp_business_messaging` (Enviar mensajes).
        *   `business_management` (Acceso al Business Manager del cliente).
4.  **Verificación del Negocio**:
    *   La App debe estar vinculada a un **Business Manager verificado** del desarrollador.

---

## 💻 Fase 2: Integración Frontend (Botón de Onboarding)

1.  **Cargar el SDK de JavaScript de Facebook**:
    ```html
    <script async defer crossorigin="anonymous" src="https://connect.facebook.net/es_LA/sdk.js"></script>
    ```
2.  **Inicialización del flujo**:
    *   Configurar un botón de "Conectar WhatsApp" que ejecute el popup de Meta.
    *   Debemos usar un `config_id` generado en el panel de Facebook Login for Business.

3.  **Captura del Callback**:
    *   Cuando el cliente termina el registro, Meta devuelve un `code` (código de intercambio) a través del callback del SDK.
    *   Este código debe enviarse a nuestro backend de inmediato.

---

## ⚙️ Fase 3: Integración Backend (Intercambio de Tokens)

1.  **Endpoint del Servidor (`POST /api/backoffice/whatsapp/onboard`)**:
    *   Recibe el `code` enviado por el frontend.
2.  **Canje de Código por Token**:
    *   Llamada a la Graph API de Meta para intercambiar el `code` por un `AccessToken` de larga duración exclusivo del cliente.
3.  **Obtención de Metadatos del WABA**:
    *   Consultar los IDs de la cuenta de WhatsApp (`WABA_ID`) y del número registrado (`PHONE_NUMBER_ID`).
4.  **Persistencia en Base de Datos**:
    *   Guardar estos IDs asociados al `project_id` del cliente en una nueva tabla (ej: `whatsapp_accounts`).

---

## 📱 Fase 4: Modo Coexistencia (Paso Crítico)

Para permitir que el cliente siga usando su App móvil mientras el bot opera via API:

1.  **Flujo de Verificación**:
    *   Durante el registro, el sistema detectará si el número ya está en uso en una aplicación móvil.
    *   Meta enviará un código de verificación directamente **dentro de su WhatsApp Business App**.
2.  **Confirmación en la Plataforma**:
    *   Nuestra interfaz debe mostrar un campo para que el cliente ingrese ese código recibido en su celular.
3.  **Activación de la API**:
    *   Una vez validado, el número queda vinculado a ambos (App móvil y API).

---

## 🔔 Fase 5: Suscripción a Webhooks

1.  **Configuración Global**:
    *   Debemos configurar una URL de Webhook única en nuestra App de Facebook.
2.  **Suscripción por WABA**:
    *   Cada vez que un nuevo cliente se registre, nuestro backend debe suscribir automáticamente su `WABA_ID` a nuestra URL de Webhook para recibir los mensajes entrantes en tiempo real.

---

## 📝 Notas y Próximos Pasos (Pendiente de Condicionales)

*   **Lógica de Costos**: Considerar que Meta cobra por conversaciones iniciadas desde la API.
*   **Gestión de Plantillas (Templates)**: Si el bot inicia la charla, debe usar plantillas aprobadas.
*   **Condicionales Específicos**: (A incluir según la lógica de negocio que me menciones próximamente).

---
*Documento generado por Antigravity - 21/03/2026*
