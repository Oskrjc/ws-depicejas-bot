import type { D1Database, Fetcher } from "@cloudflare/workers-types";

/**
 * En Railway/Express, `config` era un objeto global armado una sola vez al
 * arrancar el proceso (leyendo `.env`). En Cloudflare Workers no hay
 * "arrancar el proceso" — cada request llega con su propio `env` (los
 * bindings/variables configurados en el dashboard o en wrangler.toml), así
 * que armamos el objeto de configuración por request con getConfig(env).
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;

  MERCADOPAGO_ACCESS_TOKEN?: string;
  BASE_URL?: string;

  RESEND_API_KEY?: string;
  // Remitente completo, ej: "Depicejas Beyond Beauty <reservas@depicejas.cl>"
  MAIL_FROM?: string;
  OWNER_NOTIFICATION_EMAIL?: string;
}

export interface AppConfig {
  adminUsername: string;
  adminPassword: string;
  mercadopagoAccessToken: string;
  baseUrl: string;
  resendApiKey: string;
  mailFrom: string;
  ownerNotificationEmail: string;
}

export function getConfig(env: Env): AppConfig {
  return {
    adminUsername: env.ADMIN_USERNAME || "admin",
    adminPassword: env.ADMIN_PASSWORD || "",
    mercadopagoAccessToken: env.MERCADOPAGO_ACCESS_TOKEN || "",
    baseUrl: (env.BASE_URL || "").replace(/\/$/, ""),
    resendApiKey: env.RESEND_API_KEY || "",
    mailFrom: env.MAIL_FROM || "",
    ownerNotificationEmail: env.OWNER_NOTIFICATION_EMAIL || "",
  };
}

export function isMercadoPagoConfigured(config: AppConfig): boolean {
  return Boolean(config.mercadopagoAccessToken);
}

export function isMailerConfigured(config: AppConfig): boolean {
  return Boolean(config.resendApiKey && config.mailFrom && config.ownerNotificationEmail);
}
