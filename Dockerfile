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
    KP_DISABLE_WEB_RESEARCH=1
# NOTE: KP_AGENT_API_KEY is injected at deploy time via a k8s secret, never baked in.

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Application source (node_modules / reports / tmp excluded via .dockerignore).
COPY . .

EXPOSE 8787
CMD ["node", "src/server.mjs"]
