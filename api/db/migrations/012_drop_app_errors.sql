-- Se deja de recoger telemetria de errores de la app: fuera la tabla y los
-- eventos crudos/agregados del conector `errors`. La ingesta ya descarta ese
-- conector por desconocido, asi que las apps viejas que lo sigan enviando no fallan.
DROP TABLE IF EXISTS app_errors;
DELETE FROM events WHERE connector = 'errors';
DELETE FROM feature_daily WHERE connector = 'errors';
