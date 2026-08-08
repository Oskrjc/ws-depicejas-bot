import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env (ver .env.example).`);
  }
  return value;
}

// Solo ANTHROPIC_API_KEY es obligatoria para importar este módulo — así se
// puede usar `npm run chat` (chat de prueba por consola, sin WhatsApp ni
// Google Calendar configurados) con nada más que la clave de Claude. Para
// levantar el servidor real (src/server.ts), se valida todo lo demás con
// assertServerConfig() más abajo.
export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-4-8",

  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
  whatsappReminderTemplate: process.env.WHATSAPP_REMINDER_TEMPLATE || "recordatorio_cita",
  whatsappEscalationTemplate:
    process.env.WHATSAPP_ESCALATION_TEMPLATE || "notificacion_escalamiento",

  googleServiceAccountKeyPath:
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || "./google-service-account.json",
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID || "",

  businessTimezone: process.env.BUSINESS_TIMEZONE || "America/Caracas",

  reminderHoursBefore: Number(process.env.REMINDER_HOURS_BEFORE || 24),
  reminderCronSchedule: process.env.REMINDER_CRON_SCHEDULE || "*/15 * * * *",

  // Reservas desde la landing page (formulario web → correo, ver src/mailer.ts)
  gmailUser: process.env.GMAIL_USER || "",
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || "",
  ownerNotificationEmail: process.env.OWNER_NOTIFICATION_EMAIL || process.env.GMAIL_USER || "",
  reservationsDbPath: process.env.RESERVATIONS_DB_PATH || "./data/reservations.db",

  // Panel de administrador (/admin) — una sola contraseña compartida
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",

  // Pago online por MercadoPago (Checkout Pro) desde el formulario de la web.
  // Opcional: si falta, /api/reservations responde con un error claro en vez
  // de romper todo el servidor (mismo patrón que el panel de admin).
  mercadopagoAccessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || "",
  // URL pública del sitio (sin barra al final), usada para las back_urls de
  // MercadoPago y la notification_url del webhook de pagos.
  baseUrl: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ""),

  port: Number(process.env.PORT || 3000),
};

/**
 * Valida que todas las variables necesarias para correr el servidor real
 * (webhook de WhatsApp + recordatorios) estén presentes. Llamar al arrancar
 * src/server.ts — no se llama desde el chat de prueba (src/cli.ts).
 */
export function assertServerConfig(): void {
  const missing: string[] = [];
  if (!config.whatsappAccessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!config.whatsappPhoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!config.whatsappVerifyToken) missing.push("WHATSAPP_VERIFY_TOKEN");
  if (!config.googleCalendarId) missing.push("GOOGLE_CALENDAR_ID");

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno para correr el servidor: ${missing.join(", ")}. Revisa tu .env (ver .env.example).`
    );
  }
}
