# Standalone KP Generator Agent

This is a separate copy of the KP generator. It does not import Telegram,
Ufinance, amoCRM, or the rest of the Udevs assistant at runtime. Another
project can call it through HTTP or run it as a CLI process.

## What it accepts

- a natural-language project brief (`prompt`)
- optional PNG/JPG/PDF visual references
- optional output path and locale

## What it returns

- a generated PDF
- request ID, page count, renderer version, QA status, and artifact paths
- referenced PDFs are generated only after the reference is captured,
  analyzed, and converted into a validated visual-style profile

## Install

```bash
cd kp-generator-agent
npm install
npx playwright install chromium
python3 -m pip install pillow pypdf
# PDF reference files additionally need pdftoppm (macOS: brew install poppler)
cp .env.example .env
```

`OPENAI_API_KEY` is needed only for image/PDF style-reference analysis.
Plain prompt-to-PDF generation works without it.

## CLI

```bash
npm run generate -- \
  --prompt "Internet magazin uchun KP, 3 oy" \
  --output ./out/internet-magazin-kp.pdf
```

With a UI reference:

```bash
npm run generate -- \
  --prompt "Internet magazin uchun KP, shu UI stilida" \
  --reference ./reference.jpg \
  --output ./out/internet-magazin-kp.pdf
```

Repeat `--reference` for multiple files. Use `--json` for a machine-readable
result.

## HTTP API

```bash
npm start
```

Health:

```bash
curl http://127.0.0.1:8787/health
```

Generate from paths visible to the agent process:

```bash
curl -X POST http://127.0.0.1:8787/v1/proposals \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Marketplace uchun KP, 4 oy",
    "referencePaths": ["/absolute/path/reference.jpg"],
    "outputPath": "/absolute/path/marketplace-kp.pdf"
  }'
```

Generate with an uploaded base64 reference:

```json
{
  "prompt": "Marketplace uchun KP, shu dizayn uslubida",
  "references": [
    {
      "fileName": "reference.jpg",
      "mimeType": "image/jpeg",
      "dataBase64": "..."
    }
  ]
}
```

If `KP_AGENT_API_KEY` is set, send `Authorization: Bearer <key>`.

## Response

```json
{
  "ok": true,
  "requestId": "KP-...",
  "documentPath": "/.../proposal.pdf",
  "qaStatus": "PASS",
  "pageCount": 9,
  "referenceMode": "explicit_full"
}
```

Requests are intentionally processed one at a time because Chromium PDF QA is
CPU/memory intensive and the vendored renderer uses a process-level workspace.

## Updating the vendored engine

The runtime is already included under `scripts/` and `schemas/kp/`; the source
Udevs project is not required after delivery. To refresh it later from a newer
source checkout:

```bash
npm run sync:engine -- "/absolute/path/to/Udevs AI Assistant"
```

The command follows local imports from the KP entry points, copies only that
dependency graph plus KP schemas, removes local historical project-card paths,
and writes `engine-manifest.json` with SHA-256 hashes.
