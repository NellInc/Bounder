# Site Architecture

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-05-23 -->
<!-- wiki:updated = 2026-05-23 -->
<!-- wiki:status = active -->

## Summary

Bounder.io is a static HTML/CSS marketing site for drone geofencing technology, hosted on GitHub Pages at www.bounder.io. It has two parallel site versions that coexist in the same repository: a simplified modern root-level version and a legacy Squarespace-clone version under `/docs/`. (CLAUDE.md)

## Dual-Version Architecture

Two parallel site versions are maintained:

1. **Root directory** (`/index.html`, `/contact.html`, `/privacy.html`, `/terms.html`) — simplified modern version using a single shared `styles.css` with CSS custom properties (CLAUDE.md)
2. **`/docs/` directory** — original Squarespace clone with legacy styling; relies on Squarespace CDN with local overrides in `/docs/assets/css/` (CLAUDE.md)

Both are served by GitHub Pages. The root version is the canonical forward-looking version.

## Key Files

| File | Purpose |
|------|---------|
| `styles.css` | Shared CSS design system for root-level pages; defines CSS custom properties (CLAUDE.md) |
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

- **Fonts**: Typekit (proxima-nova, futura-pt) — may require licensing for local development (CLAUDE.md)
- **Images**: Hosted on `images.squarespace-cdn.com` (CLAUDE.md)
- **Contact forms**: Structure preserved; require backend integration such as Formspree or Netlify Forms (CLAUDE.md)

## Deployment

No build system. Edit HTML/CSS files directly. Local preview via `python3 -m http.server 8000` or `npx serve .`. All canonical URLs use `https://www.bounder.io/` with www prefix. (CLAUDE.md)

## Provenance

- Sources consulted: `CLAUDE.md`
- Last verified against sources: 2026-05-23

## See Also

- [[bounder:domain/geofencing-product]]
