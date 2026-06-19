import { google } from "googleapis";
import { createGoogleAuth } from "./googleAuth";

const auth = createGoogleAuth(["https://www.googleapis.com/auth/calendar"]);

const calendar = google.calendar({ version: "v3", auth });
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

export class CalendarEvents {
    static async createEvent(eventData: any) {
        const res = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            requestBody: eventData,
        });
        return res.data;
    }

    static async updateEvent(eventId: string, eventData: any) {
        const res = await calendar.events.update({
            calendarId: CALENDAR_ID,
            eventId,
            requestBody: eventData,
        });
        return res.data;
    }

    static async deleteEvent(eventId: string) {
        await calendar.events.delete({
            calendarId: CALENDAR_ID,
            eventId,
        });
        return { success: true };
    }

    static async checkAvailability(start: string, end: string) {
        // start y end deben ser ISO strings (ej: '2025-11-18T10:00:00Z')
        const res = await calendar.freebusy.query({
            requestBody: {
                timeMin: start,
                timeMax: end,
                items: [{ id: CALENDAR_ID }],
            },
        });
        // Devuelve los periodos ocupados en ese rango
        return res.data.calendars![CALENDAR_ID]?.busy || [];
    }

    static async testCalendarAccess() {
        try {
            const res = await calendar.events.list({
                calendarId: CALENDAR_ID,
                maxResults: 1,
            });
            // console.log("[TEST CALENDAR] Eventos encontrados:", res.data.items);
            return res.data.items;
        } catch (err) {
            // console.error("[TEST CALENDAR] Error accediendo al calendario:", err);
            return null;
        }
    }
}
