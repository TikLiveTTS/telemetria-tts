# Handoff — construccion del servicio de telemetria

Sesion del **7 de agosto de 2026**. Documento de contexto para quien retome el
trabajo (persona o agente). Cuenta que habia antes, que se construyo, que
decisiones se tomaron y por que, que quedo verificado y que falta.

---

## 1. De donde se partia

La telemetria de TikTok TTS estaba **muerta y a medias**:

| Problema | Donde |
|---|---|
| URL placeholder `https://TU_SERVIDOR_AQUI/api/ping` — todo `fetch` fallaba y moria en un `.catch(() => {})` vacio | `main.js:7-31` |
| Solo 3 eventos (`startup`, `heartbeat`, `shutdown`) para una app con ~60 endpoints y 10+ subsistemas | — |
| `platforms_used` existia en el esquema y en el dashboard, pero el cliente **nunca lo enviaba** | — |
| El evento de cierre se emitia en `will-quit`: el proceso moria antes de que saliera la peticion. **Nunca llegaba** | `main.js:349` |
| Dashboard autenticado con un Bearer token en `localStorage`, sin usuario/contrasena, y Chart.js desde un CDN | `docker/api/public/index.html` |
| Todo mezclado dentro del repo de la app | `docker/` |

El objetivo fue extraerlo a un servicio autonomo y reescribir el cliente como un
sistema de conectores, uno por subsistema real de la app.

---

## 2. Que hay ahora

### Este repo — `telemetria-tts`

Stack Docker autocontenido. API Express + PostgreSQL + panel de administracion.

```
telemetria-tts/
├── docker-compose.yml       postgres + api, healthchecks, restart unless-stopped
├── .env.example             variables obligatorias con `:?` para fallo explicito
├── README.md                deploy en Portainer, paso a paso
└── api/
    ├── Dockerfile           node:22-alpine, usuario sin privilegios, HEALTHCHECK
    ├── db/
    │   ├── migrate.js       runner idempotente, corre al arrancar
    │   └── migrations/      001_init · 002_rollups · 003_creators
    ├── src/
    │   ├── index.js         bootstrap: espera DB → migra → jobs → listen
    │   ├── config.js        valida el entorno, falla rapido si falta algo
    │   ├── auth.js          bcrypt en memoria + cookie de sesion firmada
    │   ├── geo.js           ip-api.com con cache LRU
    │   ├── ingest.js        POST /api/ingest, transaccional
    │   ├── jobs.js          rollup horario + purga por retencion
    │   ├── connectors/      app · creators · platforms · errors + 9 passthrough
    │   ├── queries/         dashboard.js · creators.js
    │   ├── middleware/      rateLimit · requireAuth · validate
    │   └── routes/          auth · dashboard · creators · export · public · health
    ├── web/                 panel: 8 paginas, ES modules, sin build step
    └── tools/seed.js        datos falsos para desarrollar sin usuarios reales
```

### Repo de la app — `tiktok-tts`, rama `terminal`

Modulo cliente nuevo, **sin commitear todavia**:

```
telemetry/
├── index.js           init/track/flush/shutdown + bus de eventos
├── identity.js        machine_id, session_id, datos del SO
├── buffer.js          cola con respaldo en disco (max 500 eventos)
├── transport.js       batches de 50, reintentos 1s/4s/15s
├── creator-cache.js   contador de resoluciones por canal
└── connectors/        creators · platforms · counters · obs · mobile
                       overlays · updates · errors · settings
```

Archivos modificados: `main.js`, `server.js`, `package.json`
(este ultimo solo para anadir `telemetry/**/*` al `files[]` del instalador).

---

## 3. Decisiones y por que

### Arquitectura de conectores

Un conector es un par emisor/handler con el **mismo nombre** a los dos lados.
Anadir una metrica nueva = tocar un conector, no el transporte ni el esquema.
La tabla `events` es generica (`connector`, `name`, `props JSONB`), asi que un
conector nuevo no necesita migracion.

### Agregacion en el cliente

Los eventos de alta frecuencia (mensajes TTS, sonidos, filtros) **no** viajan uno
por mensaje: se acumulan en contadores y se vuelcan en cada latido de 5 minutos.
Medido: un directo con 500 mensajes leidos genera **1 evento** con
`count: 500`, y la sesion completa 22 eventos en total.

### Regla de las 2 resoluciones

Resolver el perfil de un canal (avatar, nombre, seguidores) cuesta peticiones a
TikTok/Twitch/YouTube. Se hace **exactamente 2 veces por canal**:

1. la primera conexion de ese canal tras instalar,
2. la siguiente sesion en que se reconecta (corrige cambios de @ o avatar),
3. de ahi en adelante, cero peticiones: solo un `creators.seen`.

El contador es **por canal**, no por instalacion: si fuera global, cambiar de
canal nunca quedaria registrado. Si la resolucion falla, el contador **no** sube
— un fallo de red transitorio no puede dejar a un creador sin ficha para siempre.
Estado en `%APPDATA%\tiktok-live-tts\telemetry-identity.json`.

El panel puede forzar una resolucion extra (`POST /api/dashboard/creators/:id/re-resolve`):
pone una bandera que la app lee en la respuesta del siguiente ingest.

Los seguidores del latido **no cuestan una peticion nueva**: reutilizan el valor
que la app ya tiene en memoria porque `startFollowerRefresh()` lo refresca cada
5 minutos para el overlay de seguidores.

### Publicacion de creadores con aprobacion manual

`creators.is_public` arranca en `false`. Se recolecta todo, pero nada aparece en
la web hasta que se activa el interruptor en el panel. Protege de publicar
cuentas de prueba, bots o gente que no quiere aparecer.

`GET /api/public/creators` devuelve solo campos publicables: nunca `machine_id`,
IP, `user_id` ni las notas privadas.

### Instrumentacion en cuellos de botella

Tres eventos se enganchan en un punto unico en vez de repartirse por el codigo:

| Evento | Punto | Cubre |
|---|---|---|
| `platform:disconnected` | dentro de `broadcast()` | los 11 puntos de desconexion |
| `error:handled` | dentro de `log()` | todos los errores no fatales del servidor |
| `mobile:paired` | `validateMobileRequest` con guarda | una vez por sesion, no por peticion |

### `telemetry.json` aparte de `config.json`

La URL del servidor **no** puede vivir en `config.json`: ese archivo lo gestiona
`server.js`, cuyo `applyConfigPatch` descarta las claves que no conoce, y el
primer `saveConfig()` habria borrado la URL en silencio — la telemetria se
habria apagado sola sin avisar. Vive en `telemetry.json`, que el servidor no
toca nunca.

Orden de resolucion: `process.env.TELEMETRY_URL` → `userData/telemetry.json`.
Sin ninguna de las dos, la telemetria queda desactivada y la app no hace **ni una
sola peticion** de red.

### Privacidad — decision explicita del propietario

Se guarda la **IP completa** junto con pais, ciudad y coordenadas, **sin opt-out**.
Quedo advertido que en la UE eso es tratamiento de dato personal (GDPR/LOPD) y
fue una decision informada. El flag `ANONYMIZE_IP=true` trunca la IP a /24
(IPv4) o /48 (IPv6) sin tocar codigo, si algun dia hace falta.

Retencion: `RETENTION_DAYS` (365 por defecto) para los eventos crudos. Los
agregados diarios de `feature_daily` sobreviven a la purga.

### Zona horaria

Todo se guarda en UTC. El corte de dia de los graficos usa
`AT TIME ZONE 'America/Guayaquil'` (UTC-5, sin DST), configurable por `TZ_DISPLAY`.

### Sin build step, sin CDN

Panel en ES modules puros. Chart.js se sirve desde `node_modules` con un
`express.static` apuntando a su carpeta `dist`. Portainer clona y `docker compose
up` — sin Node en el host, sin `npm run build`, sin peticiones a terceros. La CSP
de helmet queda cerrada de verdad (`scriptSrc: 'self'`) en vez de desactivada.

---

## 4. Que quedo verificado

Todo contra un stack real en Docker, no por inspeccion del codigo.

| Bateria | Resultado |
|---|---|
| API end-to-end (auth, ingesta, creadores, publico, export, SPA) | **66/66** |
| Cliente real contra el servidor | **32/32** |
| Emisores nuevos (`platform:disconnected`, `error:handled`, `mobile:paired`) | **9/9** |
| Cola en disco + rutas de la app | **13/13** |
| Paginas de la app tras instrumentar | **12/12** |
| Grafo de modulos del frontend | OK |

Comprobaciones concretas que pasaron:

- **Regla de las 2 resoluciones**: 4 conexiones del mismo canal → `resolve()` se
  llama 2 veces. Canal nuevo arranca su propio contador. Resolucion fallida no
  gasta contador (3 intentos → 3 llamadas). Un `seen` no duplica la fila ni borra
  el `display_name` ni baja el `resolve_count`.
- **El cierre ahora si llega**: `ended_at` y `session_duration_minutes` poblados.
- **`platforms_used`** se llena de verdad con las 3 plataformas.
- **Nada publico por defecto**: la lista publica devuelve `[]` hasta activar el
  interruptor; la respuesta no lleva `machine_id`, IP ni notas.
- **Servidor caido** → eventos a disco → llegan enteros en el arranque siguiente.
- **Persistencia** tras eliminar los contenedores; las migraciones no se reaplican.
- **App real** (`server.js` arrancado de verdad): captura `app.startup`,
  `settings.snapshot`, `overlays.opened` x2, `mobile.paired`, `tts.spoken`
  agregado y `app.shutdown` con duracion.

### Bugs encontrados y corregidos durante las pruebas

1. `operator does not exist: text * integer` en el SQL de KPIs — los intervalos se
   construian concatenando strings. Sustituido por `make_interval(days => $1::int)`
   en todo el codigo.
2. Chart.js no resolvia: su campo `exports` bloquea las subrutas, asi que
   `require.resolve('chart.js/dist/chart.umd.js')` fallaba. Resuelto montando el
   directorio por ruta de disco.
3. La URL de telemetria en `config.json` se habria borrado sola (ver seccion 3).

### Falso positivo a tener en cuenta

El login tiene rate limit de **5 intentos / 15 minutos por IP**. Encadenar varias
baterias de pruebas produce un `429 Retry-After` que **parece** un fallo del
servicio y no lo es. Reutiliza la cookie entre pruebas.

---

## 5. Que falta

### Conectores parciales — puente renderer → servidor

Cuatro contadores estan implementados a los dos lados pero **nadie los emite**.
Nacen en la ventana de la app (`public/index.html`) y ese proceso no tiene canal
hacia el bus de telemetria — verificado: cero menciones de telemetria en
`index.html` y en `preload.js`.

| Evento | Donde nace |
|---|---|
| `tts.skipped`, `tts.queue_overflow` | cola TTS del renderer (`speechQueue`) |
| `soundpad.triggered` desde la UI | boton del soundpad en la ventana |
| `music.playlist_play` | reproductor del renderer |
| `moderation.word_blocked` | filtrado del lado cliente |

Solucion: un `POST /api/telemetry/event` local (con `validateLocalMutation`,
lista blanca de eventos y rate limit) o un canal IPC en `preload.js`. Esos
contadores se quedan a cero mientras tanto, sin romper nada.

### `PUBLIC_ORIGIN` acepta un solo origen

`config.js:40` lo lee como string y `routes/public.js:16` lo mete tal cual en
`Access-Control-Allow-Origin`. La web esta en Vercel, que sirve apex + `www` +
URLs de preview: **cada uno es un origen CORS distinto**. Hace falta convertirlo
en lista y validar el `Origin` entrante devolviendo el que pidio.

### Contenido mixto — probablemente bloqueante

La web es `https://www.tiklivetts.es`. El plan aprobado era puerto plano sin TLS.
Un `<script src="http://...">` dentro de una pagina https lo **bloquea el
navegador**: el widget de creadores no cargara. Opciones: reverse proxy con TLS
(Caddy/Traefik) en un subdominio, Cloudflare por delante, o que la web haga la
llamada desde el servidor (SSR) en vez de desde el navegador.

Esto **no** afecta a la app de escritorio: Electron llama desde el proceso Node,
no desde el navegador. Aun asi, mandar telemetria sin cifrar por internet es mala
idea.

### Decision pendiente del propietario

**En que servidor corre el Docker.** Es lo unico que bloquea el despliegue: sin
esa IP o subdominio, `TELEMETRY_URL` queda vacio y la app no manda nada.

Vercel **no puede** alojar este stack: es serverless y esto necesita un
contenedor vivo y una base de datos con estado. El MCP de Vercel sirve aqui solo
para leer los dominios y dejar variables de entorno en la web.

### Cabos sueltos

- `docker/` sigue en el repo de la app, con la URL muerta. Borrar cuando el
  stack nuevo este confirmado en produccion.
- `CLAUDE.md` de la app no menciona `telemetry/`; `CHANGELOG.md` sigue diciendo
  "Backend de telemetria" en la 1.5.0.
- `main.js`, `server.js`, `package.json` y `telemetry/` siguen **sin commitear**
  en la rama `terminal`. Hay otros archivos sin commitear en esa rama (i18n,
  workflows, `public/`) que **no son de este trabajo**: no mezclarlos.
- Falta el `.env` de produccion. Generar `SESSION_SECRET` con
  `openssl rand -hex 32`. Nunca versionarlo; ya esta en `.gitignore`.

---

## 6. Entorno local de pruebas

El stack corre en local con `restart: unless-stopped`, asi que sobrevive a
reinicios de Docker:

```
Panel:   http://localhost:4000
Ingesta: http://localhost:4000/api/ingest
```

Credenciales en el `.env` local, que **no esta versionado**. La app apunta ahi
mediante `%APPDATA%\tiktok-live-tts\telemetry.json`.

```bash
docker compose up --build -d
docker compose exec api node tools/seed.js 50    # datos falsos
docker compose exec api node tools/seed.js --clean
```

---

## 7. Mapa rapido para orientarse

| Quiero... | Mirar |
|---|---|
| entender el contrato de ingesta | `api/src/middleware/validate.js` |
| anadir una metrica nueva | `api/src/connectors/` + `telemetry/connectors/` en la app |
| tocar el aspecto del panel | `api/web/css/tokens.css` (todo sale de ahi) |
| cambiar una consulta del dashboard | `api/src/queries/dashboard.js` |
| entender la logica de creadores | `api/src/connectors/creators.js` y `telemetry/creator-cache.js` |
| desplegar | `README.md`, seccion Portainer |
