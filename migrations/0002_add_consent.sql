-- Registra cuándo el cliente aceptó la Política de Privacidad al reservar
-- (prueba de consentimiento, ver web/politica-privacidad.html).
ALTER TABLE reservations ADD COLUMN consent_accepted_at TEXT;
