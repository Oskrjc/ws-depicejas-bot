import type { AppConfig } from "./config";
import { businessConfig } from "./businessConfig";
import type { Reservation } from "./reservationsDb";

/**
 * Integración con MercadoPago Checkout Pro, llamando directo a su API REST
 * con fetch() en vez de usar el SDK oficial de Node — el SDK no está
 * garantizado en el runtime de Cloudflare Workers (V8 isolates, no Node.js
 * completo), y fetch() es justamente lo que el SDK termina usando por
 * debajo. Mismo comportamiento externo, sin esa dependencia.
 *
 * Referencia: https://www.mercadopago.cl/developers/es/reference
 */

const MP_API = "https://api.mercadopago.com";

/**
 * Crea una "preferencia" de pago para una reserva y devuelve la URL de
 * checkout a la que hay que redirigir al cliente.
 */
export async function createPaymentPreference(
  config: AppConfig,
  reservation: Reservation,
  priceClp: number
): Promise<{ preferenceId: string; checkoutUrl: string }> {
  // MercadoPago rechaza "auto_return" cuando back_urls apunta a localhost
  // (no puede validar una URL que no es pública) — por eso solo lo pedimos
  // cuando BASE_URL ya está configurada a una URL real (producción).
  const isLocalBaseUrl = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(config.baseUrl);

  const body = {
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
      // Sin "identification" aquí, el RUT lo pide MercadoPago en su propio
      // checkout al momento de ingresar la tarjeta (ya no lo pedimos en el
      // formulario de la web).
    },
    back_urls: {
      success: `${config.baseUrl}/reserva-exitosa.html`,
      pending: `${config.baseUrl}/reserva-pendiente.html`,
      failure: `${config.baseUrl}/reserva-fallida.html`,
    },
    ...(isLocalBaseUrl ? {} : { auto_return: "approved" }),
    // Nos permite, en el webhook, encontrar a qué reserva corresponde el pago.
    external_reference: String(reservation.id),
    notification_url: `${config.baseUrl}/api/payments/webhook`,
  };

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mercadopagoAccessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID(),
      // fetch() en el runtime de Workers no manda User-Agent por defecto
      // (a diferencia de curl o del SDK de Node) — sin esto, el motor
      // antifraude de MercadoPago (PolicyAgent) rechaza la request con 403
      // PA_UNAUTHORIZED_RESULT_FROM_POLICIES aunque el token sea válido.
      "User-Agent": "DepicejasBeyondBeauty/1.0 (+https://depicejas.cl)",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MercadoPago rechazó la preferencia de pago (${res.status}): ${errText}`);
  }

  const result = (await res.json()) as {
    id?: string;
    init_point?: string;
    sandbox_init_point?: string;
  };

  // init_point es SIEMPRE la URL de checkout correcta según el tipo de
  // credencial usada (prueba o producción) — hay que priorizarla.
  // sandbox_init_point queda solo como respaldo por si alguna vez
  // init_point no viniera en la respuesta.
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
  /** Monto que MercadoPago dice haber cobrado — se valida contra el precio guardado en la reserva antes de confirmarla (ver app.ts). */
  transactionAmount: number | null;
  currencyId: string | null;
}

/** Consulta el estado de un pago por su ID (usado desde el webhook). */
export async function getPayment(config: AppConfig, paymentId: string): Promise<MpPaymentInfo> {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${config.mercadopagoAccessToken}`,
      "User-Agent": "DepicejasBeyondBeauty/1.0 (+https://depicejas.cl)",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`No se pudo consultar el pago ${paymentId} (${res.status}): ${errText}`);
  }

  const result = (await res.json()) as {
    id?: string | number;
    status?: string;
    external_reference?: string | null;
    transaction_amount?: number | null;
    currency_id?: string | null;
  };

  return {
    paymentId: String(result.id),
    status: result.status || "unknown",
    externalReference: result.external_reference ?? null,
    transactionAmount: result.transaction_amount ?? null,
    currencyId: result.currency_id ?? null,
  };
}
