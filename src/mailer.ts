import nodemailer from "nodemailer";
import { config } from "./config";
import type { Reservation } from "./reservationsDb";
import { businessConfig } from "./businessConfig";

function isMailerConfigured(): boolean {
  return Boolean(config.gmailUser && config.gmailAppPassword && config.ownerNotificationEmail);
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword,
      },
    });
  }
  return transporter;
}

/**
 * Envía el correo de notificación a Joselyn y la confirmación al cliente.
 * Lanza un error si el correo de Joselyn falla (para que el endpoint avise
 * al cliente); si solo falla la confirmación al cliente, lo registra pero
 * no hace fallar la reserva completa, ya que esta ya quedó guardada.
 */
export async function sendReservationEmails(reservation: Reservation): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error(
      "El envío de correos no está configurado (faltan GMAIL_USER, GMAIL_APP_PASSWORD u OWNER_NOTIFICATION_EMAIL en .env)."
    );
  }

  const mailer = getTransporter();

  await mailer.sendMail({
    from: `"${businessConfig.name}" <${config.gmailUser}>`,
    to: config.ownerNotificationEmail,
    subject: `Nueva reserva: ${reservation.service} — ${reservation.name}`,
    text: [
      `Nueva solicitud de reserva desde la página web.`,
      ``,
      `Cliente: ${reservation.name}`,
      `Correo: ${reservation.email}`,
      `Teléfono: ${reservation.phone || "(no indicado)"}`,
      `Servicio: ${reservation.service}`,
      `Fecha preferida: ${reservation.preferredDate}`,
      `Hora preferida: ${reservation.preferredTime}`,
      `Notas: ${reservation.notes || "(sin notas)"}`,
      ``,
      `Recuerda que esta es una solicitud, no una hora confirmada — contacta al cliente para coordinar disponibilidad y el abono del 20%.`,
    ].join("\n"),
  });

  try {
    await mailer.sendMail({
      from: `"${businessConfig.name}" <${config.gmailUser}>`,
      to: reservation.email,
      subject: `Recibimos tu solicitud de reserva — ${businessConfig.name}`,
      text: [
        `¡Hola ${reservation.name}!`,
        ``,
        `Recibimos tu solicitud para el servicio "${reservation.service}" el ${reservation.preferredDate} a las ${reservation.preferredTime}.`,
        ``,
        `Esto todavía no es una cita confirmada: ${businessConfig.humanContact.name} se pondrá en contacto contigo pronto para confirmar el horario y coordinar el abono del 20% requerido para reservar.`,
        ``,
        `Si tienes dudas mientras tanto, puedes escribirnos por WhatsApp.`,
        ``,
        `${businessConfig.name}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("No se pudo enviar el correo de confirmación al cliente:", err);
  }
}
