FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Instalar dependencias primero: capa cacheada mientras no cambie package.json
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Codigo de la API, migraciones, frontend y utilidades
COPY src/ ./src/
COPY db/ ./db/
COPY web/ ./web/
COPY tools/ ./tools/

# node:alpine trae el usuario "node" (uid 1000) sin privilegios
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
