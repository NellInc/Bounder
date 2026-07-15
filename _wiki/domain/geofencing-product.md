# Physical Interlock Reference Architecture

<!-- wiki:type = domain -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-05-23 -->
<!-- wiki:updated = 2026-07-15 -->
<!-- wiki:status = active -->

## Summary

Bounder is an open reference architecture for local, auditable physical interlocks. Guardian is the general safety pattern, Bounder specializes it for embodied movement and physical-action boundaries, and Creed Space Fleet distributes and governs signed policies. The public project is simulation-only. (CLAUDE.md; README.md)

## Product Domain

Bounder checks signed authority, current policy, local state, and verified evidence immediately before a physical state change. The same contract can protect drones, ground robots, autonomous boats, warehouse vehicles, inspection platforms, and fixed machinery. Device adapters retain responsibility for the safest platform-specific response. (CLAUDE.md; guides/INTEGRATION.md)

## Site Content Sections

The root `index.html` and supporting pages cover (CLAUDE.md):
- **`index.html`** — Main architecture and project overview
- **`simulator.html`** — Interactive Three.js scenario, Fleet resilience, and signed-policy verification laboratory
- **`contact.html`** — Formspree-backed contact route
- **`privacy.html`** — Privacy policy
- **`terms.html`** — Terms of service
- **`404.html`** — Custom error page

## SEO Configuration

- Canonical URLs use `https://www.bounder.io/` (with www prefix) in canonical tags and Open Graph metadata (CLAUDE.md)
- `sitemap.xml` and `robots.txt` present for crawler guidance (CLAUDE.md)

## Provenance

- Sources consulted: `CLAUDE.md`, directory listing
- Last verified against sources: 2026-07-15

## See Also

- [[bounder:systems/site-architecture]]
