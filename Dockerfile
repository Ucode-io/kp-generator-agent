# KP Generator Agent — HTML-only mode (PDF render disabled, see scripts/kpi_pdf_client.mjs).
# Base image ships Node 20+ and a Chromium build matching Playwright 1.61.
# If this exact patch tag is unavailable, fall back to v1.61.0-jammy.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# python3 is used by the optional KPI-summary extractor; the engine falls back
# gracefully if it is absent, but installing it avoids the degraded path.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CODEX_PYTHON=python3 \
    KP_AGENT_HOST=0.0.0.0 \
    KP_AGENT_PORT=8787 \
    KP_DISABLE_WEB_RESEARCH=1 \
    DOTENV_CONFIG_PATH=/app/.env
# NOTE: KP_AGENT_API_KEY is injected at deploy time via the cluster Vault Agent,
# which writes /app/.env (annotation secret-volume-path-.env: /app). The app code
# therefore MUST NOT live in /app or the injected volume would shadow it — every
# other ucode node service keeps code in /usr/src/app for this exact reason.
# DOTENV_CONFIG_PATH points `import "dotenv/config"` at the injected /app/.env.

WORKDIR /usr/src/app

# Install production dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Application source (node_modules / reports / tmp excluded via .dockerignore).
COPY . .

EXPOSE 8787
CMD ["node", "src/server.mjs"]
