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

Dynamic website palettes remain disabled for PDF proposals:

```env
KP_DYNAMIC_COLOR_PALETTES_ENABLED=0
```

In this mode every PDF uses the fixed light Udevs palette and the
screenshot-derived decorative background system, regardless of the domain in
the prompt.

Interactive prototypes use the website palette independently and by default:

```env
KP_PROTOTYPE_DOMAIN_PALETTES_ENABLED=1
```

When a safe public URL is present in the prompt, its primary and secondary
brand colors are applied to the prototype only. Set this value to `0` only to
disable prototype domain-palette extraction. The PDF palette is unaffected.

For prototype palettes, website colors are extracted
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
the prompt to `/v1/proposals`, shows the prototype domain palette, and renders
the returned proposal HTML in an iframe.

Generated proposals also create an interactive app prototype. The PDF footer
links to the prototype URL, and the local server can serve published prototype
HTML at:

```text
GET /p/:publicId/
```

The prototype is planned from the same project type, functional scope, product
mind map, task inventory, roles, and user flows that are used in the PDF. A
validated in-phone action graph makes every generated screen reachable from
the start screen without relying on the desktop sidebar. A
separate experience classifier keeps the delivery type (CRM, ERP, SaaS,
mobile, and so on) while adapting screens to the subject area, such as real
estate, logistics, healthcare, commerce, or education.

Each prototype includes a curated thematic Unsplash photo pool. To fetch a new
project-specific pool during generation, configure an Unsplash access key:

```env
UNSPLASH_ACCESS_KEY=...
```

`UNSPLASH_ACCESS_KEY` is accepted as a compatibility alias. If search is
unavailable, generation continues with the built-in thematic pool; image
elements retain an in-app gradient fallback.

Set `KP_PROTOTYPE_PUBLIC_BASE_URL` to the production HTTPS base URL used in PDF
links. If omitted, links use `https://kp.udevs.io/p/`.

Public prototypes can be embedded by the local Professio app and
`https://professio.ucode.co` by default. Override the CSP allowlist when the
viewer is hosted on another origin:

```bash
KP_PROTOTYPE_FRAME_ANCESTORS="'self' https://professio.example.com" npm start
```

The public prototype response CSP explicitly allows the curated/API image CDN
at `https://images.unsplash.com`; keep that source when overriding proxy
security headers.

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

## Prototype website palette behavior

- Every safe public URL in the prompt is treated as palette evidence.
- The agent reads live CSS variables, `theme-color`, visible backgrounds,
  buttons, brand/logo SVG colors, and promo/status accents.
- The two strongest role-aware colors are passed to the prototype renderer as
  `primary` and `secondary`; controls, accents, tints, and gradients use these
  tokens.
- Backgrounds and decorative elements retain the selected brand colors. Text
  placed on the primary color automatically switches between a dark and light
  foreground for contrast.
- There is no domain-to-color lookup table. If the website cannot be loaded,
  the configured model may supply a provisional `ai_domain_fallback` palette.
  If that result is unavailable or below the confidence threshold, the Udevs
  palette is used. A prompt without a website always uses Udevs.
- PDF output keeps the Udevs visual system. The API response exposes the
  prototype values and source under `prototype.theme`.

## Response

```json
{
  "ok": true,
  "requestId": "KP-...",
  "documentPath": "/.../proposal.pdf",
  "downloadUrl": "/v1/proposals/KP-.../pdf",
  "prototype": {
    "url": "https://kp.udevs.io/p/7QmJv8Kx2A/",
    "path": "/.../final/prototype/index.html",
    "qaStatus": "PASS",
    "screenCount": 11,
    "rendererVersion": "app-prototype-v5",
    "theme": {
      "source": { "kind": "client_site_url", "reference": "https://texnomart.uz" },
      "referenceUrl": "https://texnomart.uz",
      "palette": { "primary": "#FBC100", "secondary": "#333333" },
      "warnings": []
    }
  },
  "qaStatus": "PASS",
  "pageCount": 9,
  "referenceMode": "explicit_full"
}
```

Use `downloadUrl` for browser downloads. The `html` field is only a preview
surface; printing the host page around that preview can collapse the deck into
one page and include UI controls.

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
