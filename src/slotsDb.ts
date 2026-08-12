import type { D1Database } from "./dbClient";

/**
 * Horarios de atención que Joselyn (o Oscar) abren manualmente desde el
 * panel de administrador. El formulario público de reservas solo deja
 * elegir entre los horarios "available" — así se evita que dos clientas
 * reserven la misma hora, y ya no se depende de que la clienta escriba una
 * fecha/hora libremente.
 *
 * El esquema vive en migrations/0001_init.sql. La operación crítica
 * (bookSlot) sigue siendo segura frente a reservas simultáneas: aunque
 * Workers sí puede atender pedidos en paralelo (a diferencia del Node
 * single-threaded de Railway), D1 serializa las escrituras de una misma
 * base — el UPDATE ... WHERE status = 'available' es atómico igual.
 */

export type SlotStatus = "available" | "booked";

export interface Slot {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  status: SlotStatus;
  reservationId: number | null;
}

export interface SlotWithReservation extends Slot {
  reservationName: string | null;
}

const SELECT_COLUMNS = `id, date, time, status, reservation_id as reservationId`;

/**
 * Crea horarios disponibles para una fecha (uno o varios de una vez, en un
 * solo batch atómico). Si alguno ya existía (misma fecha+hora) se ignora en
 * silencio, para poder reintentar sin duplicar ni romper por la
 * restricción UNIQUE.
 */
export async function createSlots(db: D1Database, date: string, times: string[]): Promise<Slot[]> {
  if (times.length > 0) {
    const statements = times.map((time) =>
      db.prepare(`INSERT OR IGNORE INTO slots (date, time) VALUES (?, ?)`).bind(date, time)
    );
    await db.batch(statements);
  }
  return listSlotsByDate(db, date);
}

export async function listSlotsByDate(db: D1Database, date: string): Promise<Slot[]> {
  const { results } = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM slots WHERE date = ? ORDER BY time ASC`)
    .bind(date)
    .all();
  return (results ?? []) as unknown as Slot[];
}

/** Todos los horarios (para el panel de administrador), con el nombre de la clienta si ya está reservado. */
export async function listAllSlots(db: D1Database): Promise<SlotWithReservation[]> {
  const { results } = await db
    .prepare(
      `
    SELECT s.id, s.date, s.time, s.status, s.reservation_id as reservationId, r.name as reservationName
    FROM slots s
    LEFT JOIN reservations r ON r.id = s.reservation_id
    ORDER BY s.date ASC, s.time ASC
  `
    )
    .all();
  return (results ?? []) as unknown as SlotWithReservation[];
}

/** Horarios disponibles a futuro (para el formulario público de reserva). */
export async function listAvailableSlots(db: D1Database): Promise<Slot[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM slots WHERE status = 'available' AND date >= ? ORDER BY date ASC, time ASC`
    )
    .bind(today)
    .all();
  return (results ?? []) as unknown as Slot[];
}

/**
 * Marca un horario disponible como reservado, de forma atómica: si ya no
 * estaba disponible (otra clienta se lo llevó antes) no hace nada y
 * devuelve false, para que el llamador pueda avisar y no cobrar dos veces
 * la misma hora.
 */
export async function bookSlot(db: D1Database, date: string, time: string, reservationId: number): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE slots SET status = 'booked', reservation_id = ? WHERE date = ? AND time = ? AND status = 'available'`)
    .bind(reservationId, date, time)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Libera el horario ligado a una reserva (pago rechazado/cancelado, o la reserva se eliminó desde el panel). */
export async function freeSlotByReservationId(db: D1Database, reservationId: number): Promise<void> {
  await db.prepare(`UPDATE slots SET status = 'available', reservation_id = NULL WHERE reservation_id = ?`).bind(reservationId).run();
}

/** Elimina un horario disponible. Si ya está reservado, no lo borra (hay que liberar/eliminar la reserva primero). */
export async function deleteAvailableSlot(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM slots WHERE id = ? AND status = 'available'`).bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getSlotById(db: D1Database, id: number): Promise<Slot | undefined> {
  const row = await db.prepare(`SELECT ${SELECT_COLUMNS} FROM slots WHERE id = ?`).bind(id).first();
  return (row ?? undefined) as unknown as Slot | undefined;
}
