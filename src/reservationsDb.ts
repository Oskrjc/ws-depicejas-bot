import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

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
}

export interface NewReservation {
  name: string;
  email: string;
  phone?: string;
  service: string;
  preferredDate: string;
  preferredTime: string;
  notes?: string;
}

fs.mkdirSync(path.dirname(config.reservationsDbPath), { recursive: true });

const db = new Database(config.reservationsDbPath);

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

// Migración: agrega la columna "contacted" si la tabla existía de antes.
const existingColumns = db.prepare(`PRAGMA table_info(reservations)`).all() as { name: string }[];
if (!existingColumns.some((col) => col.name === "contacted")) {
  db.exec(`ALTER TABLE reservations ADD COLUMN contacted INTEGER NOT NULL DEFAULT 0`);
}

const insertStmt = db.prepare(`
  INSERT INTO reservations (name, email, phone, service, preferred_date, preferred_time, notes)
  VALUES (@name, @email, @phone, @service, @preferredDate, @preferredTime, @notes)
`);

const SELECT_COLUMNS = `
  id, name, email, phone, service,
  preferred_date as preferredDate,
  preferred_time as preferredTime,
  notes, contacted, created_at as createdAt
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
  });

  return getReservationById(Number(info.lastInsertRowid))!;
}

export function getReservationById(id: number): Reservation | undefined {
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM reservations WHERE id = ?`).get(id);
  return row ? toReservation(row) : undefined;
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
