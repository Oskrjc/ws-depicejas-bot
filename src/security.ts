import type { Context, Next } from "hono";
import type { D1Database } from "./dbClient";
import type { Env } from "./config";

/**
 * Utilidades de seguridad agregadas a partir de la auditoría del proyecto
 * (rate limiting, bloqueo por intentos, headers HTTP, límite de tamaño de
 * payload, y protección CSRF vía header personalizado).
 */

// ── Identificar al cliente ──────────────────────────────────────────────
/** Cloudflare siempre setea este header con la IP real del visitante — más confiable que X-Forwarded-For. */
export function getClientIp(c: Context): string {
  return c.req.header("CF-Connecting-IP") || "unknown";
}

// ── Rate limiting / bloqueo por intentos (basado en D1) ──────────────────
async function countRecentEvents(db: D1Database, type: string, ip: string, windowSeconds: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM security_events
       WHERE type = ? AND ip = ? AND created_at >= datetime('now', ?)`
    )
    .bind(type, ip, `-${windowSeconds} seconds`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function logEvent(db: D1Database, type: string, ip: string): Promise<void> {
  await db.prepare(`INSERT INTO security_events (type, ip) VALUES (?, ?)`).bind(type, ip).run();
}

/**
 * Límite simple de solicitudes por IP en una ventana de tiempo. Registra el
 * intento SIEMPRE (incluso si se rechaza), para que ventanas sucesivas de
 * abuso sigan bloqueadas.
 */
export async function checkRateLimit(
  db: D1Database,
  ip: string,
  type: string,
  maxCount: number,
  windowSeconds: number
): Promise<boolean> {
  const count = await countRecentEvents(db, type, ip, windowSeconds);
  await logEvent(db, type, ip);
  return count < maxCount;
}

const ADMIN_LOGIN_FAILURE = "admin_login_failure";
const ADMIN_LOGIN_SUCCESS = "admin_login_success";
const ADMIN_LOCKOUT_MAX_FAILURES = 10;
const ADMIN_LOCKOUT_WINDOW_SECONDS = 10 * 60; // 10 minutos

/** true si esta IP superó el máximo de intentos fallidos en la ventana reciente. */
export async function isAdminLockedOut(db: D1Database, ip: string): Promise<boolean> {
  const failures = await countRecentEvents(db, ADMIN_LOGIN_FAILURE, ip, ADMIN_LOCKOUT_WINDOW_SECONDS);
  return failures >= ADMIN_LOCKOUT_MAX_FAILURES;
}

export async function logAdminLoginFailure(db: D1Database, ip: string): Promise<void> {
  await logEvent(db, ADMIN_LOGIN_FAILURE, ip);
}

export async function logAdminLoginSuccess(db: D1Database, ip: string): Promise<void> {
  await logEvent(db, ADMIN_LOGIN_SUCCESS, ip);
}

// ── Headers de seguridad ───────────────────────────────────────────────
// CSP calibrada para lo que realmente carga el sitio: Google Fonts, Google
// Tag Manager + Analytics (solo tras aceptar cookies), el mapa embebido de
// Google Maps, y las páginas propias. MercadoPago no necesita entrar acá
// porque el checkout es una redirección de página completa, no contenido
// embebido — no compartimos su origen con el nuestro.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "frame-src https://www.google.com",
  "connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://region1.google-analytics.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * Aplica headers de seguridad a TODAS las respuestas, incluyendo los
 * archivos estáticos servidos por ASSETS (por eso va como el primer
 * middleware, antes de cualquier ruta — corre después de next() para
 * poder tocar la respuesta ya generada, sea de una ruta o de un asset).
 */
export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next();
  // Las respuestas que vienen de c.env.ASSETS.fetch() (archivos estáticos)
  // traen headers INMUTABLES — hay que reconstruir la respuesta para poder
  // agregarles algo, si no tira "TypeError: immutable" y la request entera
  // termina en 500.
  const res = new Response(c.res.body, c.res);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(self)");
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set("Content-Security-Policy", CSP);
  c.res = res;
}

// ── Límite de tamaño de payload ─────────────────────────────────────────
const MAX_BODY_BYTES = 50_000; // 50 KB — de sobra para el JSON más grande que mandamos (reserva con notas)

export async function bodySizeLimit(c: Context, next: Next): Promise<Response | void> {
  const contentLength = c.req.header("Content-Length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return c.json({ error: "La solicitud es demasiado grande." }, 413);
  }
  await next();
}

// ── Protección CSRF para el panel de administrador ──────────────────────
// Basic Auth ya evita que un formulario/fetch cross-site "simple" alcance
// estas rutas sin credenciales, pero exigir además este header personalizado
// obliga a que el request pase por un preflight CORS (que nuestro servidor
// no autoriza para otros orígenes) — así una página maliciosa no puede
// disparar estas acciones aunque el navegador tenga la sesión guardada.
const CSRF_HEADER = "X-Depicejas-Admin";

export async function requireCsrfHeader(c: Context, next: Next): Promise<Response | void> {
  if (c.req.header(CSRF_HEADER) !== "1") {
    return c.json({ error: "Solicitud rechazada (falta encabezado de seguridad)." }, 403);
  }
  await next();
}
