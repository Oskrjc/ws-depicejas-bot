/**
 * Script puntual (NO se despliega) para volcar las reservas y horarios que
 * ya existen en el Railway en vivo hacia sentencias INSERT listas para
 * correr contra D1.
 *
 * Uso (una vez que Railway todavía esté corriendo):
 *
 *   RAILWAY_BASE_URL=https://depicejas.cl \
 *   ADMIN_USERNAME=admin \
 *   ADMIN_PASSWORD=xxxxx \
 *   npx ts-node --transpile-only migration/export-from-railway.ts
 *
 * Genera migration/data-export.sql. Después se aplica contra D1 con:
 *
 *   npx wrangler d1 execute depicejas-db --remote --file=migration/data-export.sql
 *
 * Preserva los IDs originales (incluye la columna "id" en los INSERT) para
 * que las referencias slots.reservation_id -> reservations.id sigan siendo
 * correctas tras la migración.
 */
import fs from "fs";
import path from "path";

const baseUrl = (process.env.RAILWAY_BASE_URL || "").replace(/\/$/, "");
const username = process.env.ADMIN_USERNAME || "";
const password = process.env.ADMIN_PASSWORD || "";

if (!baseUrl || !username || !password) {
  console.error("Faltan RAILWAY_BASE_URL, ADMIN_USERNAME o ADMIN_PASSWORD. Ver el comentario arriba de este archivo.");
  process.exit(1);
}

const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

function sqlString(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number | null | undefined): string {
  return value == null ? "NULL" : String(value);
}

function sqlBool(value: boolean): string {
  return value ? "1" : "0";
}

async function main() {
  const [reservationsRes, slotsRes] = await Promise.all([
    fetch(`${baseUrl}/admin/api/reservations`, { headers: { Authorization: authHeader } }),
    fetch(`${baseUrl}/admin/api/slots`, { headers: { Authorization: authHeader } }),
  ]);

  if (!reservationsRes.ok) throw new Error(`No se pudo leer reservas: ${reservationsRes.status}`);
  if (!slotsRes.ok) throw new Error(`No se pudo leer horarios: ${slotsRes.status}`);

  const reservations = (await reservationsRes.json()) as any[];
  const slots = (await slotsRes.json()) as any[];

  const lines: string[] = [];
  lines.push("-- Generado por migration/export-from-railway.ts — datos reales de Railway.");
  lines.push("");

  for (const r of reservations) {
    lines.push(
      `INSERT INTO reservations (id, name, email, phone, service, preferred_date, preferred_time, notes, created_at, contacted, price, full_price, payment_option, payment_status, mp_preference_id, mp_payment_id) VALUES (` +
        [
          sqlNumber(r.id),
          sqlString(r.name),
          sqlString(r.email),
          sqlString(r.phone),
          sqlString(r.service),
          sqlString(r.preferredDate),
          sqlString(r.preferredTime),
          sqlString(r.notes),
          sqlString(r.createdAt),
          sqlBool(Boolean(r.contacted)),
          sqlNumber(r.price),
          sqlNumber(r.fullPrice),
          sqlString(r.paymentOption),
          sqlString(r.paymentStatus),
          sqlString(r.mpPreferenceId),
          sqlString(r.mpPaymentId),
        ].join(", ") +
        ");"
    );
  }

  for (const s of slots) {
    lines.push(
      `INSERT INTO slots (id, date, time, status, reservation_id) VALUES (` +
        [sqlNumber(s.id), sqlString(s.date), sqlString(s.time), sqlString(s.status), sqlNumber(s.reservationId)].join(
          ", "
        ) +
        ");"
    );
  }

  const outPath = path.join(__dirname, "data-export.sql");
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  console.log(`Listo: ${reservations.length} reserva(s) y ${slots.length} horario(s) volcados a ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
