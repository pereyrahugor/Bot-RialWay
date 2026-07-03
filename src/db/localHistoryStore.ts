import fs from "fs";
import path from "path";
import crypto from "crypto";

const STORE_DIR = "local_store";

// Helper to ensure the local_store directory exists
function ensureStoreDir() {
    if (!fs.existsSync(STORE_DIR)) {
        fs.mkdirSync(STORE_DIR, { recursive: true });
    }
}

// Helpers to read and write JSON files safely
function readJsonFile<T>(fileName: string, defaultValue: T): T {
    ensureStoreDir();
    const filePath = path.join(STORE_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        return defaultValue;
    }
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as T;
    } catch (e) {
        console.error(`⚠️ [LocalHistoryStore] Error leyendo archivo local ${fileName}:`, e);
        return defaultValue;
    }
}

function writeJsonFile<T>(fileName: string, data: T) {
    ensureStoreDir();
    const filePath = path.join(STORE_DIR, fileName);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.error(`❌ [LocalHistoryStore] Error escribiendo archivo local ${fileName}:`, e);
    }
}

// Interfaces
export interface LocalChat {
    id: string;
    project_id: string;
    type: string;
    name: string | null;
    bot_enabled: boolean;
    assigned_agent: string;
    last_message_at: string;
    last_human_message_at: string | null;
    metadata: any;
    notes?: string | null;
    email?: string | null;
    source?: string | null;
    crm_status?: string | null;
    crm_due_date?: string | null;
    is_lead?: boolean;
    last_db_result?: string | null;
    assigned_to?: string | null;
    unread_count?: number;
    cuit_dni?: string | null;
    address?: string | null;
    tax_status?: string | null;
    offered_product?: string | null;
}

export interface LocalMessage {
    id: string;
    chat_id: string;
    project_id: string;
    role: string;
    content: string;
    type: string;
    external_id: string | null;
    created_at: string;
}

export interface LocalTicket {
    id: string;
    project_id: string;
    chat_id: string;
    titulo: string;
    descripcion: string | null;
    tipo: string;
    estado: string;
    prioridad: string;
    attachments: string[];
    chats_adjuntos: { chat_id: string; name: string }[];
    created_at: string;
    updated_at: string;
}

export interface LocalTag {
    id: string;
    project_id: string;
    name: string;
    color: string;
    created_at: string;
}

export interface LocalChatTag {
    chat_id: string;
    tag_id: string;
    project_id: string;
}

export class LocalHistoryStore {
    // --- CHATS METHODS ---

    static getChatsFile(projectId: string): string {
        return `chats_${projectId}.json`;
    }

    static getChats(projectId: string): LocalChat[] {
        return readJsonFile<LocalChat[]>(this.getChatsFile(projectId), []);
    }

    static saveChats(projectId: string, chats: LocalChat[]) {
        writeJsonFile(this.getChatsFile(projectId), chats);
    }

    static async getChat(chatId: string, projectId: string): Promise<LocalChat | null> {
        const chats = this.getChats(projectId);
        return chats.find(c => c.id === chatId) || null;
    }

    static async getOrCreateChat(
        chatId: string,
        type: string,
        name: string | null,
        userId: string | null,
        projectId: string
    ): Promise<LocalChat> {
        const chats = this.getChats(projectId);
        let chat = chats.find(c => c.id === chatId);
        if (!chat) {
            chat = {
                id: chatId,
                project_id: projectId,
                type: type,
                name: name,
                bot_enabled: true,
                assigned_agent: "asistente1",
                last_message_at: new Date().toISOString(),
                last_human_message_at: null,
                metadata: {},
                notes: null,
                email: null,
                source: null,
                crm_status: null,
                crm_due_date: null,
                is_lead: false,
                last_db_result: null,
                assigned_to: userId,
                unread_count: 0
            };
            chats.push(chat);
            this.saveChats(projectId, chats);
        }
        return chat;
    }

    static async updateContactDetails(
        chatId: string,
        details: Partial<LocalChat>,
        projectId: string
    ): Promise<boolean> {
        const chats = this.getChats(projectId);
        const idx = chats.findIndex(c => c.id === chatId);
        if (idx !== -1) {
            const originalCrmStatus = details.crm_status;
            const originalIsLead = details.is_lead;

            if (details.crm_status === 'Cerrado') {
                details.assigned_agent = 'asistente1';
                details.bot_enabled = true;
                details.last_db_result = null;
                details.is_lead = false;
                details.crm_status = null;
            }

            chats[idx] = { ...chats[idx], ...details };
            this.saveChats(projectId, chats);

            // --- SINCRONIZACIÓN DUAL DE INSTANCIAS (LID <-> Teléfono) LOCAL ---
            try {
                const metadata = chats[idx].metadata || {};
                let companionId: string | null = null;
                if (metadata.lid) {
                    companionId = metadata.lid.split('@')[0];
                } else if (metadata.phone_jid) {
                    companionId = metadata.phone_jid.split('@')[0];
                } else {
                    const phoneChat = chats.find(c => c.metadata && c.metadata.lid === `${chatId}@lid`);
                    if (phoneChat) companionId = phoneChat.id;
                }

                if (companionId && companionId !== chatId) {
                    const compIdx = chats.findIndex(c => c.id === companionId);
                    if (compIdx !== -1) {
                        const syncDetails = { ...details };
                        delete syncDetails.metadata; // Preservar metadatos separados
                        chats[compIdx] = { ...chats[compIdx], ...syncDetails };
                        this.saveChats(projectId, chats);
                    }
                }
            } catch (syncErr: any) {
                console.error(`[LocalHistoryStore] Error en sincronización dual LID/Teléfono:`, syncErr.message);
            }

            const tickets = this.getTicketsList(projectId);
            const activeTicketIdx = tickets.findIndex(t => t.chat_id === chatId && t.estado !== 'Cerrado');

            if (activeTicketIdx !== -1) {
                if (details.notes !== undefined) {
                    tickets[activeTicketIdx].descripcion = details.notes;
                }
                if (originalCrmStatus) {
                    tickets[activeTicketIdx].estado = originalCrmStatus;
                }
                tickets[activeTicketIdx].updated_at = new Date().toISOString();
                this.saveTicketsList(projectId, tickets);
            } else if (details.is_lead === true || originalIsLead === true) {
                console.log(`[LocalHistoryStore] 🎟️ Auto-creating ticket for lead: ${chatId}`);
                const initialStatus = originalCrmStatus || 'Abierto';
                const newTicket: LocalTicket = {
                    id: crypto.randomUUID(),
                    project_id: projectId,
                    chat_id: chatId,
                    titulo: `Lead: ${chats[idx].name || chatId}`,
                    descripcion: details.notes || 'Lead detectado automáticamente',
                    estado: initialStatus,
                    prioridad: 'Media',
                    tipo: 'Nuevo Lead',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    attachments: [],
                    chats_adjuntos: []
                };
                tickets.push(newTicket);
                this.saveTicketsList(projectId, tickets);
            }
            return true;
        }
        return false;
    }

    static async toggleBot(chatId: string, enabled: boolean, projectId: string): Promise<boolean> {
        return this.updateContactDetails(chatId, { bot_enabled: enabled }, projectId);
    }

    static async updateLastHumanMessage(chatId: string, projectId: string): Promise<boolean> {
        return this.updateContactDetails(chatId, { last_human_message_at: new Date().toISOString() }, projectId);
    }

    static async updateLastDbResult(chatId: string, result: string, projectId: string): Promise<boolean> {
        return this.updateContactDetails(chatId, { last_db_result: result }, projectId);
    }

    static async listChats(
        limit: number,
        offset: number,
        search: string | undefined,
        tagId: string | undefined,
        assignedTo: string | null | undefined,
        platform: string | undefined,
        projectId: string
    ) {
        let chats = this.getChats(projectId);

        // Filter by platform
        if (platform && platform !== "all") {
            chats = chats.filter(c => c.type === platform);
        }

        // Filter by search text
        if (search) {
            const query = search.toLowerCase();
            chats = chats.filter(c => 
                (c.name && c.name.toLowerCase().includes(query)) ||
                c.id.toLowerCase().includes(query) ||
                (c.email && c.email.toLowerCase().includes(query)) ||
                (c.notes && c.notes.toLowerCase().includes(query))
            );
        }

        // Filter by tag
        if (tagId) {
            const chatTags = this.getChatTagsForProject(projectId);
            const chatIdsWithTag = chatTags.filter(ct => ct.tag_id === tagId).map(ct => ct.chat_id);
            chats = chats.filter(c => chatIdsWithTag.includes(c.id));
        }

        // Filter by assigned user
        if (assignedTo !== undefined) {
            chats = chats.filter(c => c.assigned_to === assignedTo);
        }

        // Sort by last message at descending
        chats.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

        const totalCount = chats.length;
        const pageData = chats.slice(offset, offset + limit);

        return {
            data: pageData,
            count: totalCount
        };
    }

    // --- MESSAGES METHODS ---

    static getMessagesFile(projectId: string): string {
        return `messages_${projectId}.json`;
    }

    static getMessagesList(projectId: string): LocalMessage[] {
        return readJsonFile<LocalMessage[]>(this.getMessagesFile(projectId), []);
    }

    static saveMessagesList(projectId: string, messages: LocalMessage[]) {
        writeJsonFile(this.getMessagesFile(projectId), messages);
    }

    static async saveMessage(
        chatId: string,
        role: string,
        content: string,
        type: string,
        contactName: string | null,
        userId: string | null,
        externalId: string | null,
        projectId: string
    ): Promise<LocalMessage> {
        // Ensure chat exists
        const chat = await this.getOrCreateChat(chatId, "whatsapp", contactName, userId, projectId);
        
        // Update chat's last message time and unread count
        const nowStr = new Date().toISOString();
        const updateData: Partial<LocalChat> = { last_message_at: nowStr };
        if (role === 'user') {
            updateData.unread_count = (chat.unread_count || 0) + 1;
        }
        await this.updateContactDetails(chatId, updateData, projectId);

        const messages = this.getMessagesList(projectId);
        const newMessage: LocalMessage = {
            id: crypto.randomUUID(),
            chat_id: chatId,
            project_id: projectId,
            role: role,
            content: content,
            type: type,
            external_id: externalId,
            created_at: nowStr
        };

        messages.push(newMessage);
        this.saveMessagesList(projectId, messages);
        return newMessage;
    }

    static async getMessages(chatId: string, limit: number, offset: number, projectId: string): Promise<LocalMessage[]> {
        const messages = this.getMessagesList(projectId);
        const filtered = messages.filter(m => m.chat_id === chatId);
        
        // Sort by created_at descending
        filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        return filtered.slice(offset, offset + limit);
    }

    static async deleteMessage(messageId: string, projectId: string): Promise<boolean> {
        const messages = this.getMessagesList(projectId);
        const filtered = messages.filter(m => m.id !== messageId && m.external_id !== messageId);
        if (filtered.length !== messages.length) {
            this.saveMessagesList(projectId, filtered);
            return true;
        }
        return false;
    }

    static async clearChatHistory(chatId: string, projectId: string): Promise<boolean> {
        const messages = this.getMessagesList(projectId);
        const filtered = messages.filter(m => m.chat_id !== chatId);
        
        // Ponemos el unread_count en 0
        const chats = this.getChats(projectId);
        const idx = chats.findIndex(c => c.id === chatId);
        if (idx !== -1) {
            chats[idx].unread_count = 0;
            this.saveChats(projectId, chats);
        }

        if (filtered.length !== messages.length) {
            this.saveMessagesList(projectId, filtered);
            return true;
        }
        return false;
    }

    // --- TICKETS METHODS ---

    static getTicketsFile(projectId: string): string {
        return `tickets_${projectId}.json`;
    }

    static getTicketsList(projectId: string): LocalTicket[] {
        return readJsonFile<LocalTicket[]>(this.getTicketsFile(projectId), []);
    }

    static saveTicketsList(projectId: string, tickets: LocalTicket[]) {
        writeJsonFile(this.getTicketsFile(projectId), tickets);
    }

    static async createTicket(
        chatId: string,
        titulo: string,
        descripcion: string,
        tipo: string,
        prioridad: string,
        projectId: string,
        attachments: string[] = [],
        chats_adjuntos: { chat_id: string; name: string }[] = []
    ): Promise<LocalTicket> {
        const tickets = this.getTicketsList(projectId);
        const newTicket: LocalTicket = {
            id: crypto.randomUUID(),
            project_id: projectId,
            chat_id: chatId,
            titulo,
            descripcion,
            tipo,
            estado: 'Abierto',
            prioridad,
            attachments,
            chats_adjuntos,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        tickets.push(newTicket);
        this.saveTicketsList(projectId, tickets);
        return newTicket;
    }

    static async listTickets(
        limit: number,
        offset: number,
        estado: string | undefined,
        tipo: string | undefined,
        chatId: string | undefined,
        ticketId: string | undefined,
        projectId: string
    ) {
        let tickets = this.getTicketsList(projectId);

        if (estado && estado !== "all" && estado !== 'null' && estado !== 'undefined' && estado !== '') {
            if (estado.includes(',')) {
                const list = estado.split(',').map(s => s.toLowerCase());
                tickets = tickets.filter(t => list.includes(t.estado.toLowerCase()));
            } else if (estado === 'all_active') {
                tickets = tickets.filter(t => t.estado.toLowerCase() !== 'cerrado');
            } else {
                tickets = tickets.filter(t => t.estado.toLowerCase() === estado.toLowerCase());
            }
        }
        if (tipo && tipo !== "all") {
            tickets = tickets.filter(t => t.tipo.toLowerCase() === tipo.toLowerCase());
        }
        if (chatId) {
            tickets = tickets.filter(t => t.chat_id === chatId);
        }
        if (ticketId) {
            tickets = tickets.filter(t => t.id === ticketId);
        }

        // Sort by created_at descending
        tickets.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        const totalCount = tickets.length;
        const pageData = tickets.slice(offset, offset + limit);

        // Map tickets with contact name for backoffice CRM
        const chats = this.getChats(projectId);
        const enrichedData = pageData.map(ticket => {
            const contact = chats.find(c => c.id === ticket.chat_id);
            return {
                ...ticket,
                contacto_nombre: contact ? contact.name : "Desconocido",
                contacto_telefono: ticket.chat_id
            };
        });

        return {
            data: enrichedData,
            count: totalCount
        };
    }

    static async getPendingTicketsCount(tipo: string | undefined, projectId: string): Promise<number> {
        const tickets = this.getTicketsList(projectId);
        let filtered = tickets.filter(t => t.estado.toLowerCase() === "abierto");
        if (tipo && tipo !== "all") {
            filtered = filtered.filter(t => t.tipo.toLowerCase() === tipo.toLowerCase());
        }
        return filtered.length;
    }

    static async getActiveTicketForContact(chatId: string, projectId: string): Promise<LocalTicket | null> {
        const tickets = this.getTicketsList(projectId);
        return tickets.find(t => t.chat_id === chatId && t.estado.toLowerCase() === "abierto") || null;
    }

    static async updateTicketDescription(ticketId: string, descripcion: string, projectId: string): Promise<boolean> {
        const tickets = this.getTicketsList(projectId);
        const idx = tickets.findIndex(t => t.id === ticketId);
        if (idx !== -1) {
            tickets[idx].descripcion = descripcion;
            tickets[idx].updated_at = new Date().toISOString();
            this.saveTicketsList(projectId, tickets);
            return true;
        }
        return false;
    }

    static async updateTicketStatus(ticketId: string, nuevoEstado: string, projectId: string): Promise<boolean> {
        const tickets = this.getTicketsList(projectId);
        const idx = tickets.findIndex(t => t.id === ticketId);
        if (idx !== -1) {
            tickets[idx].estado = nuevoEstado;
            tickets[idx].updated_at = new Date().toISOString();
            this.saveTicketsList(projectId, tickets);
            return true;
        }
        return false;
    }

    static async deleteTicket(ticketId: string, projectId: string): Promise<boolean> {
        const tickets = this.getTicketsList(projectId);
        const idx = tickets.findIndex(t => t.id === ticketId);
        if (idx !== -1) {
            const chatId = tickets[idx].chat_id;
            tickets.splice(idx, 1);
            this.saveTicketsList(projectId, tickets);

            if (chatId) {
                await this.updateContactDetails(chatId, {
                    is_lead: false,
                    crm_status: null,
                    assigned_agent: 'asistente1',
                    bot_enabled: true,
                    last_db_result: null
                }, projectId);
            }

            return true;
        }
        return false;
    }

    static async updateLeadAndTicket(ticketId: string, details: any, projectId: string): Promise<boolean> {
        const tickets = this.getTicketsList(projectId);
        const idx = tickets.findIndex(t => t.id === ticketId);
        if (idx !== -1) {
            if (details.titulo) tickets[idx].titulo = details.titulo;
            if (details.descripcion) tickets[idx].descripcion = details.descripcion;
            if (details.tipo) tickets[idx].tipo = details.tipo;
            
            const priorityVal = details.priority || details.prioridad;
            if (priorityVal) tickets[idx].prioridad = priorityVal;
            
            const contactDetails = details.contact || {};
            
            if (details.estado) {
                tickets[idx].estado = details.estado;
            } else if (contactDetails.crm_status) {
                tickets[idx].estado = contactDetails.crm_status;
            }
            tickets[idx].updated_at = new Date().toISOString();
            this.saveTicketsList(projectId, tickets);

            // Also update contact details in chats (for leads)
            const chatId = tickets[idx].chat_id;
            const contactUpdate: Partial<LocalChat> = {};

            if (details.contacto_nombre || contactDetails.name) contactUpdate.name = details.contacto_nombre || contactDetails.name;
            if (details.contacto_email || contactDetails.email) contactUpdate.email = details.contacto_email || contactDetails.email;
            if (details.contacto_notas || contactDetails.notes || details.notes || details.notas) contactUpdate.notes = details.contacto_notas || contactDetails.notes || details.notes || details.notas;
            if (details.crm_status || contactDetails.crm_status) contactUpdate.crm_status = details.crm_status || contactDetails.crm_status;
            if (details.crm_due_date || contactDetails.crm_due_date) contactUpdate.crm_due_date = details.crm_due_date || contactDetails.crm_due_date;
            if (details.is_lead !== undefined || contactDetails.is_lead !== undefined) {
                contactUpdate.is_lead = details.is_lead !== undefined ? details.is_lead : contactDetails.is_lead;
            }
            if (contactDetails.cuit_dni !== undefined) contactUpdate.cuit_dni = contactDetails.cuit_dni;
            if (contactDetails.address !== undefined) contactUpdate.address = contactDetails.address;
            if (contactDetails.tax_status !== undefined) contactUpdate.tax_status = contactDetails.tax_status;
            if (contactDetails.offered_product !== undefined) contactUpdate.offered_product = contactDetails.offered_product;
            if (contactDetails.source !== undefined) contactUpdate.source = contactDetails.source;

            if (tickets[idx].estado === 'Cerrado') {
                contactUpdate.assigned_agent = 'asistente1';
                contactUpdate.bot_enabled = true;
                contactUpdate.last_db_result = null;
                contactUpdate.is_lead = false;
                contactUpdate.crm_status = null;
            }

            if (Object.keys(contactUpdate).length > 0) {
                await this.updateContactDetails(chatId, contactUpdate, projectId);
            }

            return true;
        }
        return false;
    }

    static async listEditedLeads(limit: number, offset: number, projectId: string) {
        const chats = this.getChats(projectId);
        const leads = chats.filter(c => c.is_lead === true);

        // Sort by last message DESC
        leads.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

        const totalCount = leads.length;
        const pageData = leads.slice(offset, offset + limit);

        return {
            data: pageData,
            count: totalCount
        };
    }

    // --- TAGS METHODS ---

    static getTagsFile(projectId: string): string {
        return `tags_${projectId}.json`;
    }

    static getTagsList(projectId: string): LocalTag[] {
        return readJsonFile<LocalTag[]>(this.getTagsFile(projectId), []);
    }

    static saveTagsList(projectId: string, tags: LocalTag[]) {
        writeJsonFile(this.getTagsFile(projectId), tags);
    }

    static getChatTagsFile(projectId: string): string {
        return `chat_tags_${projectId}.json`;
    }

    static getChatTagsForProject(projectId: string): LocalChatTag[] {
        return readJsonFile<LocalChatTag[]>(this.getChatTagsFile(projectId), []);
    }

    static saveChatTagsForProject(projectId: string, chatTags: LocalChatTag[]) {
        writeJsonFile(this.getChatTagsFile(projectId), chatTags);
    }

    static async ensureTagExists(tagName: string, projectId: string): Promise<string | null> {
        const tags = this.getTagsList(projectId);
        let tag = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
        if (!tag) {
            tag = {
                id: crypto.randomUUID(),
                project_id: projectId,
                name: tagName,
                color: "#6366f1",
                created_at: new Date().toISOString()
            };
            tags.push(tag);
            this.saveTagsList(projectId, tags);
        }
        return tag.id;
    }

    static async getTags(projectId: string): Promise<LocalTag[]> {
        return this.getTagsList(projectId);
    }

    static async createTag(name: string, color: string, projectId: string): Promise<LocalTag> {
        const tags = this.getTagsList(projectId);
        const newTag: LocalTag = {
            id: crypto.randomUUID(),
            project_id: projectId,
            name: name,
            color: color,
            created_at: new Date().toISOString()
        };
        tags.push(newTag);
        this.saveTagsList(projectId, tags);
        return newTag;
    }

    static async updateTag(tagId: string, name: string, color: string, projectId: string): Promise<boolean> {
        const tags = this.getTagsList(projectId);
        const idx = tags.findIndex(t => t.id === tagId);
        if (idx !== -1) {
            tags[idx].name = name;
            tags[idx].color = color;
            this.saveTagsList(projectId, tags);
            return true;
        }
        return false;
    }

    static async deleteTag(tagId: string, projectId: string): Promise<boolean> {
        const tags = this.getTagsList(projectId);
        const filteredTags = tags.filter(t => t.id !== tagId);
        if (filteredTags.length !== tags.length) {
            this.saveTagsList(projectId, filteredTags);

            // Also clean associations in chat_tags
            const chatTags = this.getChatTagsForProject(projectId);
            const filteredChatTags = chatTags.filter(ct => ct.tag_id !== tagId);
            this.saveChatTagsForProject(projectId, filteredChatTags);
            return true;
        }
        return false;
    }

    static async addTagToChat(chatId: string, tagId: string, projectId: string): Promise<boolean> {
        const chatTags = this.getChatTagsForProject(projectId);
        const exists = chatTags.some(ct => ct.chat_id === chatId && ct.tag_id === tagId);
        if (!exists) {
            chatTags.push({ chat_id: chatId, tag_id: tagId, project_id: projectId });
            this.saveChatTagsForProject(projectId, chatTags);
            return true;
        }
        return false;
    }

    static async removeTagFromChat(chatId: string, tagId: string, projectId: string): Promise<boolean> {
        const chatTags = this.getChatTagsForProject(projectId);
        const filtered = chatTags.filter(ct => !(ct.chat_id === chatId && ct.tag_id === tagId));
        if (filtered.length !== chatTags.length) {
            this.saveChatTagsForProject(projectId, filtered);
            return true;
        }
        return false;
    }

    static async getChatTags(chatId: string, projectId: string): Promise<LocalTag[]> {
        const chatTags = this.getChatTagsForProject(projectId);
        const tagIds = chatTags.filter(ct => ct.chat_id === chatId).map(ct => ct.tag_id);
        const tags = this.getTagsList(projectId);
        return tags.filter(t => tagIds.includes(t.id));
    }

    static async assignTagsToContact(chatId: string, tagsList: string[], projectId: string) {
        // Clear old tags
        const chatTags = this.getChatTagsForProject(projectId);
        const filtered = chatTags.filter(ct => ct.chat_id !== chatId);

        // Add new tags
        for (const tagName of tagsList) {
            const tagId = await this.ensureTagExists(tagName, projectId);
            if (tagId) {
                filtered.push({ chat_id: chatId, tag_id: tagId, project_id: projectId });
            }
        }
        this.saveChatTagsForProject(projectId, filtered);
    }

    // --- QUICK MESSAGES METHODS ---

    static getQuickMessagesFile(projectId: string): string {
        return `quick_messages_${projectId}.json`;
    }

    static getQuickMessages(projectId: string): any[] {
        return readJsonFile<any[]>(this.getQuickMessagesFile(projectId), []);
    }

    static saveQuickMessages(projectId: string, quickMessages: any[]) {
        writeJsonFile(this.getQuickMessagesFile(projectId), quickMessages);
    }

    static async createQuickMessage(projectId: string, title: string, message: string): Promise<any> {
        const quickMessages = this.getQuickMessages(projectId);
        const newQM = {
            id: crypto.randomUUID(),
            project_id: projectId,
            title,
            message,
            created_at: new Date().toISOString()
        };
        quickMessages.push(newQM);
        this.saveQuickMessages(projectId, quickMessages);
        return newQM;
    }

    static async deleteQuickMessage(id: string, projectId: string): Promise<boolean> {
        const quickMessages = this.getQuickMessages(projectId);
        const filtered = quickMessages.filter(qm => qm.id !== id);
        if (filtered.length !== quickMessages.length) {
            this.saveQuickMessages(projectId, filtered);
            return true;
        }
        return false;
    }
}
