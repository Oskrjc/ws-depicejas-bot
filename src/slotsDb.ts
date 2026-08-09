import { db } from "./db";

/**
 * Horarios de atención que Joselyn (o Oscar) abren manualmente desde el
 * panel de administrador. El formulario público de reservas solo deja
 * elegir entre los horarios "available" — así se evita que dos clientas
 * reserven la misma hora, y ya no se depende de que la clienta escriba una
 * fecha/hora libremente.
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

db.exec(`
  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    reservation_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(date, time)
  )
`);

const SELECT_COLUMNS = `id, date, time, status, reservation_id as reservationId`;

/**
 * Crea horarios disponibles para una fecha (uno o varios de una vez). Si
 * alguno ya existía (misma fecha+hora) se ignora en silencio, para poder
 * reintentar sin duplicar ni romper por la restricción UNIQUE.
 */
export function createSlots(date: string, times: string[]): Slot[] {
  const insert = db.prepare(`INSERT OR IGNORE INTO slots (date, time) VALUES (?, ?)`);
  const insertMany = db.transaction((rows: string[]) => {
    for (const time of rows) insert.run(date, time);
  });
  insertMany(times);
  return listSlotsByDate(date);
}

export function listSlotsByDate(date: string): Slot[] {
  return db.prepare(`SELECT ${SELECT_COLUMNS} FROM slots WHERE date = ? ORDER BY time ASC`).all(date) as Slot[];
}

/** Todos los horarios (para el panel de administrador), con el nombre de la clienta si ya está reservado. */
export function listAllSlots(): SlotWithReservation[] {
  return db
    .prepare(
      `
    SELECT s.id, s.date, s.time, s.status, s.reservation_id as reservationId, r.name as reservationName
    FROM slots s
    LEFT JOIN reservations r ON r.id = s.reservation_id
    ORDER BY s.date ASC, s.time ASC
  `
    )
    .all() as SlotWithReservation[];
}

/** Horarios disponibles a futuro (para el formulario público de reserva). */
export function listAvailableSlots(): Slot[] {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM slots WHERE status = 'available' AND date >= ? ORDER BY date ASC, time ASC`
    )
    .all(today) as Slot[];
}

/**
 * Marca un horario disponible como reservado, de forma atómica: si ya no
 * estaba disponible (otra clienta se lo llevó antes) no hace nada y
 * devuelve false, para que el llamador pueda avisar y no cobrar dos veces
 * la misma hora.
 */
export function bookSlot(date: string, time: string, reservationId: number): boolean {
  const info = db
    .prepare(`UPDATE slots SET status = 'booked', reservation_id = ? WHERE date = ? AND time = ? AND status = 'available'`)
    .run(reservationId, date, time);
  return info.changes > 0;
}

/** Libera el horario ligado a una reserva (pago rechazado/cancelado, o la reserva se eliminó desde el panel). */
export function freeSlotByReservationId(reservationId: number): void {
  db.prepare(`UPDATE slots SET status = 'available', reservation_id = NULL WHERE reservation_id = ?`).run(reservationId);
}

/** Elimina un horario disponible. Si ya está reservado, no lo borra (hay que liberar/eliminar la reserva primero). */
export function deleteAvailableSlot(id: number): boolean {
  const info = db.prepare(`DELETE FROM slots WHERE id = ? AND status = 'available'`).run(id);
  return info.changes > 0;
}

export function getSlotById(id: number): Slot | undefined {
  return db.prepare(`SELECT ${SELECT_COLUMNS} FROM slots WHERE id = ?`).get(id) as Slot | undefined;
}
