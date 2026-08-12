import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./config";
import { getConfig, isMercadoPagoConfigured } from "./config";
import { businessConfig } from "./businessConfig";
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
import { createPaymentPreference, getPayment } from "./mercadopago";
import {
  listAvailableSlots,
  listAllSlots,
  createSlots,
  deleteAvailableSlot,
  bookSlot,
  freeSlotByReservationId,
} from "./slotsDb";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

// ── Autenticación básica para el panel de administrador (/admin) ──────────
// Equivalente a requireAdminAuth en el server.ts de Express — mismo
// comportamiento: 503 si no está configurado, 401 con WWW-Authenticate si
// las credenciales no coinciden. Se aplica a TODO lo bajo /admin/*, tanto
// las rutas de API como los archivos estáticos del panel (servidos al
// final de este archivo vía c.env.ASSETS).
function checkBasicAuth(authHeader: string | undefined, username: string, password: string): boolean {
  if (!authHeader) return false;
  const [scheme, encoded] = authHeader.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;

  return decoded.slice(0, sep) === username && decoded.slice(sep + 1) === password;
}

app.use("/admin/*", async (c, next) => {
  const config = getConfig(c.env);
  if (!config.adminPassword) {
    return c.text("El panel de administrador no está configurado (falta ADMIN_PASSWORD).", 503);
  }
  if (!checkBasicAuth(c.req.header("Authorization"), config.adminUsername, config.adminPassword)) {
    c.header("WWW-Authenticate", 'Basic realm="Depicejas Admin"');
    return c.text("Autenticación requerida.", 401);
  }
  await next();
});

app.get("/health", (c) => c.json({ status: "ok" }));

// TEMPORAL — diagnóstico del problema de auth en /admin. Borrar después.
app.get("/debug-auth", (c) => {
  const config = getConfig(c.env);
  const authHeader = c.req.header("Authorization") || "";
  const [scheme, encoded] = authHeader.split(" ");
  let decoded = "";
  try {
    decoded = encoded ? atob(encoded) : "";
  } catch (e) {
    decoded = "ATOB_ERROR: " + String(e);
  }
  return c.json({
    hasAuthHeader: Boolean(authHeader),
    scheme,
    decodedPreview: decoded ? decoded.slice(0, 3) + "***(" + decoded.length + " chars)" : null,
    envAdminUsernameLength: config.adminUsername.length,
    envAdminUsernamePreview: config.adminUsername.slice(0, 3),
    envAdminPasswordLength: config.adminPassword.length,
    envAdminPasswordIsEmpty: config.adminPassword.length === 0,
  });
});

// ── Horarios disponibles para reservar (elegidos por Joselyn/Oscar desde /admin) ──
app.get("/api/slots", async (c) => {
  const slots = await listAvailableSlots(c.env.DB);
  return c.json(slots);
});

// Porcentaje del abono cuando el cliente elige pagar solo una parte al
// reservar (el resto se paga presencial). Si cambia este número, actualiza
// también las menciones de "20%" en businessConfig.ts y web/index.html.
const DEPOSIT_PERCENTAGE = 0.2;

// ── Reservas desde el formulario de la landing page ────────────────────────
app.post("/api/reservations", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name, email, rut, phone, services, preferredDate, preferredTime, notes, paymentOption } = body || {};

  const errors: string[] = [];
  if (!name || typeof name !== "string") errors.push("name");
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email");
  if (!rut || typeof rut !== "string" || rut.trim().length < 3) errors.push("rut");
  if (!Array.isArray(services) || services.length === 0 || !services.every((s: unknown) => typeof s === "string")) {
    errors.push("services");
  }
  if (!preferredDate || typeof preferredDate !== "string") errors.push("preferredDate");
  if (!preferredTime || typeof preferredTime !== "string") errors.push("preferredTime");
  if (paymentOption !== "deposit" && paymentOption !== "full") errors.push("paymentOption");

  if (errors.length > 0) {
    return c.json({ error: `Datos inválidos o faltantes: ${errors.join(", ")}` }, 400);
  }

  const matchedServices = (services as string[]).map((name: string) =>
    businessConfig.services.find((s) => s.name === name)
  );
  const unknownIndex = matchedServices.findIndex((s) => !s);
  if (unknownIndex !== -1) {
    return c.json({ error: `Servicio no reconocido: ${services[unknownIndex]}` }, 400);
  }
  const confirmedServices = matchedServices as NonNullable<(typeof matchedServices)[number]>[];

  const config = getConfig(c.env);
  if (!isMercadoPagoConfigured(config)) {
    return c.json(
      {
        error:
          "El pago online todavía no está configurado (falta MERCADOPAGO_ACCESS_TOKEN). Escríbenos por WhatsApp mientras tanto.",
      },
      503
    );
  }

  const fullPrice = confirmedServices.reduce((sum, s) => sum + s.price, 0);
  const priceToCharge = paymentOption === "deposit" ? Math.round(fullPrice * DEPOSIT_PERCENTAGE) : fullPrice;
  const serviceLabel = confirmedServices.map((s) => s.name).join(", ");

  let reservation;
  try {
    reservation = await saveReservation(c.env.DB, {
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
    const slotBooked = await bookSlot(c.env.DB, preferredDate, preferredTime, reservation.id);
    if (!slotBooked) {
      await deleteReservation(c.env.DB, reservation.id);
      return c.json({ error: "Ese horario ya no está disponible. Por favor elige otro." }, 409);
    }

    const { preferenceId, checkoutUrl } = await createPaymentPreference(config, reservation, priceToCharge, rut.trim());
    await setReservationPreferenceId(c.env.DB, reservation.id, preferenceId);

    return c.json({ ok: true, checkoutUrl }, 201);
  } catch (err) {
    console.error("Error procesando reserva:", err);
    // Si la reserva alcanzó a crearse pero algo falló después (ej. MercadoPago),
    // liberamos el horario para que no quede bloqueado sin una reserva válida.
    if (reservation) await freeSlotByReservationId(c.env.DB, reservation.id);
    return c.json({ error: "No se pudo procesar la reserva. Intenta de nuevo o escríbenos por WhatsApp." }, 500);
  }
});

// ── Webhook de pagos de MercadoPago ─────────────────────────────────────────
// Acepta POST (formato actual, JSON) y GET (formato IPN antiguo, por si
// acaso) — siempre responde 200 para evitar reintentos en cadena de
// MercadoPago, incluso si el procesamiento falla (el error queda logueado).
async function handlePaymentWebhook(c: Context<AppEnv>) {
  try {
    const body = await c.req.json().catch(() => ({}) as any);
    const query = c.req.query();
    const type = body?.type || query.type || query.topic;
    const paymentId = body?.data?.id || query["data.id"] || query.id;

    if (type !== "payment" || !paymentId) {
      return c.text("ok", 200); // otro tipo de notificación (ej. merchant_order) — no nos interesa
    }

    const config = getConfig(c.env);
    const payment = await getPayment(config, String(paymentId));
    if (!payment.externalReference) {
      console.warn(`Webhook de MercadoPago sin external_reference (payment ${payment.paymentId})`);
      return c.text("ok", 200);
    }

    const reservation = await getReservationByExternalReference(c.env.DB, payment.externalReference);
    if (!reservation) {
      console.warn(`Webhook de MercadoPago: no se encontró la reserva ${payment.externalReference}`);
      return c.text("ok", 200);
    }

    const wasAlreadyApproved = reservation.paymentStatus === "approved";
    const updated = await setReservationPaymentStatus(c.env.DB, reservation.id, payment.status, payment.paymentId);

    if (updated && payment.status === "approved" && !wasAlreadyApproved) {
      await sendPaymentConfirmedEmails(config, updated);
    }

    // Si el pago quedó rechazado o cancelado, liberamos el horario para que
    // otra clienta pueda tomarlo.
    if (payment.status === "rejected" || payment.status === "cancelled") {
      await freeSlotByReservationId(c.env.DB, reservation.id);
    }
  } catch (err) {
    console.error("Error procesando webhook de MercadoPago:", err);
  }

  return c.text("ok", 200);
}

app.post("/api/payments/webhook", handlePaymentWebhook);
app.get("/api/payments/webhook", handlePaymentWebhook);

// ── API protegida del panel de administrador (auth ya aplicada arriba) ────
app.get("/admin/api/reservations", async (c) => {
  const reservations = await listReservations(c.env.DB);
  return c.json(reservations);
});

app.patch("/admin/api/reservations/:id/contacted", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}) as any);
  const contacted = Boolean(body?.contacted);

  const updated = await setReservationContacted(c.env.DB, id, contacted);
  if (!updated) {
    return c.json({ error: "Reserva no encontrada." }, 404);
  }
  return c.json(updated);
});

app.delete("/admin/api/reservations/:id", async (c) => {
  const id = Number(c.req.param("id"));
  // Libera el horario ligado a esta reserva antes de borrarla, para que
  // vuelva a aparecer como disponible en vez de quedar bloqueado sin dueño.
  await freeSlotByReservationId(c.env.DB, id);
  const deleted = await deleteReservation(c.env.DB, id);
  if (!deleted) {
    return c.json({ error: "Reserva no encontrada." }, 404);
  }
  return c.body(null, 204);
});

// ── Horarios disponibles (creados/eliminados por Joselyn u Oscar desde /admin) ──
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

app.get("/admin/api/slots", async (c) => {
  const slots = await listAllSlots(c.env.DB);
  return c.json(slots);
});

app.post("/admin/api/slots", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const { date, time, times } = body || {};

  if (!date || typeof date !== "string" || !DATE_RE.test(date)) {
    return c.json({ error: "Fecha inválida (formato esperado: AAAA-MM-DD)." }, 400);
  }

  const rawTimes: unknown[] = Array.isArray(times) ? times : typeof time === "string" ? [time] : [];
  const cleanTimes = rawTimes
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);

  if (cleanTimes.length === 0) {
    return c.json({ error: "Agrega al menos una hora." }, 400);
  }

  const invalidTime = cleanTimes.find((t) => !TIME_RE.test(t));
  if (invalidTime) {
    return c.json({ error: `Hora inválida: "${invalidTime}" (formato esperado: HH:MM).` }, 400);
  }

  const slots = await createSlots(c.env.DB, date, cleanTimes);
  return c.json(slots, 201);
});

app.delete("/admin/api/slots/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const deleted = await deleteAvailableSlot(c.env.DB, id);
  if (!deleted) {
    return c.json(
      { error: "No se pudo eliminar: el horario no existe o ya está reservado (elimina la reserva primero)." },
      409
    );
  }
  return c.body(null, 204);
});

// ── Archivos estáticos del panel de administrador ──────────────────────────
// Van al final para no tapar las rutas de /admin/api/* de arriba. Sirven
// index.html/script.js/styles.css directo desde los assets del proyecto
// (web/admin/), pero solo se llega hasta acá si ya se pasó el middleware de
// autenticación de arriba — a diferencia de un sitio estático normal, estos
// archivos nunca se sirven sin contraseña.
app.get("/admin", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/admin/*", (c) => c.env.ASSETS.fetch(c.req.raw));

// ── Resto del sitio (estático) ──────────────────────────────────────────────
// Con run_worker_first = true (ver wrangler.toml), TODAS las requests pasan
// primero por este Worker — sin este catch-all, cualquier archivo que no
// matchee una ruta de arriba (index.html, styles.css, imágenes, etc.)
// devolvería 404 en vez de servirse normalmente.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
