import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

export const DEMO_SERVICE_ID = '8f906621-de6d-441a-97bc-fa732cf36456';
export const DEMO_PROJECT_ID = '1fffed58-3e34-409d-8707-83ce1b3d4d9c';

const DEMO_CRM_PROMPT = `Actuá como un Asesor y Especialista de Producto de RialWay CRM.
Tu objetivo es responder de forma amable, profesional, concisa y persuasiva a clientes interesados en adquirir o probar nuestra plataforma de CRM y Automatización Omnicanal con Inteligencia Artificial.

CONOCIMIENTO DE RIALWAY CRM:
1. BANDEJA OMNICANAL MULTI-AGENTE:
   - Centraliza WhatsApp Oficial (Meta Cloud API), Instagram Direct, Facebook Messenger y Webchat en una sola bandeja visual.
   - Múltiples agentes humanos pueden responder simultáneamente desde distintas computadoras usando una única línea de WhatsApp.
   - Visualización de estados, notas internas privadas entre operadores, derivación de conversaciones y etiquetas de colores.

2. ASISTENTES VIRTUALES CON INTELIGENCIA ARTIFICIAL (IA):
   - Respuestas inmediatas 24/7 impulsadas por modelos de lenguaje avanzados (OpenAI GPT-4o / GPT-3.5).
   - Capacidad de mantener memoria conversacional persistente del cliente (nombre, CUIT, pedidos, historial).
   - Derivación inteligente (Handover): el bot detecta automáticamente cuando una consulta requiere un especialista (Ventas, Facturación, Soporte) o pausa su intervención cuando un agente humano escribe, reactivándose tras un periodo de inactividad configurable.

3. MÓDULO DE LECTURA DE COMPROBANTES (VISIÓN & OCR):
   - Lector inteligente de transferencias bancarias y comprobantes de Mercado Pago.
   - Extrae automáticamente: número de operación, monto, fecha/hora, emisor y receptor.
   - Permite verificar pagos y acreditar pedidos sin demoras.

4. INTEGRACIÓN CON SISTEMAS DE GESTIÓN (ERP & BASES DE DATOS):
   - Conexión nativa y segura con ERPs (Tango Software, Trust, bases de datos SQL y PostgreSQL).
   - Consulta de stock, precios personalizados según condición del cliente, listas de artículos y registro automático de pedidos o presupuestos.
   - Integración con Google Sheets y Google Calendar para agenda de turnos o reuniones.

5. GESTIÓN COMERCIAL KANBAN:
   - Embudo de ventas visual interactivo estilo Kanban con etapas personalizables (Nuevos, Contactados, Calificados, Propuesta, Ganados).
   - Fechas límite, asignación de tareas, filtros por etiquetas y métricas de rendimiento comercial.

PAUTAS DE RESPUESTA:
- Respondé en español rioplatense cordial, claro y orientado a soluciones de negocio.
- Si el usuario consulta cómo implementar el CRM en su empresa o pide precios, explicá brevemente los beneficios y preguntale:
  1. ¿Qué canal o canales le gustaría conectar (WhatsApp, Web, Instagram)?
  2. ¿Cuántos operadores o vendedores atienden actualmente?
  3. ¿Tienen algún sistema de gestión o facturación con el que quisieran integrar el bot?
- Si solicita una demostración en vivo o cotización, pedile cordialmente su nombre, empresa y número de teléfono para que un asesor comercial se contacte.`;

export async function seedDemoService(
    projectId: string = DEMO_PROJECT_ID,
    serviceId: string = DEMO_SERVICE_ID
): Promise<{ success: boolean; message: string; leadsCount: number }> {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('[demoSeeder] Variables SUPABASE_URL o SUPABASE_KEY no configuradas.');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`🌱 [demoSeeder] Iniciando sembrado para project: ${projectId}, service: ${serviceId}...`);

    // 1. Configurar Columnas Kanban en settings
    const demoColumns = [
        { id: "UNASSIGNED", title: "Nuevos Leads", fixed: true },
        { id: "contactado", title: "Primer Contacto" },
        { id: "calificado", title: "Calificados / Demo" },
        { id: "propuesta", title: "Propuesta Enviada" },
        { id: "ganado", title: "Clientes Ganados / Activos" },
        { id: "perdido", title: "Pausado / No califica" }
    ];

    await supabase.from('settings').upsert({
        project_id: projectId,
        service_id: serviceId,
        key: 'CRM_COLUMNS',
        value: JSON.stringify(demoColumns),
        updated_at: new Date().toISOString()
    }, { onConflict: 'project_id,service_id,key' });

    // 2. Configurar Prompt del Bot en settings
    await supabase.from('settings').upsert({
        project_id: projectId,
        service_id: serviceId,
        key: 'ASSISTANT_PROMPT',
        value: DEMO_CRM_PROMPT,
        updated_at: new Date().toISOString()
    }, { onConflict: 'project_id,service_id,key' });

    await supabase.from('settings').upsert({
        project_id: projectId,
        service_id: serviceId,
        key: 'ASSISTANT_NAME',
        value: 'Asesor RialWay CRM',
        updated_at: new Date().toISOString()
    }, { onConflict: 'project_id,service_id,key' });

    // 3. Crear Etiquetas (Tags)
    const demoTagsData = [
        { name: 'Alta Prioridad', color: '#ef4444' },
        { name: 'Integración ERP', color: '#3b82f6' },
        { name: 'Presupuesto', color: '#10b981' },
        { name: 'Multi-Agente', color: '#8b5cf6' },
        { name: 'Webchat', color: '#f59e0b' },
        { name: 'Demo Solicitada', color: '#f97316' }
    ];

    const tagMap = new Map<string, string>(); // name -> id

    for (const tag of demoTagsData) {
        let tagRecord: any = null;
        const { data: existing } = await supabase
            .from('tags')
            .select('id')
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .eq('name', tag.name)
            .maybeSingle();

        if (existing) {
            tagRecord = existing;
            await supabase.from('tags').update({ color: tag.color }).eq('id', existing.id);
        } else {
            const { data: inserted } = await supabase
                .from('tags')
                .insert({
                    project_id: projectId,
                    service_id: serviceId,
                    name: tag.name,
                    color: tag.color,
                    created_at: new Date().toISOString()
                })
                .select('id')
                .single();
            tagRecord = inserted;
        }

        if (tagRecord?.id) {
            tagMap.set(tag.name, tagRecord.id);
        }
    }

    // 4. Limpieza estricta de datos previos (SOLO para este project_id y service_id)
    console.log('🧹 [demoSeeder] Limpiando datos previos de prueba del servicio demo...');
    await supabase.from('chat_tags').delete().eq('project_id', projectId).eq('service_id', serviceId);
    await supabase.from('messages').delete().eq('project_id', projectId).eq('service_id', serviceId);
    await supabase.from('tickets').delete().eq('project_id', projectId).eq('service_id', serviceId);
    await supabase.from('chats').delete().eq('project_id', projectId).eq('service_id', serviceId);

    // 5. Inserción de los 12 Leads Modelo
    const now = Date.now();
    const isoHoursAgo = (hours: number) => new Date(now - hours * 3600 * 1000).toISOString();
    const isoDaysFromNow = (days: number) => new Date(now + days * 24 * 3600 * 1000).toISOString();

    const demoLeads = [
        {
            id: '5491155550101',
            name: 'Distribuidora San Martín S.R.L.',
            contactName: 'Martín Cabrera (Gerente Comercial)',
            type: 'whatsapp',
            crm_status: 'calificado',
            tags: ['Integración ERP', 'Alta Prioridad'],
            email: 'martin@distribuidorasanmartin.com.ar',
            address: 'Av. San Martín 3450, Caseros, Bs.As.',
            cuit_dni: '30-71234567-8',
            tax_status: 'Responsable Inscripto',
            notes: '📋 *FICHA DE REUNIÓN PREVIA*\n- Empresa de distribución mayorista de alimentos con 8 vendedores.\n- Utilizan Tango Gestión y necesitan que el bot consulte stock y listas de precios automáticamente por WhatsApp.\n- Demostración técnica agendada para el jueves.',
            crm_due_date: isoDaysFromNow(2),
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(2),
            messages: [
                { role: 'user', content: 'Hola! Vi en su sitio web que tienen integración con Tango Software. ¿Cómo funciona la consulta de precios y stock?', time: isoHoursAgo(3) },
                { role: 'assistant', content: '¡Hola Martín! Qué tal. Nuestro sistema se conecta en tiempo real a las tablas de tu ERP mediante un conector seguro. Cuando un cliente te escribe, el bot consulta al instante precios vigentes, bonificaciones por cliente y stock disponible, sin intervención manual.', time: isoHoursAgo(2.9) },
                { role: 'user', content: 'Excelente. ¿Y si un cliente quiere hablar con un vendedor?', time: isoHoursAgo(2.5) },
                { role: 'assistant', content: 'El bot cuenta con derivación inteligente. Si el cliente pide asesor humano o se detecta una consulta compleja, se pausa automáticamente y transfiere la conversación a la bandeja del vendedor asignado.', time: isoHoursAgo(2.4) },
                { role: 'user', content: 'Genial, me gustaría coordinar una demo para nuestro equipo de ventas.', time: isoHoursAgo(2) }
            ]
        },
        {
            id: '5491155550102',
            name: 'Clínica Dental OdontoSalud',
            contactName: 'Dra. Valeria Gómez',
            type: 'whatsapp',
            crm_status: 'propuesta',
            tags: ['Presupuesto', 'Multi-Agente'],
            email: 'valeria@odontosalud.com.ar',
            address: 'Calle 12 N° 850, La Plata',
            cuit_dni: '27-32456789-4',
            tax_status: 'Monotributo',
            notes: '💰 *PRESUPUESTO ENVIADO*\n- Plan Pro: 5 operadores simultáneos + módulo de turnos con Google Calendar.\n- Cotización enviada: $195.000 ARS/mes.\n- Pendiente de aprobación del directorio médico.',
            crm_due_date: isoDaysFromNow(1),
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(5),
            messages: [
                { role: 'user', content: 'Hola, somos un centro odontológico y necesitamos automatizar los turnos y recordatorios de citas por WhatsApp.', time: isoHoursAgo(6) },
                { role: 'assistant', content: '¡Hola Dra. Valeria! Un gusto saludarte. Con RialWay podemos sincronizar la agenda directamente con Google Calendar o tu software médico. El bot ofrece horarios disponibles, confirma la reserva y envía recordatorios 24 hs antes de la cita para reducir el ausentismo.', time: isoHoursAgo(5.8) },
                { role: 'user', content: 'Nos sirve muchísimo. ¿Tienen plan para 5 secretarias?', time: isoHoursAgo(5.3) },
                { role: 'assistant', content: 'Sí, contamos con el Plan Pro que incluye hasta 5 puestos simultáneos en la misma línea oficial de WhatsApp, con panel de control y notas de pacientes. Te enviamos la propuesta detallada.', time: isoHoursAgo(5) }
            ]
        },
        {
            id: '5491155550103',
            name: 'ElectroHogar Express',
            contactName: 'Lucas Pereyra (Operaciones)',
            type: 'whatsapp',
            crm_status: 'ganado',
            tags: ['Alta Prioridad'],
            email: 'administracion@electrohogar.com',
            address: 'Av. Corrientes 4800, CABA',
            cuit_dni: '30-70987654-1',
            tax_status: 'Responsable Inscripto',
            notes: '⭐ *CLIENTE ACTIVO*\n- Plan Enterprise activado con éxito.\n- Módulo OCR de Mercado Pago en funcionamiento para validación instantánea de transferencias.\n- Facturación mensual automatizada.',
            crm_due_date: null,
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente_humano',
            last_message_at: isoHoursAgo(8),
            messages: [
                { role: 'user', content: 'Hola, les paso el comprobante de la transferencia para la renovación del servicio.', time: isoHoursAgo(9) },
                { role: 'user', content: '[Comprobante de Transferencia: Banco Galicia - Operación #892341 - Monto: $280.000]', time: isoHoursAgo(8.8) },
                { role: 'assistant', content: '¡Comprobante verificado con éxito! ✅ Detectamos acreditación por $280.000 (Operación #892341). Tu suscripción ha sido renovada hasta el próximo período. ¡Muchas gracias!', time: isoHoursAgo(8) }
            ]
        },
        {
            id: 'webchat_demo_carlos',
            name: 'Logística & Cargas del Sur',
            contactName: 'Carlos Benítez',
            type: 'webchat',
            crm_status: 'UNASSIGNED',
            tags: ['Webchat', 'Demo Solicitada'],
            email: 'carlos@cargasdelsur.com.ar',
            address: 'Parque Industrial Pilar, Ruta 8 Km 60',
            cuit_dni: '20-25678912-3',
            tax_status: 'Responsable Inscripto',
            notes: '🌐 *CONSULTA VÍA WEBCHAT*\n- Prospecto ingresó desde la landing page preguntando por seguimiento de envíos con webhooks.',
            crm_due_date: isoDaysFromNow(3),
            unread_count: 1,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(1),
            messages: [
                { role: 'user', content: 'Hola, vi su widget de webchat en la web. ¿El bot puede avisar a los clientes cuando su pedido sale a reparto?', time: isoHoursAgo(1.2) },
                { role: 'assistant', content: '¡Hola Carlos! Sí, totalmente. Mediante nuestra API y Webhooks, cuando tu sistema despacha un pedido, se dispara un mensaje automático al WhatsApp del destinatario con el número de guía y el día de visita.', time: isoHoursAgo(1) }
            ]
        },
        {
            id: 'ig_sofiarossi_moda',
            name: 'Moda Urbana Tienda Online',
            contactName: 'Sofía Rossi',
            type: 'instagram',
            crm_status: 'contactado',
            tags: ['Multi-Agente'],
            email: 'contacto@modaurbana.com',
            address: 'Palermo Soho, CABA',
            cuit_dni: '27-38901234-9',
            tax_status: 'Monotributo',
            notes: '👗 *TIENDA ONLINE / INSTAGRAM*\n- Reciben más de 200 DMs por día en Instagram y se les pierden mensajes.\n- Quieren centralizar Instagram Direct y WhatsApp en el mismo CRM.',
            crm_due_date: isoDaysFromNow(4),
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(7),
            messages: [
                { role: 'user', content: 'Hola chicos! Tienen forma de que mis vendedoras respondan los DMs de Instagram desde la misma pantalla que WhatsApp?', time: isoHoursAgo(8) },
                { role: 'assistant', content: '¡Hola Sofía! Sí, RialWay incluye la bandeja unificada oficial de Meta. Tanto los mensajes directos de Instagram como los chats de WhatsApp caen al mismo tablero, con el perfil del cliente y asignación a cada vendedora.', time: isoHoursAgo(7) }
            ]
        },
        {
            id: '5491155550106',
            name: 'Agroinsumos Pampeanos',
            contactName: 'Ing. Esteban Morales',
            type: 'whatsapp',
            crm_status: 'calificado',
            tags: ['Integración ERP', 'Presupuesto'],
            email: 'esteban@agropampeanos.com.ar',
            address: 'Ruta 5 Km 260, 9 de Julio, Bs.As.',
            cuit_dni: '30-68901234-7',
            tax_status: 'Responsable Inscripto',
            notes: '🌾 *AGRONEGOCIOS*\n- Necesitan enviar cotizaciones de fertilizantes y semillas en dólares y pesos.\n- Interesados en carga de pedidos con validación de crédito del cliente.',
            crm_due_date: isoDaysFromNow(2),
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(12),
            messages: [
                { role: 'user', content: 'Buenas tardes. Vendemos insumos agrícolas y los precios varían según la cotización del día y el CUIT del productor. ¿El bot puede calcular eso?', time: isoHoursAgo(13) },
                { role: 'assistant', content: '¡Buenas tardes Ingeniero Morales! Sí, exactamente. Al ingresar el CUIT del productor o su número registrado, el bot lee la condición comercial específica y cotiza al tipo de cambio oficial del día.', time: isoHoursAgo(12) }
            ]
        },
        {
            id: '5491155550107',
            name: 'Seguros & Finanzas Río Negro',
            contactName: 'Lic. Fernando Varela',
            type: 'whatsapp',
            crm_status: 'propuesta',
            tags: ['Presupuesto', 'Alta Prioridad'],
            email: 'fvarela@rionegroseguros.com.ar',
            address: 'Mitre 540, Bariloche, Río Negro',
            cuit_dni: '20-22334455-8',
            tax_status: 'Responsable Inscripto',
            notes: '📑 *SEGUROS & PÓLIZAS*\n- Propuesta de $240.000 ARS/mes enviada para atención de siniestros y cotizaciones de autos.\n- Presentación ante el directorio programada.',
            crm_due_date: isoDaysFromNow(1),
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(14),
            messages: [
                { role: 'user', content: 'Hola Fernando de RialWay, recibimos la propuesta del plan Enterprise. La vamos a revisar mañana con el directorio.', time: isoHoursAgo(15) },
                { role: 'assistant', content: '¡Excelente Fernando! Quedamos a total disposición por si surge cualquier duda técnica respecto al flujo de pólizas o la seguridad de datos.', time: isoHoursAgo(14) }
            ]
        },
        {
            id: '5491155550108',
            name: 'Mundo Mascotas Pet Shop',
            contactName: 'Camila Domínguez',
            type: 'whatsapp',
            crm_status: 'contactado',
            tags: ['Webchat'],
            email: 'camila@mundomascotas.com',
            address: 'Av. Cabildo 2200, Belgrano, CABA',
            cuit_dni: '27-35678123-1',
            tax_status: 'Monotributo',
            notes: '🐾 *PET SHOP & VETERINARIA*\n- Buscan responder preguntas frecuentes 24/7 (marcas de alimento, horarios de atención, guardias).',
            crm_due_date: isoDaysFromNow(5),
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(18),
            messages: [
                { role: 'user', content: 'Hola! Nos escriben mucha gente a la noche preguntando si tenemos alimentos específicos o turnos para baño y peluquería.', time: isoHoursAgo(19) },
                { role: 'assistant', content: '¡Hola Camila! Qué alegría saludarte. RialWay responde de inmediato sin importar la hora, verifica la disponibilidad de turnos o productos y deja todo listo en el CRM para cuando abras tu local al día siguiente.', time: isoHoursAgo(18) }
            ]
        },
        {
            id: '5491155550109',
            name: 'Servicios Industriales Metalmecánica',
            contactName: 'Roberto Gutiérrez',
            type: 'whatsapp',
            crm_status: 'UNASSIGNED',
            tags: ['Demo Solicitada'],
            email: 'roberto@metalmecanica.com.ar',
            address: 'Zona Industrial Quilmes Oeste',
            cuit_dni: '20-18456789-2',
            tax_status: 'Responsable Inscripto',
            notes: '⚙️ *PROSPECTO NUEVO*\n- Ingresó solicitando demostración del módulo de órdenes de trabajo.',
            crm_due_date: isoDaysFromNow(3),
            unread_count: 1,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(0.5),
            messages: [
                { role: 'user', content: 'Hola, me pasaron el contacto de RialWay. Queremos digitalizar la atención de presupuestos para talleres mecánicos.', time: isoHoursAgo(0.5) }
            ]
        },
        {
            id: '5491155550110',
            name: 'Constructora Del Plata',
            contactName: 'Arq. Mariana Solís',
            type: 'whatsapp',
            crm_status: 'ganado',
            tags: ['Integración ERP'],
            email: 'msolis@constructoradelplata.com.ar',
            address: 'Puerto Madero, CABA',
            cuit_dni: '30-71998877-5',
            tax_status: 'Responsable Inscripto',
            notes: '🏗️ *CLIENTE GANADO*\n- 10 líneas oficiales integradas para atención de proveedores y propietarios de desarrollos inmobiliarios.',
            crm_due_date: null,
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente_humano',
            last_message_at: isoHoursAgo(22),
            messages: [
                { role: 'user', content: 'Equipo de soporte de RialWay, excelente la implementación del nuevo menú para proveedores. Muy conformes.', time: isoHoursAgo(23) },
                { role: 'assistant', content: '¡Muchas gracias Arq. Mariana! Nos alegra muchísimo saberlo. Seguimos monitoreando la línea ante cualquier requerimiento adicional.', time: isoHoursAgo(22) }
            ]
        },
        {
            id: '5491155550111',
            name: 'Farmacia y Perfumería Central',
            contactName: 'Javier Mendez',
            type: 'whatsapp',
            crm_status: 'perdido',
            tags: [],
            email: 'compras@farmaciacentral.com.ar',
            address: 'San Martín 120, Quilmes',
            cuit_dni: '20-29112233-4',
            tax_status: 'Responsable Inscripto',
            notes: '⏸️ *PAUSADO*\n- El cliente postergó la contratación para el próximo trimestre por cambio de autoridades.',
            crm_due_date: null,
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(36),
            messages: [
                { role: 'user', content: 'Hola, por el momento pausamos el proyecto de chatbot hasta fin de año por presupuesto interno. Les agradezco la atención.', time: isoHoursAgo(37) },
                { role: 'assistant', content: 'Entendido Javier. Muchísimas gracias por avisarnos. Quedamos en contacto para retomar cuando lo consideren oportuno. ¡Saludos cordiales!', time: isoHoursAgo(36) }
            ]
        },
        {
            id: 'webchat_demo_andres',
            name: 'Consultora Tech & Cloud',
            contactName: 'Andrés Ibarra',
            type: 'webchat',
            crm_status: 'calificado',
            tags: ['Demo Solicitada', 'Multi-Agente'],
            email: 'andres@techcloudconsulting.com',
            address: 'Córdoba Capital',
            cuit_dni: '20-33445566-7',
            tax_status: 'Responsable Inscripto',
            notes: '🚀 *DEMO TÉCNICA AGENDADA*\n- Requisitos: Integración multi-agente, derivación por habilidades y webhooks en vivo.',
            crm_due_date: isoDaysFromNow(1),
            unread_count: 0,
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: isoHoursAgo(4),
            messages: [
                { role: 'user', content: 'Hola! Estamos evaluando soluciones de CRM con WhatsApp para nuestros clientes corporativos. ¿Ofrecen esquema de marca blanca o partners?', time: isoHoursAgo(4.5) },
                { role: 'assistant', content: '¡Hola Andrés! Sí, contamos con programas para consultoras y agencias integradoras, permitiendo desplegar instancias personalizadas para cada cliente final con API abierta.', time: isoHoursAgo(4) }
            ]
        }
    ];

    console.log(`📥 [demoSeeder] Insertando ${demoLeads.length} leads modelo con historial y tickets...`);

    for (const lead of demoLeads) {
        // A. Insertar Chat
        const chatInsert = {
            id: lead.id,
            user_id: lead.id,
            project_id: projectId,
            service_id: serviceId,
            type: lead.type,
            name: lead.name,
            bot_enabled: lead.bot_enabled,
            last_message_at: lead.last_message_at,
            notes: lead.notes,
            email: lead.email,
            source: lead.type === 'webchat' ? 'Webchat Oficial' : (lead.type === 'instagram' ? 'Instagram Direct' : 'WhatsApp Comercial'),
            is_lead: true,
            cuit_dni: lead.cuit_dni,
            tax_status: lead.tax_status,
            address: lead.address,
            assigned_agent: lead.assigned_agent,
            crm_status: lead.crm_status,
            crm_due_date: lead.crm_due_date,
            unread_count: lead.unread_count,
            metadata: {
                demo_lead: true,
                contact_person: lead.contactName
            }
        };

        const { error: chatErr } = await supabase.from('chats').insert(chatInsert);
        if (chatErr) {
            console.error(`❌ Error insertando chat ${lead.id}:`, chatErr.message);
            continue;
        }

        // B. Insertar Ticket de CRM correspondiente
        const ticketInsert = {
            chat_id: lead.id,
            project_id: projectId,
            service_id: serviceId,
            titulo: `Lead: ${lead.name}`,
            descripcion: lead.notes,
            estado: lead.crm_status,
            prioridad: lead.tags.includes('Alta Prioridad') ? 'Alta' : 'Media',
            tipo: 'Nuevo Lead',
            created_at: lead.last_message_at,
            updated_at: lead.last_message_at,
            read_admin_count: 0,
            attachments: '[]',
            chats_adjuntos: '[]'
        };

        const { error: tktErr } = await supabase.from('tickets').insert(ticketInsert);
        if (tktErr) {
            console.error(`❌ Error insertando ticket para ${lead.id}:`, tktErr.message);
        }

        // C. Asociar Tags en chat_tags
        for (const tagName of lead.tags) {
            const tagId = tagMap.get(tagName);
            if (tagId) {
                await supabase.from('chat_tags').insert({
                    chat_id: lead.id,
                    tag_id: tagId,
                    project_id: projectId,
                    service_id: serviceId
                });
            }
        }

        // D. Insertar Mensajes de la conversación
        for (const msg of lead.messages) {
            await supabase.from('messages').insert({
                chat_id: lead.id,
                project_id: projectId,
                service_id: serviceId,
                role: msg.role,
                content: msg.content,
                created_at: msg.time,
                type: 'text'
            });
        }
    }

    console.log(`✅ [demoSeeder] Sembrado completado exitosamente con ${demoLeads.length} leads.`);
    return {
        success: true,
        message: 'Entorno de demostración inicializado correctamente',
        leadsCount: demoLeads.length
    };
}

// Ejecutar directamente si es invocado como script
if (process.argv[1]?.includes('demoSeeder')) {
    seedDemoService()
        .then(res => {
            console.log('Resultado del sembrado:', res);
            process.exit(0);
        })
        .catch(err => {
            console.error('Error durante el sembrado:', err);
            process.exit(1);
        });
}
