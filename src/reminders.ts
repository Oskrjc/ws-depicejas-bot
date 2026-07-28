import cron from "node-cron";
import { config } from "./config";
import { businessConfig } from "./businessConfig";
import { findAppointmentsNeedingReminder, markReminderSent } from "./calendar";
import { sendTemplateMessage } from "./whatsapp";

/**
 * Recordatorios de citas.
 *
 * IMPORTANTE: WhatsApp exige que cualquier mensaje que el negocio inicie
 * fuera de la ventana de 24h desde el último mensaje del cliente use una
 * "plantilla" (template) pre-aprobada por Meta. Antes de que esto funcione
 * en producción, deben crear y esperar la aprobación de una plantilla en
 * Meta Business Manager > WhatsApp Manager > Plantillas de mensajes.
 *
 * Ejemplo de plantilla (categoría UTILITY):
 *   Nombre: recordatorio_cita
 *   Idioma: es
 *   Cuerpo: "Hola {{1}}, te recordamos tu cita de {{2}} el {{3}}. ¡Te esperamos!"
 *
 * El nombre debe coincidir con WHATSAPP_REMINDER_TEMPLATE en .env, y el
 * orden/cantidad de variables debe coincidir con bodyParams más abajo.
 */

async function processReminders(): Promise<void> {
  try {
    const appointments = await findAppointmentsNeedingReminder(config.reminderHoursBefore);

    for (const appt of appointments) {
      try {
        const startLocal = new Date(appt.startISO).toLocaleString("es-VE", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: businessConfig.timezone,
        });

        const clientName = appt.summary.split("—")[1]?.trim() || "";

        await sendTemplateMessage(appt.clientPhone, config.whatsappReminderTemplate, "es", [
          clientName || "cliente",
          appt.summary.split("—")[0]?.trim() || "tu cita",
          startLocal,
        ]);

        await markReminderSent(appt.eventId);
        console.log(`Recordatorio enviado para evento ${appt.eventId} a ${appt.clientPhone}`);
      } catch (err) {
        console.error(`Error enviando recordatorio para evento ${appt.eventId}:`, err);
      }
    }
  } catch (err) {
    console.error("Error revisando citas pendientes de recordatorio:", err);
  }
}

/** Inicia el cron job de recordatorios. Llamar una vez al arrancar el server. */
export function startReminderJob(): void {
  cron.schedule(config.reminderCronSchedule, () => {
    processReminders();
  });
  console.log(
    `Job de recordatorios iniciado (cron: "${config.reminderCronSchedule}", ventana: ${config.reminderHoursBefore}h antes de la cita)`
  );
}
