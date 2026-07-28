import readline from "readline";
import { handleIncomingMessage } from "./claude";

/**
 * Chat de prueba por consola — simula una conversación de WhatsApp sin
 * necesitar Meta, ngrok ni un número real. Solo requiere ANTHROPIC_API_KEY
 * configurada en .env. Si además configuras GOOGLE_CALENDAR_ID y la cuenta
 * de servicio, el agendamiento de citas también funcionará de verdad.
 *
 * Uso: npm run chat
 */

// Número ficticio para esta sesión de prueba (así el bot mantiene el
// historial de la conversación como si fuera un cliente real).
const TEST_PHONE = "56900000000";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("=== Chat de prueba — Depicejas Beyond Beauty ===");
console.log('Escribe como si fueras un cliente. Escribe "salir" o Ctrl+C para terminar.\n');

function prompt(): void {
  rl.question("Tú: ", async (text) => {
    const trimmed = text.trim();

    if (!trimmed) {
      prompt();
      return;
    }

    if (trimmed.toLowerCase() === "salir") {
      rl.close();
      return;
    }

    try {
      const reply = await handleIncomingMessage(TEST_PHONE, trimmed);
      console.log(`\nBot: ${reply}\n`);
    } catch (err) {
      console.error("\n[Error procesando el mensaje]:", err, "\n");
    }

    prompt();
  });
}

prompt();

rl.on("close", () => {
  console.log("\nChat de prueba terminado.");
  process.exit(0);
});
