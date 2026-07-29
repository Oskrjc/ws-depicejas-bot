import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { config, assertServerConfig } from "./config";
import { parseIncomingTextMessages, sendTextMessage, markAsRead } from "./whatsapp";
import { handleIncomingMessage } from "./claude";
import { startReminderJob } from "./reminders";
import {
  saveReservation,
  listReservations,
  setReservationContacted,
  deleteReservation,
} from "./reservationsDb";
import { sendReservationEmails } from "./mailer";

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

// ── Reservas desde el formulario de la landing page ────────────────────────
app.post("/api/reservations", async (req, res) => {
  const { name, email, phone, service, preferredDate, preferredTime, notes } = req.body || {};

  const errors: string[] = [];
  if (!name || typeof name !== "string") errors.push("name");
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email");
  if (!service || typeof service !== "string") errors.push("service");
  if (!preferredDate || typeof preferredDate !== "string") errors.push("preferredDate");
  if (!preferredTime || typeof preferredTime !== "string") errors.push("preferredTime");

  if (errors.length > 0) {
    res.status(400).json({ error: `Datos inválidos o faltantes: ${errors.join(", ")}` });
    return;
  }

  try {
    const reservation = saveReservation({
      name,
      email,
      phone: typeof phone === "string" ? phone : undefined,
      service,
      preferredDate,
      preferredTime,
      notes: typeof notes === "string" ? notes : undefined,
    });

    await sendReservationEmails(reservation);

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("Error procesando reserva:", err);
    res.status(500).json({ error: "No se pudo procesar la reserva. Intenta de nuevo o escríbenos por WhatsApp." });
  }
});

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
  const deleted = deleteReservation(id);
  if (!deleted) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }
  res.status(204).send();
});

app.listen(config.port, () => {
  console.log(`Servidor escuchando en el puerto ${config.port}`);
  startReminderJob();
});
