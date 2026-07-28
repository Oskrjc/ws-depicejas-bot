import { google, calendar_v3 } from "googleapis";
import { config } from "./config";
import { businessConfig } from "./businessConfig";

let calendarClient: calendar_v3.Calendar | null = null;

function getClient(): calendar_v3.Calendar {
  if (calendarClient) return calendarClient;

  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleServiceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  calendarClient = google.calendar({ version: "v3", auth });
  return calendarClient;
}

export interface FreeSlot {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

/**
 * Devuelve los huecos libres del día dado, respetando el horario de
 * atención definido en businessConfig y la duración del servicio.
 * `dateISO` es una fecha "YYYY-MM-DD" en la zona horaria del negocio.
 */
export async function checkAvailability(
  dateISO: string,
  durationMinutes: number = businessConfig.defaultAppointmentDurationMinutes
): Promise<FreeSlot[]> {
  const dayOfWeek = new Date(`${dateISO}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: businessConfig.timezone,
  }).toLowerCase();

  const hours = (businessConfig.businessHours as any)[dayOfWeek];
  if (!hours) return []; // día cerrado

  const dayStart = zonedTimeToUtcISO(dateISO, hours.open);
  const dayEnd = zonedTimeToUtcISO(dateISO, hours.close);

  const client = getClient();
  const busyResp = await client.freebusy.query({
    requestBody: {
      timeMin: dayStart,
      timeMax: dayEnd,
      timeZone: businessConfig.timezone,
      items: [{ id: config.googleCalendarId }],
    },
  });

  const busySlots =
    busyResp.data.calendars?.[config.googleCalendarId]?.busy?.map((b) => ({
      start: new Date(b.start as string).getTime(),
      end: new Date(b.end as string).getTime(),
    })) ?? [];

  const slotMs = durationMinutes * 60 * 1000;
  const free: FreeSlot[] = [];

  let cursor = new Date(dayStart).getTime();
  const end = new Date(dayEnd).getTime();

  while (cursor + slotMs <= end) {
    const slotStart = cursor;
    const slotEnd = cursor + slotMs;

    const overlaps = busySlots.some((b) => slotStart < b.end && slotEnd > b.start);
    if (!overlaps) {
      free.push({
        start: new Date(slotStart).toISOString(),
        end: new Date(slotEnd).toISOString(),
      });
    }

    cursor += slotMs;
  }

  return free;
}

export interface BookAppointmentInput {
  startISO: string;
  endISO: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  notes?: string;
}

export interface BookedAppointment {
  eventId: string;
  htmlLink: string | null | undefined;
}

/** Crea una cita en el calendario. */
export async function bookAppointment(input: BookAppointmentInput): Promise<BookedAppointment> {
  const client = getClient();

  const event = await client.events.insert({
    calendarId: config.googleCalendarId,
    requestBody: {
      summary: `${input.serviceName} — ${input.clientName} (pendiente de abono)`,
      description: [
        `Cliente: ${input.clientName}`,
        `Teléfono: ${input.clientPhone}`,
        input.notes ? `Notas: ${input.notes}` : null,
        "Agendado automáticamente vía WhatsApp. Pendiente el abono del 20% (coordinar directamente con el cliente).",
      ]
        .filter(Boolean)
        .join("\n"),
      start: { dateTime: input.startISO, timeZone: businessConfig.timezone },
      end: { dateTime: input.endISO, timeZone: businessConfig.timezone },
      extendedProperties: {
        private: {
          clientPhone: input.clientPhone,
          reminderSent: "false",
          depositPaid: "false",
          source: "whatsapp-bot",
        },
      },
    },
  });

  return { eventId: event.data.id as string, htmlLink: event.data.htmlLink };
}

/** Cancela (elimina) una cita existente. */
export async function cancelAppointment(eventId: string): Promise<void> {
  const client = getClient();
  await client.events.delete({
    calendarId: config.googleCalendarId,
    eventId,
  });
}

/**
 * Busca citas próximas del cliente dado (por teléfono), útil para que el
 * bot pueda ofrecer cancelar/reprogramar sin pedir el ID del evento.
 */
export async function findUpcomingAppointmentsForPhone(
  clientPhone: string
): Promise<Array<{ eventId: string; summary: string; startISO: string }>> {
  const client = getClient();
  const now = new Date().toISOString();

  const resp = await client.events.list({
    calendarId: config.googleCalendarId,
    timeMin: now,
    singleEvents: true,
    orderBy: "startTime",
    privateExtendedProperty: [`clientPhone=${clientPhone}`],
    maxResults: 10,
  });

  return (resp.data.items ?? []).map((e) => ({
    eventId: e.id as string,
    summary: e.summary || "",
    startISO: e.start?.dateTime || e.start?.date || "",
  }));
}

export interface AppointmentNeedingReminder {
  eventId: string;
  clientPhone: string;
  summary: string;
  startISO: string;
}

/**
 * Devuelve las citas cuyo inicio cae dentro de la ventana de recordatorio
 * (config.reminderHoursBefore) y que todavía no tienen el recordatorio
 * marcado como enviado (extendedProperties.private.reminderSent).
 */
export async function findAppointmentsNeedingReminder(
  hoursBefore: number
): Promise<AppointmentNeedingReminder[]> {
  const client = getClient();

  const now = Date.now();
  const windowStart = new Date(now).toISOString();
  const windowEnd = new Date(now + hoursBefore * 60 * 60 * 1000).toISOString();

  const resp = await client.events.list({
    calendarId: config.googleCalendarId,
    timeMin: windowStart,
    timeMax: windowEnd,
    singleEvents: true,
    orderBy: "startTime",
    privateExtendedProperty: ["reminderSent=false"],
    maxResults: 100,
  });

  return (resp.data.items ?? [])
    .filter((e) => e.extendedProperties?.private?.clientPhone)
    .map((e) => ({
      eventId: e.id as string,
      clientPhone: e.extendedProperties!.private!.clientPhone as string,
      summary: e.summary || "",
      startISO: e.start?.dateTime || e.start?.date || "",
    }));
}

/** Marca una cita como "recordatorio ya enviado" para no duplicar avisos. */
export async function markReminderSent(eventId: string): Promise<void> {
  const client = getClient();
  await client.events.patch({
    calendarId: config.googleCalendarId,
    eventId,
    requestBody: {
      extendedProperties: {
        private: { reminderSent: "true" },
      },
    },
  });
}

/**
 * Convierte una fecha "YYYY-MM-DD" + hora "HH:mm" en la zona horaria del
 * negocio a un ISO string en UTC. Implementación simple sin librerías
 * externas de zonas horarias: usamos Intl para calcular el offset.
 */
function zonedTimeToUtcISO(dateISO: string, time: string): string {
  const [hh, mm] = time.split(":").map(Number);

  // Construimos una fecha "naive" y ajustamos por el offset de la zona horaria
  const naiveDate = new Date(`${dateISO}T${time}:00`);

  const tzOffsetMinutes = getTimezoneOffsetMinutes(businessConfig.timezone, naiveDate);
  const utcMs = naiveDate.getTime() - tzOffsetMinutes * 60 * 1000;

  return new Date(utcMs).toISOString();
}

/** Offset en minutos de la zona horaria dada respecto a UTC, en la fecha indicada. */
function getTimezoneOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return (asUTC - date.getTime()) / 60000;
}
