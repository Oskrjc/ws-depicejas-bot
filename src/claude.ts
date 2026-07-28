import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import { buildSystemPrompt, businessConfig } from "./businessConfig";
import { getHistory, appendMessages } from "./conversationStore";
import {
  checkAvailability,
  bookAppointment,
  cancelAppointment,
  findUpcomingAppointmentsForPhone,
} from "./calendar";
import { sendTemplateMessage } from "./whatsapp";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const tools: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Consulta los horarios libres para un día específico, según el horario de atención del negocio. Úsalo SIEMPRE antes de ofrecer una hora concreta al cliente.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Fecha a consultar en formato YYYY-MM-DD.",
        },
        service_name: {
          type: "string",
          description: "Nombre del servicio (determina la duración del bloque). Si no se especifica, se usa la duración por defecto.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "book_appointment",
    description:
      "Agenda una cita en el calendario. Solo llama esto después de confirmar con el cliente la fecha, hora, servicio y su nombre completo.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha en formato YYYY-MM-DD." },
        time: { type: "string", description: "Hora de inicio en formato HH:mm (24h)." },
        service_name: { type: "string", description: "Nombre del servicio a agendar." },
        client_name: { type: "string", description: "Nombre completo del cliente." },
        notes: { type: "string", description: "Notas adicionales relevantes para la cita, si las hay." },
      },
      required: ["date", "time", "service_name", "client_name"],
    },
  },
  {
    name: "find_my_appointments",
    description:
      "Busca las próximas citas agendadas del cliente que está escribiendo (usa su número de WhatsApp automáticamente). Úsalo antes de cancelar o reprogramar.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cancel_appointment",
    description:
      "Cancela una cita existente dado su event_id (obtenido con find_my_appointments). Confirma con el cliente antes de cancelar.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "ID del evento de calendario a cancelar." },
      },
      required: ["event_id"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Notifica a Joselyn por WhatsApp que un caso necesita su atención directa. Úsalo siempre que aplique alguno de los criterios de escalamiento (quejas, atención a domicilio, servicio fuera de catálogo, disponibilidad que no puedas resolver, o cualquier caso sensible). Después de llamarla, sigue respondiendo al cliente con amabilidad indicando que Joselyn se pondrá en contacto.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo breve del escalamiento (ej. 'queja por servicio', 'solicitud a domicilio', 'servicio fuera de catálogo').",
        },
        summary: {
          type: "string",
          description: "Resumen breve de la conversación/solicitud del cliente para que Joselyn tenga contexto.",
        },
      },
      required: ["reason", "summary"],
    },
  },
];

/** Envía una notificación de WhatsApp a Joselyn (reutiliza la plantilla de escalamiento). */
async function notifyHuman(reason: string, clientPhone: string, detail: string): Promise<void> {
  const whatsappNumber = businessConfig.humanContact.whatsappNumber;
  if (!whatsappNumber) {
    console.warn("notifyHuman: no hay whatsappNumber configurado en businessConfig.humanContact");
    return;
  }
  await sendTemplateMessage(whatsappNumber, config.whatsappEscalationTemplate, "es", [
    reason,
    clientPhone,
    detail,
  ]);
}

function getServiceDuration(serviceName?: string): number {
  if (!serviceName) return businessConfig.defaultAppointmentDurationMinutes;
  const match = businessConfig.services.find(
    (s) => s.name.toLowerCase() === serviceName.toLowerCase()
  );
  return match?.durationMinutes ?? businessConfig.defaultAppointmentDurationMinutes;
}

async function executeTool(
  name: string,
  input: any,
  clientPhone: string
): Promise<string> {
  try {
    switch (name) {
      case "check_availability": {
        const duration = getServiceDuration(input.service_name);
        const slots = await checkAvailability(input.date, duration);
        if (slots.length === 0) {
          return JSON.stringify({ available: false, message: "No hay horarios libres ese día." });
        }
        return JSON.stringify({
          available: true,
          slots: slots.map((s) => ({
            start: s.start,
            // hora local legible para que Claude la use en su respuesta
            startLocal: new Date(s.start).toLocaleTimeString("es-VE", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: businessConfig.timezone,
            }),
          })),
        });
      }

      case "book_appointment": {
        const duration = getServiceDuration(input.service_name);
        const startISO = `${input.date}T${input.time}:00`;
        const startDate = new Date(startISO);
        const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

        const result = await bookAppointment({
          startISO: startDate.toISOString(),
          endISO: endDate.toISOString(),
          clientName: input.client_name,
          clientPhone,
          serviceName: input.service_name,
          notes: input.notes,
        });

        // Notificamos a Joselyn automáticamente para que coordine el abono
        // del 20% con atención personal — no depende de que el modelo
        // recuerde llamar a escalate_to_human.
        const startLocal = startDate.toLocaleString("es-CL", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: businessConfig.timezone,
        });
        notifyHuman(
          "Nueva cita — pendiente de abono (20%)",
          clientPhone,
          `${input.service_name} el ${startLocal}, a nombre de ${input.client_name}.`
        ).catch((err) => console.error("Error notificando nueva cita a Joselyn:", err));

        return JSON.stringify({ booked: true, eventId: result.eventId });
      }

      case "find_my_appointments": {
        const appointments = await findUpcomingAppointmentsForPhone(clientPhone);
        return JSON.stringify({ appointments });
      }

      case "cancel_appointment": {
        await cancelAppointment(input.event_id);
        return JSON.stringify({ cancelled: true });
      }

      case "escalate_to_human": {
        if (!businessConfig.humanContact.whatsappNumber) {
          return JSON.stringify({
            escalated: false,
            error: "No hay número de WhatsApp configurado para el contacto humano.",
          });
        }
        await notifyHuman(input.reason, clientPhone, input.summary);
        return JSON.stringify({ escalated: true });
      }

      default:
        return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err?.message || "Error ejecutando la herramienta" });
  }
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * Procesa un mensaje entrante de un cliente: mantiene el historial de la
 * conversación, llama a Claude con las herramientas disponibles, ejecuta
 * las que Claude solicite, y devuelve el texto final para responder por
 * WhatsApp.
 */
export async function handleIncomingMessage(
  clientPhone: string,
  userText: string
): Promise<string> {
  const history = getHistory(clientPhone);
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: userText },
  ];

  let finalText = "";
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await executeTool(toolUse.name, toolUse.input, clientPhone);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) {
    finalText =
      "Disculpa, tuve un problema procesando tu mensaje. ¿Puedes intentar de nuevo o contactar directamente?";
  }

  // Guardamos en el historial solo los mensajes nuevos de este turno
  const newMessages = messages.slice(history.length);
  appendMessages(clientPhone, newMessages);

  return finalText;
}
