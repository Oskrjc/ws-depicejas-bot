import { db } from "./db";

// Espejo del campo "status" de MercadoPago — se guarda tal cual viene
// (valores típicos: pending, approved, in_process, rejected, cancelled,
// refunded, charged_back). No lo restringimos a un enum fijo para no romper
// si MercadoPago agrega un estado nuevo.
export type PaymentStatus = string;

// Qué eligió pagar el cliente al reservar por la web: el abono del 20% o el
// valor completo del servicio.
export type PaymentOption = "deposit" | "full";

export interface Reservation {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  service: string;
  preferredDate: string;
  preferredTime: string;
  notes: string | null;
  contacted: boolean;
  createdAt: string;
  price: number | null;
  fullPrice: number | null;
  paymentOption: PaymentOption | null;
  paymentStatus: PaymentStatus;
  mpPreferenceId: string | null;
  mpPaymentId: string | null;
}

export interface NewReservation {
  name: string;
  email: string;
  phone?: string;
  /** Nombres de los servicios elegidos, ya unidos en un solo texto para mostrar (ver server.ts). */
  service: string;
  preferredDate: string;
  preferredTime: string;
  notes?: string;
  /** Monto que se cobra por MercadoPago (según paymentOption: 20% o el total). */
  price?: number;
  /** Suma de los precios completos de todos los servicios elegidos, sin descuento. */
  fullPrice?: number;
  paymentOption?: PaymentOption;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    service TEXT NOT NULL,
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migraciones: agrega columnas si la tabla existía de antes (better-sqlite3
// no tiene "ADD COLUMN IF NOT EXISTS", así que revisamos manualmente).
const existingColumns = db.prepare(`PRAGMA table_info(reservations)`).all() as { name: string }[];
function addColumnIfMissing(name: string, definition: string): void {
  if (!existingColumns.some((col) => col.name === name)) {
    db.exec(`ALTER TABLE reservations ADD COLUMN ${name} ${definition}`);
  }
}
addColumnIfMissing("contacted", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("price", "INTEGER");
addColumnIfMissing("full_price", "INTEGER");
addColumnIfMissing("payment_option", "TEXT");
addColumnIfMissing("payment_status", "TEXT NOT NULL DEFAULT 'pending'");
addColumnIfMissing("mp_preference_id", "TEXT");
addColumnIfMissing("mp_payment_id", "TEXT");

const insertStmt = db.prepare(`
  INSERT INTO reservations (name, email, phone, service, preferred_date, preferred_time, notes, price, full_price, payment_option)
  VALUES (@name, @email, @phone, @service, @preferredDate, @preferredTime, @notes, @price, @fullPrice, @paymentOption)
`);

const SELECT_COLUMNS = `
  id, name, email, phone, service,
  preferred_date as preferredDate,
  preferred_time as preferredTime,
  notes, contacted, created_at as createdAt,
  price,
  full_price as fullPrice,
  payment_option as paymentOption,
  payment_status as paymentStatus,
  mp_preference_id as mpPreferenceId,
  mp_payment_id as mpPaymentId
`;

function toReservation(row: any): Reservation {
  return { ...row, contacted: Boolean(row.contacted) };
}

export function saveReservation(reservation: NewReservation): Reservation {
  const info = insertStmt.run({
    name: reservation.name,
    email: reservation.email,
    phone: reservation.phone ?? null,
    service: reservation.service,
    preferredDate: reservation.preferredDate,
    preferredTime: reservation.preferredTime,
    notes: reservation.notes ?? null,
    price: reservation.price ?? null,
    fullPrice: reservation.fullPrice ?? null,
    paymentOption: reservation.paymentOption ?? null,
  });

  return getReservationById(Number(info.lastInsertRowid))!;
}

export function getReservationById(id: number): Reservation | undefined {
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM reservations WHERE id = ?`).get(id);
  return row ? toReservation(row) : undefined;
}

export function getReservationByExternalReference(externalReference: string): Reservation | undefined {
  // external_reference es el id de la reserva convertido a string (ver mercadopago.ts)
  const id = Number(externalReference);
  if (!Number.isFinite(id)) return undefined;
  return getReservationById(id);
}

export function listReservations(): Reservation[] {
  const rows = db.prepare(`SELECT ${SELECT_COLUMNS} FROM reservations ORDER BY created_at DESC`).all();
  return rows.map(toReservation);
}

export function setReservationContacted(id: number, contacted: boolean): Reservation | undefined {
  db.prepare(`UPDATE reservations SET contacted = ? WHERE id = ?`).run(contacted ? 1 : 0, id);
  return getReservationById(id);
}

export function deleteReservation(id: number): boolean {
  const info = db.prepare(`DELETE FROM reservations WHERE id = ?`).run(id);
  return info.changes > 0;
}

/** Guarda el ID de la preferencia de MercadoPago recién creada para esta reserva. */
export function setReservationPreferenceId(id: number, mpPreferenceId: string): Reservation | undefined {
  db.prepare(`UPDATE reservations SET mp_preference_id = ? WHERE id = ?`).run(mpPreferenceId, id);
  return getReservationById(id);
}

/** Actualiza el estado del pago (llamado desde el webhook de MercadoPago). */
export function setReservationPaymentStatus(
  id: number,
  paymentStatus: PaymentStatus,
  mpPaymentId: string
): Reservation | undefined {
  db.prepare(`UPDATE reservations SET payment_status = ?, mp_payment_id = ? WHERE id = ?`).run(
    paymentStatus,
    mpPaymentId,
    id
  );
  return getReservationById(id);
}
