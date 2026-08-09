import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

// Conexión única a SQLite, compartida por reservationsDb.ts y slotsDb.ts —
// así ambos módulos leen/escriben en el mismo archivo sin abrir dos handles
// separados.
fs.mkdirSync(path.dirname(config.reservationsDbPath), { recursive: true });

export const db = new Database(config.reservationsDbPath);
