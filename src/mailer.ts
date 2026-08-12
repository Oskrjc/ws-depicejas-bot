import type { AppConfig } from "./config";
import type { Reservation } from "./reservationsDb";
import { businessConfig } from "./businessConfig";

/**
 * Envío de correos vía Resend (API HTTP) en vez de nodemailer/Gmail por
 * SMTP — SMTP con sockets TCP directos no tiene soporte estable en
 * Cloudflare Workers. Resend está hecho para funcionar en runtimes tipo
 * Workers (una sola llamada fetch), y tiene 3.000 correos/mes gratis.
 */

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
 * Link de WhatsApp con el mensaje de confirmación ya redactado — Joselyn
 * solo tiene que abrirlo y darle enviar. No requiere la API de WhatsApp
 * Business (que todavía no está activada), es solo un link `wa.me`.
 */
function buildWhatsappConfirmLink(reservation: Reservation): string | null {
  if (!reservation.phone) return null;
  const digits = reservation.phone.replace(/\D/g, "");
  if (!digits) return null;

  const message = `Hola ${reservation.name}, tu cita de ${reservation.service} quedó confirmada para el ${reservation.preferredDate} a las ${reservation.preferredTime}. ¡Te esperamos!`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

async function sendEmail(config: AppConfig, to: string, subject: string, text: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.mailFrom,
      to,
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend rechazó el envío del correo (${res.status}): ${errText}`);
  }
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
export async function sendPaymentConfirmedEmails(config: AppConfig, reservation: Reservation): Promise<void> {
  const whatsappLink = buildWhatsappConfirmLink(reservation);

  await sendEmail(
    config,
    config.ownerNotificationEmail,
    `✅ Pago recibido: ${reservation.service} — ${reservation.name}`,
    [
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
      ...(whatsappLink ? [``, `Confirmarle por WhatsApp con un clic: ${whatsappLink}`] : []),
    ].join("\n")
  );

  try {
    await sendEmail(
      config,
      reservation.email,
      `Recibimos tu pago — ${businessConfig.name}`,
      [
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
      ].join("\n")
    );
  } catch (err) {
    console.error("No se pudo enviar el correo de confirmación de pago al cliente:", err);
  }
}
