import express from "express";
import { config, assertServerConfig } from "./config";
import { parseIncomingTextMessages, sendTextMessage, markAsRead } from "./whatsapp";
import { handleIncomingMessage } from "./claude";
import { startReminderJob } from "./reminders";

assertServerConfig();

const app = express();
app.use(express.json());

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

app.listen(config.port, () => {
  console.log(`Servidor escuchando en el puerto ${config.port}`);
  startReminderJob();
});
