# 🧭 Guía de Demostración y Test Guiado - RialWay CRM

Bienvenido a la guía oficial de **Demostración y Test Guiado de RialWay CRM**. Este documento está diseñado tanto para que el equipo comercial realice **presentaciones de venta en vivo de alto impacto**, como para que clientes potenciales puedan **autoexplorar las funciones del sistema de forma práctica**.

---

## 🎯 Los 4 Objetivos de este Entorno de Prueba

1. **Presentaciones guiadas en vivo (Videollamadas de venta)**: Un CRM con datos modelo realistas para mostrar en vivo el flujo de leads, estados, notas, filtros y métricas.
2. **Acceso abierto (Sandbox público)**: Un link directo (`/login?demo=true`) que permite a cualquier visitante de la landing page explorar el sistema sin riesgo de romper datos de producción.
3. **Entorno comercial limpio y predecible**: Botón de **"Restablecer Demo"** de 1-click directo en la interfaz y reinicio automático nocturno (03:00 AM ARG).
4. **Asistente Virtual interactivo del CRM**: Un bot configurado con conocimiento experto sobre RialWay, listo para responder consultas por Webchat o WhatsApp en tiempo real.

---

## 🔑 Acceso Rápido al Entorno Demo

- **URL del Entorno**: `https://botcrm-neurolinks-production-6758.up.railway.app`
- **Acceso Directo con Auto-login**: `https://botcrm-neurolinks-production-6758.up.railway.app/login?demo=true`
- **Credenciales Manuales**:
  - **Usuario**: `TestIngMate`
  - **Contraseña**: `IngMateUndav`
- **WebChat Público**: `https://botcrm-neurolinks-production-6758.up.railway.app/webchat`

---

## 📋 Recorrido Paso a Paso para la Presentación (Guión de Ventas)

A continuación se detalla el flujo recomendado de 10 a 15 minutos para una demostración exitosa:

### Paso 1: Introducción al Tablero Comercial (Kanban)
1. Inicie sesión y acceda a la pestaña **CRM**.
2. Muestre cómo las oportunidades de negocio avanzan de izquierda a derecha a través de las 6 etapas del embudo:
   - **Nuevos Leads**: Prospectos recién ingresados desde WhatsApp, Webchat o campañas.
   - **Primer Contacto**: Conversaciones iniciales atendidas por el bot o asesores.
   - **Calificados / Demo**: Prospectos calificados con interés concreto.
   - **Propuesta Enviada**: Cotizaciones y presupuestos en evaluación.
   - **Clientes Ganados / Activos**: Ventas cerradas exitosamente.
   - **Pausado / No califica**: Contactos a retomar más adelante.
3. **Acción en vivo**: Arrastre una tarjeta (ej. *Distribuidora San Martín*) de "Calificados" a "Propuesta Enviada" para evidenciar la fluidez del Drag & Drop.

### Paso 2: Vista de Ficha de Cliente y Notas Internas
1. Haga clic en una tarjeta (ej. **Distribuidora San Martín** o **Clínica Dental OdontoSalud**).
2. Muestre la información detallada:
   - Nombre del contacto y empresa.
   - CUIT / DNI y condición fiscal (Responsable Inscripto / Monotributo).
   - Teléfono, dirección y canal de origen.
   - **Notas internas**: Muestre el historial de reuniones, acuerdos comerciales y presupuestos cotizados, accesibles para todo el equipo de ventas.
   - **Fecha de vencimiento (Due Date)**: Fechas límite para tareas y recordatorios de seguimiento.

### Paso 3: Filtros Avanzados y Clasificación por Etiquetas
1. Abra el panel de **Filtros** en la barra superior.
2. Filtre por etiquetas de color:
   - Seleccione `#Integración ERP` para mostrar cómo segmentar clientes corporativos.
   - Seleccione `#Alta Prioridad` para enfocar la atención en cierres inminentes.
3. Muestre cómo el contador dinámico se adapta instantáneamente reflejando los leads filtrados.

### Paso 4: Bandeja Omnicanal y Conversaciones Reales
1. Diríjase a la sección **Conversaciones** (Backoffice).
2. Explique cómo conviven chats de **WhatsApp**, **Webchat** e **Instagram** en un único lugar.
3. Abra la conversación con **ElectroHogar Express**:
   - Muestre el envío de un comprobante de pago.
   - Destaque la validación automática mediante **Visión / OCR**, extrayendo número de operación y acreditación en tiempo real.
4. Abra la conversación con **Clínica Dental OdontoSalud**:
   - Muestre la conversación natural del bot asesorando sobre planes multi-agente y turnos.

### Paso 5: Prueba en Vivo con el Asistente Virtual (WebChat)
1. Abra la ruta `/webchat` en una pestaña nueva o ventana de incógnito.
2. Escriba consultas reales al bot para que el prospecto vea la velocidad y precisión:
   - *"Hola, ¿el sistema se puede conectar con mi sistema Tango o SQL?"*
   - *"¿Cómo funciona la derivación a vendedores humanos?"*
   - *"¿Pueden trabajar 5 vendedores con el mismo número de WhatsApp?"*
3. Observe cómo el bot responde de forma profesional y orientada al cierre comercial.
4. Vuelva a la pestaña del **CRM**: observe cómo el mensaje enviado desde el Webchat actualiza el chat en tiempo real.

### Paso 6: Demostración de Seguridad y Reset 1-Click
1. Al finalizar la llamada o prueba, demuestre la resiliencia del entorno:
2. Muestre el botón amarillo **`🔄 Restablecer Demo`** en la parte superior derecha del CRM.
3. Haga clic y confirme el restablecimiento.
4. En 2 segundos, el sistema limpiará cualquier chat o movimiento de prueba y restaurará los **12 leads modelo limpios**, listo para la próxima presentación.

---

## ⚙️ Características Técnicas del Entorno Demo

- **Aislamiento Multi-Tenant Estricto**: Todo el reseteo y almacenamiento opera exclusivamente filtrando por `project_id = 1fffed58-3e34-409d-8707-83ce1b3d4d9c` y `service_id = 8f906621-de6d-441a-97bc-fa732cf36456`. Ningún dato de clientes reales puede verse comprometido.
- **Protección Sandbox de Credenciales**: Las variables críticas (`ADMIN_PASS`, `SUPABASE_KEY`, `RAILWAY_TOKEN`, `OPENAI_API_KEY`) están protegidas contra modificaciones por usuarios demo, asegurando que el acceso público permanezca siempre operativo.
- **Worker Nocturno de Auto-Limpieza**: Todos los días a las 03:00 AM (hora Argentina), una tarea programada en segundo plano ejecuta automáticamente el seeder para que cada jornada comience con el CRM impecable.
