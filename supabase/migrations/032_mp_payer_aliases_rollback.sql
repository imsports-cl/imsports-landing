-- Rollback de 032_mp_payer_aliases.sql. Borra los mapeos manuales guardados.
-- No toca player_sanctions (las sanciones no_pago cargadas desde el panel quedan;
-- se quitan con "Perdonar" en Titulares o con:
--   DELETE FROM player_sanctions WHERE reason = 'no_pago' AND note LIKE 'No pagó la pichanga del % (match %)';
-- ).
BEGIN;
DROP TABLE IF EXISTS public.mp_payer_aliases;
COMMIT;
