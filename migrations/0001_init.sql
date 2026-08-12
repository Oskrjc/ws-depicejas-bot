-- Reservas hechas desde el formulario web (antes vivía en
-- data/reservations.db vía better-sqlite3; ver src/reservationsDb.ts).
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  service TEXT NOT NULL,
  preferred_date TEXT NOT NULL,
  preferred_time TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  contacted INTEGER NOT NULL DEFAULT 0,
  price INTEGER,
  full_price INTEGER,
  payment_option TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  mp_preference_id TEXT,
  mp_payment_id TEXT
);

-- Horarios disponibles/reservados (agenda) — ver src/slotsDb.ts.
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  reservation_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, time)
);
