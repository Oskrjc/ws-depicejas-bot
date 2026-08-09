import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { config, assertServerConfig } from "./config";
import { businessConfig } from "./businessConfig";
import { parseIncomingTextMessages, sendTextMessage, markAsRead } from "./whatsapp";
import { handleIncomingMessage } from "./claude";
import { startReminderJob } from "./reminders";
import {
  saveReservation,
  listReservations,
  setReservationContacted,
  deleteReservation,
  setReservationPreferenceId,
  setReservationPaymentStatus,
  getReservationByExternalReference,
} from "./reservationsDb";
import { sendPaymentConfirmedEmails } from "./mailer";
import { isMercadoPagoConfigured, createPaymentPreference, getPayment } from "./mercadopago";
import {
  listAvailableSlots,
  listAllSlots,
  createSlots,
  deleteAvailableSlot,
  bookSlot,
  freeSlotByReservationId,
} from "./slotsDb";

assertServerConfig();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../web")));

// ── Autenticación básica para el panel de administrador (/admin) ──────────
function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminPassword) {
    res.status(503).send("El panel de administrador no está configurado (falta ADMIN_PASSWORD en .env).");
    return;
  }

  const authHeader = req.headers.authorization || "";
  const [scheme, encoded] = authHeader.split(" ");

  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
    if (user === config.adminUsername && pass === config.adminPassword) {
      next();
      return;
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Depicejas Admin"');
  res.status(401).send("Autenticación requerida.");
}

app.use("/admin", requireAdminAuth, express.static(path.join(__dirname, "../admin")));

// ── Verificación del webhook (Meta hace un GET al configurar la URL) ──────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsappVerifyToken) {
    console.log("Webhook verificado correctamente.");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Recepción de mensajes entrantes ────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Responder rápido: Meta espera 200 en pocos segundos o reintenta el envío.
  res.sendStatus(200);

  try {
    const incoming = parseIncomingTextMessages(req.body);

    for (const msg of incoming) {
      markAsRead(msg.messageId).catch(() => {});

      handleIncomingMessage(msg.from, msg.text)
        .then((reply) => sendTextMessage(msg.from, reply))
        .catch(async (err) => {
          console.error(`Error procesando mensaje de ${msg.from}:`, err);
          try {
            await sendTextMessage(
              msg.from,
              "Disculpa, tuvimos un problema técnico. Intenta de nuevo en unos minutos o escribe directamente a nuestro equipo."
            );
          } catch {
            // si tampoco se puede enviar el mensaje de error, solo lo logueamos
          }
        });
    }
  } catch (err) {
    console.error("Error procesando webhook entrante:", err);
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Horarios disponibles para reservar (elegidos por Joselyn/Oscar desde /admin) ──
app.get("/api/slots", (_req, res) => {
  res.json(listAvailableSlots());
});

// Porcentaje del abono cuando el cliente elige pagar solo una parte al
// reservar (el resto se paga presencial). Si cambia este número, actualiza
// también las menciones de "20%" en businessConfig.ts y web/index.html.
const DEPOSIT_PERCENTAGE = 0.2;

// ── Reservas desde el formulario de la landing page ────────────────────────
// El cliente puede elegir varios servicios a la vez; el monto a cobrar es la
// suma de todos. Además elige pagar el abono (20%) o el precio completo por
// MercadoPago al reservar. Este endpoint guarda la solicitud y devuelve la
// URL de checkout a la que el frontend redirige al cliente — el correo de
// confirmación se envía recién cuando el pago se confirma (ver
// /api/payments/webhook).
app.post("/api/reservations", async (req, res) => {
  const { name, email, rut, phone, services, preferredDate, preferredTime, notes, paymentOption } = req.body || {};

  const errors: string[] = [];
  if (!name || typeof name !== "string") errors.push("name");
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email");
  // MercadoPago Chile exige el RUT del pagador para procesar tarjetas — sin
  // esto, el botón "Pagar" queda inactivo en su checkout sin ningún error visible.
  if (!rut || typeof rut !== "string" || rut.trim().length < 3) errors.push("rut");
  if (!Array.isArray(services) || services.length === 0 || !services.every((s) => typeof s === "string")) {
    errors.push("services");
  }
  if (!preferredDate || typeof preferredDate !== "string") errors.push("preferredDate");
  if (!preferredTime || typeof preferredTime !== "string") errors.push("preferredTime");
  if (paymentOption !== "deposit" && paymentOption !== "full") errors.push("paymentOption");

  if (errors.length > 0) {
    res.status(400).json({ error: `Datos inválidos o faltantes: ${errors.join(", ")}` });
    return;
  }

  const matchedServices = (services as string[]).map((name: string) =>
    businessConfig.services.find((s) => s.name === name)
  );
  const unknownIndex = matchedServices.findIndex((s) => !s);
  if (unknownIndex !== -1) {
    res.status(400).json({ error: `Servicio no reconocido: ${services[unknownIndex]}` });
    return;
  }
  const confirmedServices = matchedServices as NonNullable<(typeof matchedServices)[number]>[];

  if (!isMercadoPagoConfigured()) {
    res.status(503).json({
      error: "El pago online todavía no está configurado (falta MERCADOPAGO_ACCESS_TOKEN en .env). Escríbenos por WhatsApp mientras tanto.",
    });
    return;
  }

  const fullPrice = confirmedServices.reduce((sum, s) => sum + s.price, 0);
  const priceToCharge = paymentOption === "deposit" ? Math.round(fullPrice * DEPOSIT_PERCENTAGE) : fullPrice;
  const serviceLabel = confirmedServices.map((s) => s.name).join(", ");

  let reservation;
  try {
    reservation = saveReservation({
      name,
      email,
      phone: typeof phone === "string" ? phone : undefined,
      service: serviceLabel,
      preferredDate,
      preferredTime,
      notes: typeof notes === "string" ? notes : undefined,
      price: priceToCharge,
      fullPrice,
      paymentOption,
    });

    // Reserva el horario de forma atómica: si ya no está disponible (otra
    // clienta lo tomó justo antes), deshacemos la reserva recién creada y
    // avisamos en vez de dejar dos reservas para la misma hora.
    const slotBooked = bookSlot(preferredDate, preferredTime, reservation.id);
    if (!slotBooked) {
      deleteReservation(reservation.id);
      res.status(409).json({ error: "Ese horario ya no está disponible. Por favor elige otro." });
      return;
    }

    const { preferenceId, checkoutUrl } = await createPaymentPreference(reservation, priceToCharge, rut.trim());
    setReservationPreferenceId(reservation.id, preferenceId);

    res.status(201).json({ ok: true, checkoutUrl });
  } catch (err) {
    console.error("Error procesando reserva:", err);
    // Si la reserva alcanzó a crearse pero algo falló después (ej. MercadoPago),
    // liberamos el horario para que no quede bloqueado sin una reserva válida.
    if (reservation) freeSlotByReservationId(reservation.id);
    res.status(500).json({ error: "No se pudo procesar la reserva. Intenta de nuevo o escríbenos por WhatsApp." });
  }
});

// ── Webhook de pagos de MercadoPago ─────────────────────────────────────────
// MercadoPago llama esto server-a-servidor cuando cambia el estado de un
// pago. Es la fuente de verdad (la redirección del cliente al navegador
// puede perderse). Acepta POST (formato actual, JSON) y GET (formato IPN
// antiguo, por si acaso) — siempre responde 200 para evitar reintentos en
// cadena, incluso si el procesamiento falla (el error queda logueado).
async function handlePaymentWebhook(req: Request, res: Response): Promise<void> {
  res.sendStatus(200);

  try {
    const type = req.body?.type || req.query.type || req.query.topic;
    const paymentId = req.body?.data?.id || req.query["data.id"] || req.query.id;

    if (type !== "payment" || !paymentId) {
      return; // otro tipo de notificación (ej. merchant_order) — no nos interesa
    }

    const payment = await getPayment(String(paymentId));
    if (!payment.externalReference) {
      console.warn(`Webhook de MercadoPago sin external_reference (payment ${payment.paymentId})`);
      return;
    }

    const reservation = getReservationByExternalReference(payment.externalReference);
    if (!reservation) {
      console.warn(`Webhook de MercadoPago: no se encontró la reserva ${payment.externalReference}`);
      return;
    }

    const wasAlreadyApproved = reservation.paymentStatus === "approved";
    const updated = setReservationPaymentStatus(reservation.id, payment.status, payment.paymentId);

    if (updated && payment.status === "approved" && !wasAlreadyApproved) {
      await sendPaymentConfirmedEmails(updated);
    }

    // Si el pago quedó rechazado o cancelado, liberamos el horario para que
    // otra clienta pueda tomarlo — de lo contrario quedaría bloqueado para
    // siempre por una reserva que nunca se pagó.
    if (payment.status === "rejected" || payment.status === "cancelled") {
      freeSlotByReservationId(reservation.id);
    }
  } catch (err) {
    console.error("Error procesando webhook de MercadoPago:", err);
  }
}

app.post("/api/payments/webhook", handlePaymentWebhook);
app.get("/api/payments/webhook", handlePaymentWebhook);

// ── API protegida del panel de administrador ────────────────────────────────
app.get("/admin/api/reservations", requireAdminAuth, (_req, res) => {
  res.json(listReservations());
});

app.patch("/admin/api/reservations/:id/contacted", requireAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  const contacted = Boolean(req.body?.contacted);

  const updated = setReservationContacted(id, contacted);
  if (!updated) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }
  res.json(updated);
});

app.delete("/admin/api/reservations/:id", requireAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  // Libera el horario ligado a esta reserva antes de borrarla, para que
  // vuelva a aparecer como disponible en vez de quedar bloqueado sin dueño.
  freeSlotByReservationId(id);
  const deleted = deleteReservation(id);
  if (!deleted) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }
  res.status(204).send();
});

// ── Horarios disponibles (creados/eliminados por Joselyn u Oscar desde /admin) ──
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

app.get("/admin/api/slots", requireAdminAuth, (_req, res) => {
  res.json(listAllSlots());
});

app.post("/admin/api/slots", requireAdminAuth, (req, res) => {
  const { date, time, times } = req.body || {};

  if (!date || typeof date !== "string" || !DATE_RE.test(date)) {
    res.status(400).json({ error: "Fecha inválida (formato esperado: AAAA-MM-DD)." });
    return;
  }

  const rawTimes: unknown[] = Array.isArray(times) ? times : typeof time === "string" ? [time] : [];
  const cleanTimes = rawTimes
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);

  if (cleanTimes.length === 0) {
    res.status(400).json({ error: "Agrega al menos una hora." });
    return;
  }

  const invalidTime = cleanTimes.find((t) => !TIME_RE.test(t));
  if (invalidTime) {
    res.status(400).json({ error: `Hora inválida: "${invalidTime}" (formato esperado: HH:MM).` });
    return;
  }

  const slots = createSlots(date, cleanTimes);
  res.status(201).json(slots);
});

app.delete("/admin/api/slots/:id", requireAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  const deleted = deleteAvailableSlot(id);
  if (!deleted) {
    res.status(409).json({
      error: "No se pudo eliminar: el horario no existe o ya está reservado (elimina la reserva primero).",
    });
    return;
  }
  res.status(204).send();
});

app.listen(config.port, () => {
  console.log(`Servidor escuchando en el puerto ${config.port}`);
  startReminderJob();
});
