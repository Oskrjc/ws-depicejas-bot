import { config } from "./config";

const GRAPH_BASE = `https://graph.facebook.com/${config.whatsappApiVersion}`;

/** Envía un mensaje de texto simple a un número de WhatsApp. */
export async function sendTextMessage(to: string, body: string): Promise<void> {
  const url = `${GRAPH_BASE}/${config.whatsappPhoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error enviando WhatsApp a ${to}: ${res.status} ${errText}`);
  }
}

/**
 * Envía un mensaje de plantilla (template) aprobada por Meta.
 * Necesario para mensajes iniciados por el negocio fuera de la ventana de
 * 24h de servicio al cliente (p.ej. recordatorios de citas).
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
): Promise<void> {
  const url = `${GRAPH_BASE}/${config.whatsappPhoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: bodyParams.length
          ? [
              {
                type: "body",
                parameters: bodyParams.map((text) => ({ type: "text", text })),
              },
            ]
          : undefined,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error enviando plantilla WhatsApp a ${to}: ${res.status} ${errText}`);
  }
}

/** Marca un mensaje entrante como leído (check azul). */
export async function markAsRead(messageId: string): Promise<void> {
  const url = `${GRAPH_BASE}/${config.whatsappPhoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });

  if (!res.ok) {
    // No crítico: solo lo logueamos
    console.warn(`No se pudo marcar como leído ${messageId}: ${res.status}`);
  }
}

export interface IncomingTextMessage {
  from: string; // número del cliente, formato WhatsApp (ej. "584120000000")
  messageId: string;
  text: string;
  timestamp: string;
}

/**
 * Extrae mensajes de texto entrantes del payload crudo del webhook de
 * WhatsApp Cloud API. Ignora otros tipos de evento (status updates, etc.)
 * y otros tipos de mensaje (imágenes, audio, etc.) — solo texto por ahora.
 */
export function parseIncomingTextMessages(payload: any): IncomingTextMessage[] {
  const messages: IncomingTextMessage[] = [];

  const entries = payload?.entry ?? [];
  for (const entry of entries) {
    const changes = entry?.changes ?? [];
    for (const change of changes) {
      const value = change?.value;
      const rawMessages = value?.messages ?? [];
      for (const msg of rawMessages) {
        if (msg.type === "text" && msg.text?.body) {
          messages.push({
            from: msg.from,
            messageId: msg.id,
            text: msg.text.body,
            timestamp: msg.timestamp,
          });
        }
      }
    }
  }

  return messages;
}
