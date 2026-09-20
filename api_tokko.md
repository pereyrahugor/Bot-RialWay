# Guía de Integración con API de Tokko Broker

Este documento resume los requisitos, pasos y elementos necesarios para integrar servicios (como un bot de WhatsApp, CRM o sitio web) con la plataforma de **Tokko Broker**.

---

## 📌 Aclaración Inicial
La documentación de desarrolladores de Tokko Broker cubre dos grandes casos de uso:

1. **API de Integración General (Lo más habitual para Bots y Sitios Web):**
   * Consultar catálogo de propiedades disponibles (filtrar por zona, tipo, ambientes, precio).
   * Enviar los datos de las personas interesadas (leads/contactos) directamente al CRM para que los atienda el equipo de ventas.
2. **Importador de Propiedades (`/docs/home`):**
   * Cargar o actualizar masivamente propiedades desde un sistema externo hacia Tokko Broker mediante un archivo en formato JSON o XML.

---

## 1. Requisitos Generales
* **Cuenta activa en Tokko Broker:** La inmobiliaria debe tener contratado y funcionando el servicio de Tokko Broker.
* **Acceso de Administrador:** Se requiere un usuario con permisos de administrador en el panel de Tokko para poder consultar o habilitar las credenciales de conexión.

---

## 2. ¿Qué se le debe solicitar al cliente (Inmobiliaria)?
Podés compartirle directamente esta lista al cliente:

1. **Clave de API (API Key):**
   * *¿Cómo la obtiene el cliente?*
     1. Iniciar sesión en el panel de [Tokko Broker](https://www.tokkobroker.com).
     2. Ir al menú **Mi Empresa** (o Configuración).
     3. Seleccionar **Permisos**.
     4. Copiar la **API Key** (un código alfanumérico privado y único de su inmobiliaria).
2. **Definir el objetivo de la integración:**
   * **Opción A (Bot / Web):** Que el bot consulte inmuebles en tiempo real y mande las consultas de los clientes interesados directo al panel de Tokko.
   * **Opción B (Importador):** Cargar a Tokko un listado de inmuebles provenientes de otra base de datos o sistema.
3. **Contacto del Administrador (Opcional):**
   * Contacto de la persona encargada de la cuenta en la inmobiliaria para verificar la recepción de pruebas dentro del panel.

---

## 3. ¿Qué debe hacer el desarrollador?
1. **Configuración de Credenciales:**
   * Almacenar de forma segura el `API Key` en las variables de entorno del sistema/bot.
2. **Implementación según el objetivo:**
   * **Para Bot de WhatsApp o Web:**
     * Configurar los llamados de búsqueda de propiedades (`/property/` o endpoints de búsqueda) según los criterios del usuario (zona, operación venta/alquiler, presupuesto, etc.).
     * Configurar el envío del lead (`/webcontact/` o formulario de contacto) con los datos recopilados: nombre, teléfono, mensaje de consulta y propiedad de interés.
   * **Para Importador Masivo:**
     * Generar el archivo de propiedades en formato JSON o XML cumpliendo estrictamente la estructura y mapeos requeridos por Tokko Broker.
     * Publicar el archivo en una URL accesible y notificar a Tokko Broker mediante la llamada POST correspondiente indicando la URL del archivo y el callback de confirmación.
3. **Pruebas y Verificación:**
   * Realizar una llamada de prueba y confirmar junto al cliente que el lead o la propiedad se visualice correctamente en su panel de Tokko Broker.
