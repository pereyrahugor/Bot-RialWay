# =============================================================================
#  STAGE 1 — builder
#  Compila el TypeScript y descarga todas las dependencias (incluyendo las de
#  build nativas que necesitan python/make/g++). Esta imagen NO se despliega;
#  solo sirve para producir los artefactos.
#  Tamaño estimado de la imagen final: ~400 MB
# =============================================================================
FROM node:22-slim AS builder

WORKDIR /app

# Habilita pnpm vía corepack (viene incluido en Node 22)
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/usr/local/bin

# Herramientas de sistema necesarias para compilar módulos nativos de Node
# (sharp, canvas, etc. usan python/make/g++ en su postinstall)
# git y ca-certificates son requeridos por algunos paquetes al instalar
# poppler-utils convierte PDFs a imágenes en el bot
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ca-certificates poppler-utils \
    && update-ca-certificates

# Copiamos solo los manifests primero para aprovechar la cache de capas:
# si el código cambia pero package.json no, Docker reutiliza la capa de deps
COPY package*.json ./
COPY *-lock.yaml ./
COPY rollup.config.js ./
COPY tsconfig.json ./

RUN pnpm install

# Copiamos el resto del código fuente una vez que las deps ya están cacheadas
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY docs/ ./docs/
COPY README.md ./
COPY nodemon.json ./
COPY railway.json ./

# Compila TypeScript → dist/. Si falla, imprime los logs de debug antes de salir
RUN pnpm run build || ( \
    echo '--- npm-debug.log ---' && cat /app/npm-debug.log || true && \
    echo '--- pnpm-debug.log ---' && cat /app/pnpm-debug.log || true && \
    exit 1 \
  )

# Limpiamos las herramientas de build para no contaminar node_modules del deploy
RUN apt-get remove -y python3 make g++ git \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*


# =============================================================================
#  STAGE 2 — deploy
#  Imagen final liviana: solo los artefactos compilados + dependencias runtime.
#  Se parte de una imagen limpia para no arrastrar basura del builder.
# =============================================================================
FROM node:22-slim AS deploy

# Runtime necesario:
#   poppler-utils → convierte PDFs a imágenes (usado en flujos de documentos)
#   ffmpeg        → procesa audio/video para transcripción con Whisper/Deepgram
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Carpeta donde se guardan credenciales de Google (montada como volumen en local)
RUN mkdir -p /app/credentials

# Assets estáticos (imágenes, íconos, etc.)
COPY --from=builder /app/src/assets       ./src/assets
# JS compilado listo para ejecutar (output de esbuild)
COPY --from=builder /app/dist        ./dist
# Scripts de mantenimiento y migración (se ejecutan manualmente o en CI)
COPY --from=builder /app/scripts     ./scripts
# Documentación incluida en runtime (referenciada por algunas rutas del bot)
COPY --from=builder /app/docs        ./docs
COPY --from=builder /app/*.json      ./
COPY --from=builder /app/*-lock.yaml ./
COPY --from=builder /app/README.md   ./
COPY --from=builder /app/nodemon.json ./
COPY --from=builder /app/railway.json ./
# Frontend del backoffice (HTML, JS del cliente y CSS)
COPY --from=builder /app/src/backoffice/html    ./src/backoffice/html
COPY --from=builder /app/src/backoffice/js      ./src/backoffice/js
COPY --from=builder /app/src/backoffice/style   ./src/backoffice/style

RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/usr/local/bin

# Carpeta temporal usada por el bot para archivos intermedios (audio, imágenes, etc.)
RUN mkdir /app/tmp

# Copiamos node_modules completos desde el builder para preservar binarios nativos.
# Reinstalar en esta imagen podría romper módulos que dependen del entorno de build.
COPY --from=builder /app/node_modules ./node_modules

# Patch de Baileys: falsifica la versión de WhatsApp Web reportada al servidor.
# Sin esto, WhatsApp puede rechazar la conexión por versión desactualizada.
RUN sed -i 's/version: \[[0-9, ]*\]/version: [2, 3000, 1023223821]/' \
    node_modules/@builderbot/provider-baileys/dist/index.cjs

# Ejecutamos el bot con un usuario sin privilegios (buena práctica de seguridad)
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nodejs

EXPOSE 8080

CMD ["npm", "start"]
