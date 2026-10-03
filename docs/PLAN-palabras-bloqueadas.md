# Plan: agregado de palabras bloqueadas (telemetria-tts) y dashboard

## Objetivo

Saber qué palabras bloquean los streamers de TikLiveTTS, contando **cuántos usuarios distintos** bloquean la misma palabra, para (a) ver un ranking en un dashboard y (b) exportar una lista (CSV/TSV) de palabras probablemente bloqueables que alimente el diccionario de Rust Chat Guard.

Pregunta que responde: de N usuarios, ¿en cuántos aparece cada palabra? Métrica clave = `usuarios_distintos`, no el total de veces.

## Hallazgos del código actual (verificados)

* Cliente (`tiktok-tts`): las palabras viven por cuenta en `blocked-words.md` (`features/moderacion/filters/blocked-words-file.js`, líneas `- palabra`, minúsculas). Hoy la telemetría solo cuenta eventos agregados (`moderacion.filtro.palabra_bloqueada` → `moderation/word_blocked` en `features/telemetria/connectors/counters.js`), **no envía las palabras**.
* Servidor (`telemetria-tts`): API Node + PostgreSQL + panel web estático (`api/web`). Conectores en `api/src/connectors/index.js` (`passthrough('moderation')` solo inserta en `events`), rutas en `api/src/routes/` (`dashboard.js`, `export.js`), consultas en `api/src/queries/`, migraciones en `api/db/migrations`.
* Cada instalación ya tiene identidad seudonimizada (hash de equipo); sirve para contar usuarios distintos sin guardar nada más identificable.
* La política de privacidad (`docs/legal/politica-de-privacidad.md` en `tiktok-tts`) **no menciona** este dato: es un tipo de dato nuevo.

## Privacidad (obligatorio, no negociable)

Una palabra bloqueada es texto libre escrito por el streamer: puede ser un insulto, pero también un nombre, un @usuario, un teléfono o un enlace.

1. **Consentimiento y transparencia**: actualizar la política (ES y EN) y los términos antes de activar el envío; ajuste con interruptor en la app, por defecto **desactivado** hasta publicar el cambio legal. La decisión final (opt-in o aviso + opt-out) es del dueño.
2. **Saneado en el cliente y otra vez en el servidor** (el servidor nunca confía en el cliente): descartar entradas con `@`, URLs, emails, secuencias de 6+ dígitos, más de 3 palabras o más de 40 caracteres; normalizar (minúsculas, trim, plegado de tildes **excepto ñ**, colapsar espacios).
3. **k-anonimato**: el dashboard y la exportación solo muestran palabras con `usuarios_distintos >= K` (K configurable, por defecto 3). Las palabras con menos usuarios existen en la BD pero no se ven ni se exportan.
4. **Nunca mostrar listas por usuario**. Ni en el dashboard ni en la exportación se puede ver qué usuario bloqueó qué. En la BD el vínculo palabra→instalación solo sirve para deduplicar; consulta restringida al rol de la API.
5. **Retención**: respetar los 365 días de la política; al borrar la telemetría de una instalación se borran sus filas de palabras (`ON DELETE CASCADE`).
6. Sin contenido de chat de espectadores: solo las palabras que el streamer escribió en su propia lista.

## Diseño

### Cliente (`tiktok-tts`, fase aparte, NO en esta tarea)

Conector nuevo `features/telemetria/connectors/blocked-words.js`: al conectar y cuando cambia la lista, calcula el diff contra lo último enviado y emite un evento `moderation.blocked_words_snapshot` con `{ words: [...] , lang }` saneado y limitado (máx. 500 palabras). Sincronización por cuenta y respeta el interruptor. Tests y claves i18n para el interruptor. Se implementa después de que el servidor y la política estén listos.

### Servidor (`telemetria-tts`) — ESTA TAREA

1. **Migración** `blocked_words` y `installation_blocked_words`:
   * `blocked_words(word_norm text primary key, first_seen, last_seen)`
   * `installation_blocked_words(installation_id, word_norm, first_seen, last_seen, primary key(installation_id, word_norm))` con FK y `ON DELETE CASCADE`.
   Usar el identificador de instalación que ya usa `events`/sesiones (verificar nombre real en `api/db/migrations` y `ingest.js`).
2. **Conector** `api/src/connectors/blocked-words.js` (`name: 'moderation'` ya existe como passthrough: extender o registrar el tipo de evento `blocked_words_snapshot` sin romper el passthrough). Validación estricta del payload (límites, tipos), saneado servidor (regla 2), upsert idempotente, respuesta no bloqueante. Reenviar el mismo snapshot no duplica ni cuenta de más.
3. **Consultas** `api/src/queries/blocked-words.js`: ranking `word_norm, usuarios_distintos, porcentaje_de_usuarios_activos, first_seen, last_seen`, filtro `usuarios_distintos >= K`, filtros por ventana de tiempo, por idioma si se envía, búsqueda por prefijo; serie temporal (nuevas palabras por semana); totales (instalaciones con lista, palabras únicas, palabras sobre K).
4. **Rutas** (solo con sesión de admin, como el resto de `dashboard.js`): `GET /api/dashboard/blocked-words` (ranking paginado), `GET /api/dashboard/blocked-words/summary`, `GET /api/export/blocked-words.tsv` y `.csv`.
5. **Exportación**: TSV UTF-8 (con BOM para Excel en CSV) con columnas `word<TAB>users<TAB>pct_users<TAB>first_seen<TAB>last_seen`, ordenada por `users` desc, solo con `users >= K`, respetando filtros. Escapar celdas que empiecen por `=`, `+`, `-`, `@` (inyección de fórmulas en CSV).
6. **Dashboard** en `api/web` (sin framework nuevo; seguir el estilo existente): tarjetas de resumen, tabla ordenable con barra de % de usuarios, buscador, selector de K y de ventana de tiempo, botón "Descargar TSV/CSV", gráfica de palabras nuevas por semana. Accesible y usable en móvil. Mostrar siempre una nota: "solo se muestran palabras bloqueadas por al menos K usuarios".
7. **Pruebas** (Node, junto a los `*.test.js` existentes): saneado (@, URL, email, dígitos, longitud, ñ), k-anonimato (con K-1 usuarios no aparece ni en API ni en export), idempotencia del snapshot, conteo de usuarios distintos con N instalaciones simuladas (p. ej. 5 instalaciones con listas solapadas), inyección de fórmulas CSV, autorización (sin sesión → 401), borrado en cascada.
8. **Documentación**: sección en `README.md` (qué se guarda, por qué, K, retención) y `docs/PLAN-palabras-bloqueadas.md` (este plan, estado).

## Uso posterior con Rust Chat Guard

La exportación TSV es la entrada del pipeline de diccionario (`NORMALIZE→DEDUP→CLASSIFY→VALIDATE→FP TEST→COMPILE`): las palabras con alto `usuarios_distintos` son **candidatas**, pasan por clasificación y por el test de falsos positivos antes de entrar. Los datos son propios (los streamers los escribieron), sin problemas de licencias de terceros.

## Fases y criterios de salida

| Fase | Dónde | Entregable | Criterio |
|---|---|---|---|
| 1 | telemetria-tts | Migración + conector + saneado + pruebas | `npm test` verde; el snapshot de 5 instalaciones simuladas da conteos correctos |
| 2 | telemetria-tts | Consultas + rutas + exportación | K-anonimato y auth probados |
| 3 | telemetria-tts | Dashboard + descarga | Revisión visual en escritorio y móvil |
| 4 | tiktok-tts + legal | Conector cliente + interruptor + i18n (10 idiomas) + política ES/EN | Dueño aprueba el texto legal antes de activar |
| 5 | despliegue | Migración en producción (Portainer), activar envío con flag | Rollback = apagar el flag |

## Fuera de alcance de la tarea de Codex

Cliente de TikLiveTTS, textos legales y despliegue (fases 4–5). Esta tarea cubre fases 1–3 en `telemetria-tts`.

## Actualización periódica y cambios (añadido por el dueño)

Los streamers editan sus listas: agregan, quitan y cambian palabras. El ranking debe reflejar el estado ACTUAL, no un histórico acumulado.

1. **El snapshot es el estado completo de la instalación**, no un diff. El servidor, en una transacción, reemplaza el conjunto de palabras de esa instalación: inserta las nuevas, actualiza `last_seen` de las que siguen y **borra las que ya no están**. Una palabra quitada por un usuario deja de contar para ese usuario.
2. **Cuándo envía el cliente** (fase 4): (a) al conectar/arrancar si pasó más de 7 días desde el último envío, (b) cuando la lista cambia, con debounce de 10 min, y (c) un reenvío semanal aunque no haya cambios (latido de sincronización) para que el servidor sepa que sigue vigente. Si el hash de la lista no cambió desde el último envío y no pasaron 7 días, no se envía nada.
3. **Instalaciones inactivas no cuentan**: en el ranking solo cuentan instalaciones con snapshot en los últimos `ACTIVE_DAYS` (default 30, configurable). Así un streamer que dejó la app no infla los números. El denominador de `porcentaje_de_usuarios_activos` usa las mismas instalaciones activas con lista.
4. **Idempotencia y orden**: cada snapshot lleva `snapshot_at` y un `list_hash`; si llega uno más viejo que el guardado, se ignora. Reenviar el mismo snapshot no cambia nada salvo `last_seen`.
5. **Historial agregado (opcional, útil)**: tabla diaria/semanal con `(fecha, word_norm, usuarios_distintos)` generada por un job (ver `api/src/jobs.js`) para ver tendencias: palabras que suben o bajan. No guarda quién.
6. **Pruebas añadidas**: usuario quita una palabra → baja el conteo; usuario deja de reportar > ACTIVE_DAYS → sale del conteo; snapshot viejo no pisa uno nuevo; reenvío idéntico no altera conteos; job de tendencias.

## Corrección del dueño: SOLO SUMAR, NUNCA RESTAR (reemplaza los puntos 1 y 3 de la sección anterior)

* El snapshot **solo añade**: inserta palabras nuevas y refresca `last_seen` de las existentes. **Nunca borra** palabras de una instalación porque el streamer las quitó de su lista. Una palabra que un usuario bloqueó alguna vez sigue contando para él (es una señal válida de que esa palabra se considera bloqueable).
* No hay filtro de instalaciones inactivas por defecto (`ACTIVE_DAYS` = 0 = desactivado; configurable si se quiere después).
* Se mantiene `snapshot_at`/`list_hash` (ignorar envíos más viejos e idénticos) y el historial semanal agregado.
* Excepción de privacidad que se conserva: si se borra la telemetría de una instalación (derecho de borrado), sus filas se borran en cascada.
* Pruebas: quitar una palabra de la lista NO baja el conteo; reenviar un snapshot sin una palabra previa no la elimina; envío idéntico no cambia conteos; snapshot viejo no pisa uno nuevo.

## Estado

Fases 1–3: actualizadas con snapshots ordenados e historial semanal. `cd api &&
npm test` pasó (18 pruebas). Revisión
responsiva por código completada con las reglas móviles existentes (`.kpis`,
`.table-wrap` y navegación horizontal). No se inició un stack ni se desplegó,
por estar fuera de alcance.

## Desviaciones

* El identificador real de instalación es `machine_id`, no `installation_id`; la migración y el conector usarán ese nombre para respetar el esquema existente.
* Los eventos `moderation.blocked_words_snapshot` no se guardarán en `events`: esa tabla conservaría el payload de texto libre. Solo se persiste cada palabra ya saneada en las tablas específicas.
* La corrección del dueño reemplaza el comportamiento de reemplazo indicado en la actualización anterior: los snapshots son acumulativos y nunca eliminan asociaciones existentes.
