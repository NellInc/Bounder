# Site Architecture

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-05-23 -->
<!-- wiki:updated = 2026-07-15 -->
<!-- wiki:status = active -->

## Summary

Bounder.io is the static public interface for a simulation-only physical-interlock reference architecture, hosted on GitHub Pages at www.bounder.io. The canonical root site includes a Three.js simulator, deterministic Go-generated receipts, signed Creed Space Fleet vectors, published JSON schemas, and browser-side contract verification. A preserved Squarespace snapshot remains under `/docs/` with `noindex`, `nofollow`, and `noarchive`. (CLAUDE.md; README.md)

## Dual-Version Architecture

Two parallel site versions are maintained:

1. **Root directory** (`/index.html`, `/contact.html`, `/privacy.html`, `/terms.html`) — simplified modern version using a single shared `styles.css` with CSS custom properties (CLAUDE.md)
2. **`/docs/` directory** — historical Squarespace clone retained for comparison and excluded from search indexing (CLAUDE.md; docs/*.html)

Both are served by GitHub Pages. The root version is the canonical forward-looking version.

## Key Files

| File | Purpose |
|------|---------|
| `styles.css` | Shared CSS design system for root-level pages; defines CSS custom properties (CLAUDE.md) |
| `simulator.js` / `simulator-world.js` | WebGL scene, deterministic scenario presentation, and collision-checked town geometry (README.md) |
| `policy-roundtrip.js` | Local Ed25519 verification of a signed Fleet policy vector (simulator.html) |
| `simulator-fallback.js` | Evidence-only decision view when WebGL cannot start (simulator-bootstrap.js) |
| `data/` / `schemas/` | Canonical Go evidence, Fleet vector, and public contract schemas (README.md) |
| `index.html` | Homepage (root version) |
| `sitemap.xml` / `robots.txt` | SEO configuration (CLAUDE.md) |
| `CNAME` | Custom domain: `bounder.io` (CLAUDE.md) |
| `.github/workflows/update-footer-year.yml` | Auto-updates copyright year annually on Jan 1 (CLAUDE.md) |

## CSS Design System (Root Version)

CSS custom properties defined in `styles.css` (CLAUDE.md):

- **Colors**: `--color-primary`, `--color-white`, `--color-dark`, `--color-accent`, `--color-error`
- **Fonts**: `--font-body` (proxima-nova via Typekit), `--font-heading` (futura-pt via Typekit)
- **Transitions**: `--transition-fast`, `--transition-medium`, `--transition-slow`, `--transition-bounce`

## External Dependencies

- **3D runtime**: pinned, self-hosted Three.js under `vendor/three/` (CLAUDE.md)
- **Images**: canonical local assets under `images/` (CLAUDE.md)
- **Contact delivery**: Formspree (CLAUDE.md)

## Deployment

No production build system. Edit the static sources directly. Local preview uses `python3 -m http.server 8000`; Node supplies contract tests and Playwright browser release gates. All canonical URLs use `https://www.bounder.io/` with www prefix. (CLAUDE.md; README.md)

## Provenance

- Sources consulted: `CLAUDE.md`
- Last verified against sources: 2026-07-15

## See Also

- [[bounder:domain/geofencing-product]]
