# Stage 1: Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Instalar dependencias del sistema necesarias
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Instalar pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
ENV PNPM_HOME=/usr/local/bin

# Copiar configuración de dependencias para aprovechar la cache de Docker
COPY package.json .npmrc pnpm-lock.yaml* package-lock.json* ./

# Instalar dependencias (se aprovecha la cache de capas de Docker)
RUN pnpm config set block-exotic-subdeps false && \
    pnpm install

# Copiar el código fuente
COPY src/ ./src/
COPY docs/ ./docs/
COPY tsconfig.json ./

# Compilar el proyecto (esbuild genera dist/app.js)
RUN pnpm run build

# Stage 2: Production stage
FROM node:22-slim AS deploy

# Instalar dependencias de runtime necesarias
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils ffmpeg curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar pnpm en la imagen final
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
ENV PNPM_HOME=/usr/local/bin

# Copiar el código compilado
COPY --from=builder /app/dist ./dist

# Copiar node_modules (se copian completos del builder para evitar re-instalar y romper binarios)
COPY --from=builder /app/node_modules ./node_modules

# Copiar archivos estáticos y recursos necesarios según la nueva estructura
COPY --from=builder /app/src/frontend/html ./src/frontend/html
COPY --from=builder /app/src/frontend/js ./src/frontend/js
COPY --from=builder /app/src/frontend/style ./src/frontend/style
COPY --from=builder /app/src/backend/assets ./src/backend/assets
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/package.json ./

# Asegurar que existan las carpetas de persistencia y temporales
RUN mkdir -p /app/credentials /app/tmp /app/uploads /app/bot_sessions

# Parchear la versión de Baileys automáticamente (Requerido por builderbot/provider-baileys)
RUN sed -i 's/version: \[[0-9, ]*\]/version: [2, 3000, 1023223821]/' node_modules/@builderbot/provider-baileys/dist/index.cjs

# Configurar usuario no-root para mayor seguridad
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nodejs
RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 8080

# Usar npm start que ejecuta 'node ./dist/app.js'
CMD ["npm", "start"]