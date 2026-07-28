import Anthropic from "@anthropic-ai/sdk";

/**
 * Historial de conversación por número de teléfono, en memoria.
 *
 * Se pierde al reiniciar el proceso (redeploy en Railway) — para este bot
 * es un compromiso aceptable: el peor caso es que el cliente tenga que
 * repetir contexto en un mensaje nuevo. Las citas en sí viven en Google
 * Calendar, que es la fuente de verdad y no se pierde.
 */

type StoredMessage = Anthropic.MessageParam;

interface ConversationEntry {
  messages: StoredMessage[];
  lastActivity: number;
}

const MAX_MESSAGES_PER_CONVERSATION = 30;
const CONVERSATION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas de inactividad

const conversations = new Map<string, ConversationEntry>();

export function getHistory(phone: string): StoredMessage[] {
  cleanupExpired();
  return conversations.get(phone)?.messages ?? [];
}

export function appendMessages(phone: string, newMessages: StoredMessage[]): void {
  const entry = conversations.get(phone) ?? { messages: [], lastActivity: Date.now() };
  entry.messages.push(...newMessages);
  entry.lastActivity = Date.now();

  // Recorta el historial si crece demasiado (nos quedamos con lo más reciente)
  if (entry.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    entry.messages = entry.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  }

  conversations.set(phone, entry);
}

export function resetConversation(phone: string): void {
  conversations.delete(phone);
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [phone, entry] of conversations.entries()) {
    if (now - entry.lastActivity > CONVERSATION_TTL_MS) {
      conversations.delete(phone);
    }
  }
}
