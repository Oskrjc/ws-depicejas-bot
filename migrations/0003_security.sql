-- Registro genérico de eventos de seguridad, usado para:
--  - Rate limiting de POST /api/reservations (type = 'reservation_attempt')
--  - Bloqueo por intentos fallidos en /admin (type = 'admin_login_failure' /
--    'admin_login_success')
-- Se consulta por ventana de tiempo (ver src/security.ts) — no hace falta
-- borrar filas viejas manualmente, aunque se podría limpiar periódicamente
-- si la tabla crece mucho.
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_events_lookup ON security_events (type, ip, created_at);
