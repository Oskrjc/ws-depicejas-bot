import type { D1Database } from "@cloudflare/workers-types";

/**
 * En better-sqlite3 (Railway) había una única conexión global importada por
 * todos los módulos. En Cloudflare Workers no existe eso: el binding de D1
 * llega por request a través de `env` (ver src/app.ts), así que cada
 * función de reservationsDb.ts / slotsDb.ts recibe el binding como primer
 * parámetro en vez de importar un singleton.
 *
 * Este archivo solo reexporta el tipo para no repetir el import en cada
 * módulo.
 */
export type { D1Database };
