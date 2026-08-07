# telemetria-tts

Servicio de telemetria y panel de administracion de **TikTok TTS**.

Un solo stack de Docker: API + PostgreSQL + panel web con login. Se despliega
en Portainer apuntando a este repositorio y arranca sin tocar nada mas.

```
┌──────────────┐   POST /api/ingest   ┌─────────────┐      ┌────────────┐
│  TikTok TTS  │ ───────────────────► │  API (4000) │ ───► │ PostgreSQL │
│  (Electron)  │ ◄─── directivas ──── │  + panel    │      └────────────┘
└──────────────┘                      └──────┬──────┘
                                             │  GET /api/public/creators
                                             ▼
                                       tu pagina web
```

## Que registra

| Conector | Que mide | Estado |
|---|---|---|
| `app` | arranque, latido cada 5 min, cierre, duracion de sesion | completo |
| `creators` | @ y link del canal de cada streamer, seguidores, plataforma | completo |
| `platforms` | conexiones y desconexiones de TikTok / Twitch / YouTube | completo |
| `obs` | conexion y clips guardados | completo |
| `mobile` | emparejado y comandos del panel movil | completo |
| `overlays` | overlays abiertos en OBS | completo |
| `updates` | comprobaciones e instalaciones de version | completo |
| `errors` | errores de la app, agrupados por firma | completo |
| `settings` | foto de la configuracion al arrancar | completo |
| `tts` | mensajes leidos, idioma, rate limit, saltados y desbordes de cola | completo |
| `music` | peticiones de cancion, skips y reproducciones de playlist | completo |
| `soundpad` | sonidos disparados por atajo o desde el movil | completo |
| `moderation` | mensajes filtrados, su motivo y palabras bloqueadas | completo |

Los eventos de alta frecuencia (mensajes TTS, sonidos, filtros) se agregan en
el cliente y viajan como un contador por latido, no uno por mensaje.

`tts.skipped` y `tts.queue_overflow` nacen en la ventana de la app
(`public/index.html`) y llegan al bus via un canal IPC en `preload.js`/
`main.js` (`telemetry:track`, con lista blanca de esos dos nombres). El resto
de conectores emite directo desde el proceso principal o `server.js`.

## Deploy en Portainer

1. **Stacks → Add stack → Repository**

   | Campo | Valor |
   |---|---|
   | Repository URL | `https://github.com/TikLiveTTS/telemetria-tts` |
   | Repository reference | `refs/heads/main` |
   | Compose path | `docker-compose.yml` |

2. En **Environment variables**, anadir como minimo:

   | Variable | Ejemplo |
   |---|---|
   | `POSTGRES_PASSWORD` | una password larga |
   | `ADMIN_USER` | `admin` |
   | `ADMIN_PASSWORD` | la password del panel |
   | `SESSION_SECRET` | salida de `openssl rand -hex 32` |
   | `PORT` | `4000` |
   | `TRUST_PROXY` | `true` (va detras de Caddy) |
   | `PUBLIC_ORIGIN` | `https://www.tiklivetts.es,https://tiklivetts.es,...` (lista separada por comas) |

   El stack **no arranca** si falta alguna de las tres primeras. Es a proposito:
   mejor un fallo visible que un servicio abierto con credenciales por defecto.

3. **Deploy the stack.**

Para actualizar: en el stack, **Pull and redeploy**. Las migraciones de base de
datos se aplican solas al arrancar y son idempotentes.

## TLS con Caddy

El stack incluye un servicio `caddy` (puertos 80/443) que hace de unico punto
de entrada publico y gestiona el certificado TLS solo, via Let's Encrypt.
Necesario porque la web publica es `https://` y un `<script src="http://...">`
en una pagina https se bloquea por contenido mixto en el navegador.

Para que funcione:

1. Crea un registro DNS tipo **A** apuntando `telemetria.tiklivetts.es` a la
   IP publica de tu servidor Docker (esto lo haces tu, en tu proveedor DNS).
2. Abre los puertos **80** y **443** en el firewall del servidor (80 hace
   falta para el reto ACME de Let's Encrypt, no solo redirige).
3. `docker compose up --build -d`. Caddy pide el certificado solo al arrancar
   si el DNS ya resuelve; si no, sirve error hasta que resuelva.
4. En produccion, pon `TRUST_PROXY=true` en el `.env` — Caddy es ahora quien
   habla con `api`, y `clientIp()` necesita leer `X-Forwarded-For` de un
   proxy de confianza, no de cualquiera.

El puerto 4000 del contenedor `api` sigue publicado al host (util para
pruebas locales sin DNS/TLS, `http://localhost:4000`); en produccion puedes
cerrarlo en el firewall del servidor si quieres que Caddy sea el unico
camino de entrada.

## URLs

| | |
|---|---|
| Panel | `https://telemetria.tiklivetts.es` |
| Ingesta (la usa la app) | `https://telemetria.tiklivetts.es/api/ingest` |
| Lista publica de creadores | `https://telemetria.tiklivetts.es/api/public/creators` |
| Widget para tu web | `https://telemetria.tiklivetts.es/embed/creators.js` |
| Health check | `https://telemetria.tiklivetts.es/health` |

En local sin Caddy/DNS, todo lo anterior tambien responde en
`http://localhost:4000/...`.

## Conectar la app

En el repositorio de TikTok TTS, define la URL del servidor por entorno al
compilar:

```
TELEMETRY_URL=https://telemetria.tiklivetts.es/api/ingest
```

o, para pruebas locales, creando `telemetry.json` en la carpeta de datos de la
app (`%APPDATA%\tiktok-live-tts\`):

```json
{ "url": "http://localhost:4000/api/ingest" }
```

Archivo aparte de `config.json` a proposito: ese lo gestiona el servidor de la
app, que descarta las claves que no conoce y borraria la URL en el primer
guardado.

Sin ninguna de las dos, la telemetria queda desactivada y la app no hace una
sola peticion.

## Creadores en tu web

El panel recolecta el @ de cada streamer, pero **nada sale publicado hasta que
lo apruebas a mano**: cada ficha tiene un interruptor "Publico" que arranca
apagado. Solo lo que enciendes aparece en `/api/public/creators`.

Para incrustar la rejilla de creadores en tu pagina:

```html
<div id="ttt-creators"></div>
<script src="https://telemetria.tiklivetts.es/embed/creators.js"></script>
```

La respuesta publica nunca incluye `machine_id`, IP ni tus notas privadas.

## Desarrollo local

```bash
cp .env.example .env        # rellenar los valores
docker compose up --build

# datos falsos para trabajar el panel sin usuarios reales
docker compose exec api node tools/seed.js 200
docker compose exec api node tools/seed.js --clean
```

## Privacidad

Por defecto se guarda la IP completa junto con pais, ciudad y coordenadas
aproximadas. Eso es un dato personal en la UE. Si necesitas reducir la
exposicion, `ANONYMIZE_IP=true` trunca la IP a /24 (IPv4) o /48 (IPv6) antes de
escribirla, sin perder el mapa ni las estadisticas por pais.

`RETENTION_DAYS` (365 por defecto) controla cuanto viven los eventos crudos.
Los agregados diarios sobreviven a la purga.

## Licencia

MIT
