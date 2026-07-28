import readline from "readline";
import { businessConfig } from "./businessConfig";

/**
 * Simulador de respuestas SIN llamar a la API de Claude — no cuesta nada,
 * no necesita ninguna clave ni archivo .env. Útil para revisar el guion
 * (FAQ, servicios, tono, flujo de agendamiento) antes de conectar el
 * modelo real.
 *
 * IMPORTANTE: esto NO es inteligencia real. Solo reconoce palabras clave
 * simples con reglas fijas. El bot real (con Claude, vía `npm run chat`)
 * entiende lenguaje natural de verdad, mantiene el contexto de la
 * conversación y resuelve casos que este simulador no reconoce.
 *
 * Uso: npm run chat:mock
 */

type BookingState = {
  step: "idle" | "service" | "date" | "time" | "name" | "done";
  service?: string;
  date?: string;
  time?: string;
  name?: string;
};

const state: BookingState = { step: "idle" };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("=== Simulador de respuestas (sin IA, sin costo) ===");
console.log(`Bot de ${businessConfig.name}\n`);
console.log(
  "Este modo NO usa Claude, solo palabras clave simples — sirve para revisar el\n" +
    "tono y el flujo, no la inteligencia real del bot (eso lo ves con `npm run chat`).\n" +
    'Prueba: "hola", "precios", "agendar", "¿cómo se paga?", "domicilio", "queja".\n' +
    'Escribe "salir" para terminar.\n'
);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quita tildes
}

function findFaqAnswer(text: string): string | null {
  const n = normalize(text);
  for (const item of businessConfig.faq) {
    const qWords = normalize(item.question)
      .split(/\W+/)
      .filter((w) => w.length > 3);
    if (qWords.some((w) => n.includes(w))) {
      return item.answer;
    }
  }
  return null;
}

function listServices(): string {
  return businessConfig.services
    .map((s) => `• ${s.name}: ${s.priceInfo} (${s.durationMinutes} min aprox.)`)
    .join("\n");
}

function findService(text: string): string | null {
  const n = normalize(text);
  const match = businessConfig.services.find((s) => n.includes(normalize(s.name)));
  return match ? match.name : null;
}

function respond(text: string): string {
  const n = normalize(text);

  // Flujo de agendamiento en curso (simulado paso a paso)
  if (state.step === "service") {
    const svc = findService(text);
    if (svc) {
      state.service = svc;
      state.step = "date";
      return `¡Perfecto, ${svc}! ¿Qué día te gustaría? Recuerda que atendemos jueves y domingo.`;
    }
    return `No reconocí ese servicio exacto. Algunos disponibles:\n${listServices()}\n\n¿Cuál te interesa?`;
  }

  if (state.step === "date") {
    state.date = text.trim();
    state.step = "time";
    return `[simulando check_availability para "${state.date}"...]\nTengo horarios disponibles ese día dentro del horario de atención. ¿A qué hora te gustaría?`;
  }

  if (state.step === "time") {
    state.time = text.trim();
    state.step = "name";
    return "¡Genial! ¿Me confirmas tu nombre completo para la reserva?";
  }

  if (state.step === "name") {
    state.name = text.trim();
    state.step = "done";
    return (
      `[simulando book_appointment: ${state.service}, ${state.date} ${state.time}, ${state.name}]\n` +
      `[simulando notificación automática a Joselyn (${businessConfig.humanContact.whatsappNumber}) — pendiente de abono]\n\n` +
      "Tu horario queda reservado de forma preliminar ✨ Joselyn te va a escribir para coordinar el abono del 20% y confirmar la cita."
    );
  }

  // Palabras clave de inicio de flujo
  if (/\b(agendar|reservar|cita|hora)\b/.test(n)) {
    state.step = "service";
    return `¡Con gusto! ¿Qué servicio te gustaría agendar?\n\n${listServices()}`;
  }

  if (/\b(queja|reclamo|molest|problema)\w*/.test(n)) {
    return '[simulando escalate_to_human: motivo="queja"]\nLamento mucho el inconveniente. Le aviso a Joselyn ahora mismo para que te contacte directamente.';
  }

  if (/\bdomicilio\b/.test(n)) {
    return '[simulando escalate_to_human: motivo="solicitud a domicilio"]\nPara atención a domicilio el precio varía según tu ubicación — le aviso a Joselyn para que te confirme el costo y coordine contigo.';
  }

  if (/\b(precio|precios|catalogo|servicios|lista)\w*/.test(n) || n.includes("cuanto cuesta")) {
    return `Estos son nuestros servicios:\n\n${listServices()}`;
  }

  if (/\b(hola|buenas|buenos dias|buenas tardes)\w*/.test(n)) {
    return `¡Hola! 👋 Bienvenida a ${businessConfig.name}. ¿En qué te puedo ayudar? Puedo darte info de nuestros servicios o agendar tu cita.`;
  }

  const faqAnswer = findFaqAnswer(text);
  if (faqAnswer) return faqAnswer;

  return (
    "No tengo una respuesta simulada para eso — con el bot real (`npm run chat`) " +
    'esto sí lo resolvería. Prueba con "precios", "agendar", o alguna de las FAQ configuradas.'
  );
}

function prompt(): void {
  rl.question("Tú: ", (text) => {
    const trimmed = text.trim();

    if (!trimmed) {
      prompt();
      return;
    }

    if (trimmed.toLowerCase() === "salir") {
      rl.close();
      return;
    }

    console.log(`\nBot: ${respond(trimmed)}\n`);
    prompt();
  });
}

prompt();

rl.on("close", () => {
  console.log("\nSimulación terminada.");
  process.exit(0);
});
