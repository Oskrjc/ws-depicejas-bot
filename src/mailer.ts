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

function formatClp(amount: number | null): string {
  if (amount == null) return "(monto no registrado)";
  return `$${amount.toLocaleString("es-CL")}`;
}

/** Línea describiendo qué se pagó: "Pago completo" o "Abono 20% (queda $X pendiente)". */
function paymentSummaryLine(reservation: Reservation): string {
  if (reservation.paymentOption !== "deposit") {
    return "Pago completo (100%)";
  }
  const remaining =
    reservation.fullPrice != null && reservation.price != null ? reservation.fullPrice - reservation.price : null;
  return remaining != null
    ? `Abono 20% — queda ${formatClp(remaining)} pendiente de pago presencial`
    : "Abono 20%";
}

/**
 * Envía los correos de una reserva CON EL PAGO YA CONFIRMADO por
 * MercadoPago (llamar desde el webhook, no desde el submit del formulario —
 * antes de eso el cliente todavía no pagó nada).
 *
 * Lanza un error si el correo interno a Joselyn falla (para poder
 * reintentar/loguear); si solo falla la confirmación al cliente, lo
 * registra pero no hace fallar el flujo, ya que el pago y la reserva ya
 * quedaron guardados igual.
 */
export async function sendPaymentConfirmedEmails(reservation: Reservation): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error(
      "El envío de correos no está configurado (faltan GMAIL_USER, GMAIL_APP_PASSWORD u OWNER_NOTIFICATION_EMAIL en .env)."
    );
  }

  const mailer = getTransporter();

  await mailer.sendMail({
    from: `"${businessConfig.name}" <${config.gmailUser}>`,
    to: config.ownerNotificationEmail,
    subject: `✅ Pago recibido: ${reservation.service} — ${reservation.name}`,
    text: [
      `Se confirmó el pago de una reserva hecha desde la página web.`,
      ``,
      `Cliente: ${reservation.name}`,
      `Correo: ${reservation.email}`,
      `Teléfono: ${reservation.phone || "(no indicado)"}`,
      `Servicio: ${reservation.service}`,
      `Monto pagado: ${formatClp(reservation.price)} — ${paymentSummaryLine(reservation)}`,
      `Fecha preferida: ${reservation.preferredDate}`,
      `Hora preferida: ${reservation.preferredTime}`,
      `Notas: ${reservation.notes || "(sin notas)"}`,
      ``,
      `El pago ya está confirmado — contacta al cliente para confirmar definitivamente el horario (sujeto a disponibilidad real de la agenda).`,
    ].join("\n"),
  });

  try {
    await mailer.sendMail({
      from: `"${businessConfig.name}" <${config.gmailUser}>`,
      to: reservation.email,
      subject: `Recibimos tu pago — ${businessConfig.name}`,
      text: [
        `¡Hola ${reservation.name}!`,
        ``,
        `Recibimos tu pago de ${formatClp(reservation.price)} por "${reservation.service}" para el ${reservation.preferredDate} a las ${reservation.preferredTime}. ¡Gracias!`,
        ``,
        reservation.paymentOption === "deposit"
          ? `Esto corresponde al abono del 20% — el resto del valor se paga presencial el día de tu cita.`
          : `Pagaste el valor completo del servicio, así que no queda nada pendiente por pagar el día de tu cita.`,
        ``,
        `${businessConfig.humanContact.name} va a confirmarte el horario definitivo muy pronto (queda sujeto a disponibilidad real de la agenda). Si hay algún cambio, te contactamos enseguida.`,
        ``,
        `Si tienes dudas mientras tanto, puedes escribirnos por WhatsApp.`,
        ``,
        `${businessConfig.name}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("No se pudo enviar el correo de confirmación de pago al cliente:", err);
  }
}
