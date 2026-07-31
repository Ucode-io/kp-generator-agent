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
python3 -m pip install --requirement requirements-pdf-qa.txt
# Every generated PDF is raster-checked with pdftoppm.
# macOS: brew install poppler; Debian/Ubuntu: apt-get install poppler-utils
cp .env.example .env
```

`OPENAI_API_KEY` enables image/PDF style-reference analysis and AI-assisted
website palette classification. For compatibility with the existing
deployment, an Anthropic `sk-ant-*` key may remain in this historical variable;
the palette classifier detects it automatically. `ANTHROPIC_API_KEY` is also
supported and takes precedence for Anthropic.

Dynamic website palettes are disabled by default:

```env
KP_DYNAMIC_COLOR_PALETTES_ENABLED=0
```

In this mode every proposal uses the fixed light Udevs palette and the
screenshot-derived decorative background system, regardless of the domain in
the prompt. Set the value to `1` or `on` to restore website palette detection.
The HTTP request may override the environment for one generation with
`"dynamicColorPalettesEnabled": true` or `false`.

When dynamic palettes are enabled, website colors are extracted
deterministically first; when the live page is readable, the model may only
choose from those observed colors. If anti-bot protection prevents a live
snapshot, the model can return a provisional palette from the public
domain/brand identity. This second path is exposed as `ai_domain_fallback`;
without an accepted AI result, the Udevs fallback remains.

Set `KP_REFERENCE_PALETTE_AI_ENABLED=0` to disable AI palette classification.
`KP_REFERENCE_PALETTE_AI_PROVIDER=auto` selects Anthropic for `sk-ant-*` keys
and OpenAI otherwise. The model, confidence threshold, and timeout can be
configured with `KP_REFERENCE_PALETTE_AI_MODEL`,
`KP_REFERENCE_PALETTE_AI_MIN_CONFIDENCE`, and
`KP_REFERENCE_PALETTE_AI_TIMEOUT_MS`. Domain-fallback acceptance and timeout
can be configured separately with
`KP_REFERENCE_PALETTE_AI_DOMAIN_MIN_CONFIDENCE` and
`KP_REFERENCE_PALETTE_AI_DOMAIN_TIMEOUT_MS`.

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

Open `http://127.0.0.1:8787/` for the single-page API test frontend. It sends
the prompt to `/v1/proposals`, exposes an Off/On control for dynamic website
palettes, shows the active palette, and renders the returned proposal HTML in
an iframe.

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

## Website palette behavior

- Every safe public URL in the prompt is treated as palette evidence.
- The agent reads live CSS variables, `theme-color`, visible backgrounds,
  buttons, brand/logo SVG colors, and promo/status accents.
- The three strongest role-aware colors are passed to the renderer as
  `primary`, `secondary`, and `accent`; page decorations and gradients use the
  same tokens.
- Backgrounds and decorative elements retain the selected brand colors. When
  that pair is not readable as foreground/background, the text color is
  dynamically lightened or darkened toward an accessible variant while
  preserving the original brand hue whenever possible; neutral black/white is
  used only when no hue-preserving variant clears the contrast gate.
- Odd pages use `primary` as the background and `secondary` for content. Even
  pages use a white background and `primary` for content; primary-colored text
  is darkened dynamically when the original token is not readable on white.
- There is no domain-to-color lookup table. If the website cannot be loaded,
  the configured model may supply a provisional `ai_domain_fallback` palette.
  If that result is unavailable or below the confidence threshold, the Udevs
  palette is used. A prompt without a website always uses Udevs.
- The API response exposes the applied values under `theme.palette`.

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
