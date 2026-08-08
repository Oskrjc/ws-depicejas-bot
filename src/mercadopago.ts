import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { config } from "./config";
import { businessConfig } from "./businessConfig";
import type { Reservation } from "./reservationsDb";

/**
 * Integración con MercadoPago Checkout Pro: el cliente se redirige a la
 * página de pago de MercadoPago (nosotros nunca manejamos tarjetas), y
 * MercadoPago nos avisa el resultado por dos vías:
 *  1. Redirigiendo al cliente de vuelta a una de las back_urls.
 *  2. Un webhook servidor-a-servidor a /api/payments/webhook (la fuente de
 *     verdad — la redirección del cliente puede perderse o no confirmarse).
 */

export function isMercadoPagoConfigured(): boolean {
  return Boolean(config.mercadopagoAccessToken);
}

let client: MercadoPagoConfig | null = null;

function getClient(): MercadoPagoConfig {
  if (!client) {
    client = new MercadoPagoConfig({ accessToken: config.mercadopagoAccessToken });
  }
  return client;
}

/**
 * Crea una "preferencia" de pago para una reserva y devuelve la URL de
 * checkout a la que hay que redirigir al cliente.
 */
export async function createPaymentPreference(
  reservation: Reservation,
  priceClp: number,
  payerRut: string
): Promise<{ preferenceId: string; checkoutUrl: string }> {
  const preference = new Preference(getClient());

  // MercadoPago rechaza "auto_return" cuando back_urls apunta a localhost
  // (no puede validar una URL que no es pública) — por eso solo lo pedimos
  // cuando BASE_URL ya está configurada a una URL real (producción). En
  // local, el cliente vuelve igual pero con un botón manual en vez de
  // redirección automática a los pocos segundos.
  const isLocalBaseUrl = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(config.baseUrl);

  const result = await preference.create({
    body: {
      items: [
        {
          id: `reservation-${reservation.id}`,
          title: `${reservation.service} — ${businessConfig.name}`,
          quantity: 1,
          unit_price: priceClp,
          currency_id: "CLP",
        },
      ],
      payer: {
        name: reservation.name,
        email: reservation.email,
        // Obligatorio para que MercadoPago procese pagos con tarjeta en
        // Chile — sin esto, el botón "Pagar" de su checkout queda
        // deshabilitado sin mostrar ningún error.
        identification: { type: "RUT", number: payerRut },
      },
      back_urls: {
        success: `${config.baseUrl}/reserva-exitosa.html`,
        pending: `${config.baseUrl}/reserva-pendiente.html`,
        failure: `${config.baseUrl}/reserva-fallida.html`,
      },
      ...(isLocalBaseUrl ? {} : { auto_return: "approved" as const }),
      // Nos permite, en el webhook, encontrar a qué reserva corresponde el pago.
      external_reference: String(reservation.id),
      notification_url: `${config.baseUrl}/api/payments/webhook`,
    },
  });

  // init_point es SIEMPRE la URL de checkout correcta según el tipo de
  // credencial usada (prueba o producción) — hay que priorizarla. Antes este
  // código prefería sandbox_init_point si venía presente, lo cual mandaba a
  // los clientes al ambiente de prueba incluso usando el Access Token de
  // producción real. sandbox_init_point queda solo como respaldo por si
  // alguna vez init_point no viniera en la respuesta.
  const checkoutUrl = result.init_point || result.sandbox_init_point;

  if (!result.id || !checkoutUrl) {
    throw new Error("MercadoPago no devolvió una preferencia de pago válida.");
  }

  return { preferenceId: result.id, checkoutUrl };
}

export interface MpPaymentInfo {
  paymentId: string;
  status: string; // "approved" | "pending" | "in_process" | "rejected" | "refunded" | ...
  externalReference: string | null;
}

/** Consulta el estado de un pago por su ID (usado desde el webhook). */
export async function getPayment(paymentId: string): Promise<MpPaymentInfo> {
  const payment = new Payment(getClient());
  const result = await payment.get({ id: paymentId });

  return {
    paymentId: String(result.id),
    status: result.status || "unknown",
    externalReference: result.external_reference ?? null,
  };
}
