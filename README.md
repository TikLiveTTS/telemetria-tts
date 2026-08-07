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
| `tts` | mensajes leidos, idioma y rate limit | parcial |
| `music` | peticiones de cancion y skips | parcial |
| `soundpad` | sonidos disparados por atajo o desde el movil | parcial |
| `moderation` | mensajes filtrados y su motivo | parcial |

Los eventos de alta frecuencia (mensajes TTS, sonidos, filtros) se agregan en
el cliente y viajan como un contador por latido, no uno por mensaje.

### Que le falta a los conectores "parcial"

Estos eventos estan implementados a los dos lados, pero **nadie los emite
todavia**: nacen en la ventana de la app (el renderer) y ese proceso aun no
tiene un canal hacia el bus de telemetria.

| Evento | Donde nace |
|---|---|
| `tts.skipped`, `tts.queue_overflow` | cola TTS del renderer (`public/index.html`) |
| `soundpad.triggered` desde la UI | boton del soundpad en la ventana |
| `music.playlist_play` | reproductor del renderer |
| `moderation.word_blocked` | filtrado del lado cliente |

Para cerrarlos hace falta un puente renderer → servidor: un endpoint local
`POST /api/telemetry/event` o un canal IPC en `preload.js`. Hasta entonces esos
contadores existen y se quedan a cero, sin romper nada.

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
   | `PUBLIC_ORIGIN` | `https://www.tiklivetts.es` |

   El stack **no arranca** si falta alguna de las tres primeras. Es a proposito:
   mejor un fallo visible que un servicio abierto con credenciales por defecto.

3. **Deploy the stack.**

Para actualizar: en el stack, **Pull and redeploy**. Las migraciones de base de
datos se aplican solas al arrancar y son idempotentes.

## URLs

| | |
|---|---|
| Panel | `http://tu-servidor:4000` |
| Ingesta (la usa la app) | `http://tu-servidor:4000/api/ingest` |
| Lista publica de creadores | `http://tu-servidor:4000/api/public/creators` |
| Widget para tu web | `http://tu-servidor:4000/embed/creators.js` |
| Health check | `http://tu-servidor:4000/health` |

## Conectar la app

En el repositorio de TikTok TTS, define la URL del servidor por entorno al
compilar:

```
TELEMETRY_URL=http://tu-servidor:4000/api/ingest
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
<script src="http://tu-servidor:4000/embed/creators.js"></script>
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
