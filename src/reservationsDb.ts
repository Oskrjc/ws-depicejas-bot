import type { D1Database } from "./dbClient";

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
  /** Fecha/hora (ISO) en que el cliente aceptó la Política de Privacidad al reservar — prueba de consentimiento. */
  consentAcceptedAt: string | null;
}

export interface NewReservation {
  name: string;
  email: string;
  phone?: string;
  /** Nombres de los servicios elegidos, ya unidos en un solo texto para mostrar (ver src/app.ts). */
  service: string;
  preferredDate: string;
  preferredTime: string;
  notes?: string;
  /** Monto que se cobra por MercadoPago (según paymentOption: 20% o el total). */
  price?: number;
  /** Suma de los precios completos de todos los servicios elegidos, sin descuento. */
  fullPrice?: number;
  paymentOption?: PaymentOption;
  /** ISO de cuándo el cliente marcó el checkbox de la Política de Privacidad (ver POST /api/reservations en app.ts). */
  consentAcceptedAt?: string;
}

// El esquema de la tabla vive en migrations/0001_init.sql (se aplica una
// sola vez con `wrangler d1 migrations apply`) — a diferencia de
// better-sqlite3, D1 no tiene una conexión "de arranque" donde correr un
// CREATE TABLE IF NOT EXISTS en cada import.

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
  mp_payment_id as mpPaymentId,
  consent_accepted_at as consentAcceptedAt
`;

function toReservation(row: any): Reservation {
  return { ...row, contacted: Boolean(row.contacted) };
}

export async function saveReservation(db: D1Database, reservation: NewReservation): Promise<Reservation> {
  const result = await db
    .prepare(
      `INSERT INTO reservations (name, email, phone, service, preferred_date, preferred_time, notes, price, full_price, payment_option, consent_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      reservation.name,
      reservation.email,
      reservation.phone ?? null,
      reservation.service,
      reservation.preferredDate,
      reservation.preferredTime,
      reservation.notes ?? null,
      reservation.price ?? null,
      reservation.fullPrice ?? null,
      reservation.paymentOption ?? null,
      reservation.consentAcceptedAt ?? null
    )
    .run();

  const id = result.meta.last_row_id as number;
  return (await getReservationById(db, id))!;
}

export async function getReservationById(db: D1Database, id: number): Promise<Reservation | undefined> {
  const row = await db.prepare(`SELECT ${SELECT_COLUMNS} FROM reservations WHERE id = ?`).bind(id).first();
  return row ? toReservation(row) : undefined;
}

export async function getReservationByExternalReference(
  db: D1Database,
  externalReference: string
): Promise<Reservation | undefined> {
  // external_reference es el id de la reserva convertido a string (ver mercadopago.ts)
  const id = Number(externalReference);
  if (!Number.isFinite(id)) return undefined;
  return getReservationById(db, id);
}

export async function listReservations(db: D1Database): Promise<Reservation[]> {
  const { results } = await db.prepare(`SELECT ${SELECT_COLUMNS} FROM reservations ORDER BY created_at DESC`).all();
  return (results ?? []).map(toReservation);
}

/**
 * Cuenta cuántas reservas previas existen con este correo (usado para medir
 * recompra — Fase 5 de la auditoría: saber si quien reserva es clienta
 * nueva o ya había reservado antes).
 */
export async function countReservationsByEmail(db: D1Database, email: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM reservations WHERE email = ?`)
    .bind(email)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function setReservationContacted(
  db: D1Database,
  id: number,
  contacted: boolean
): Promise<Reservation | undefined> {
  await db.prepare(`UPDATE reservations SET contacted = ? WHERE id = ?`).bind(contacted ? 1 : 0, id).run();
  return getReservationById(db, id);
}

export async function deleteReservation(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM reservations WHERE id = ?`).bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Guarda el ID de la preferencia de MercadoPago recién creada para esta reserva. */
export async function setReservationPreferenceId(
  db: D1Database,
  id: number,
  mpPreferenceId: string
): Promise<Reservation | undefined> {
  await db.prepare(`UPDATE reservations SET mp_preference_id = ? WHERE id = ?`).bind(mpPreferenceId, id).run();
  return getReservationById(db, id);
}

/** Actualiza el estado del pago (llamado desde el webhook de MercadoPago). */
export async function setReservationPaymentStatus(
  db: D1Database,
  id: number,
  paymentStatus: PaymentStatus,
  mpPaymentId: string
): Promise<Reservation | undefined> {
  await db
    .prepare(`UPDATE reservations SET payment_status = ?, mp_payment_id = ? WHERE id = ?`)
    .bind(paymentStatus, mpPaymentId, id)
    .run();
  return getReservationById(db, id);
}
