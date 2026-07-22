# Changelog

## 1.0.1 · 2026-07-23

Site polish and link-integrity patch. No changes to the interlock, receipts, or
simulator behaviour. Ships together with the staging-evidence work merged on
main since 1.0.0 (integrity-pinned Bounder staging pilot, signed live
continuity feed, GitHub Pages Actions deploy, accessible page transitions).

### Fixed

1. Canonical header and footer navigation across all pages (previously every page carried a different link set), pinned by a new browser test.
2. All thirteen repository links now point to the canonical `NellInc/Bounder` (previously the retired `NellWatson/Bounder` mirror).
3. Security-policy link resolves: `SECURITY.md` ported from the retired mirror and linked on `main`.
4. Brand emphasis words render in the display face (`--font-heading` referenced an undefined token).
5. Twitter-card image alt text matches the actual Open Graph image; homepage card gained its missing alt.
6. Interior-page `theme-color` matches the rendered white surface.
7. Keyboard focus ring uses ink on light interior pages (lime was ~1.4:1 on white).
8. Accessibility (axe) release gate extended to contact, privacy, terms, and 404 pages.
9. Release manifest v1.0.1 re-pins published artifacts with the canonical-interlock reference corrected to `NellInc/Bounder@main`.

## 1.0.0 · 2026-07-15

First release of Bounder as a simulation-only physical-interlock reference architecture.

### Included

1. Widescreen Three.js town and Fleet simulator with keyboard navigation.
2. Deterministic Go-generated decision receipts and public schemas.
3. Civilian, friendly-force, protected-place, humanitarian, surrender, incapacitation, identification, proportionality, authorization, operational, weather, link, and replay scenarios.
4. Sixteen-Guardian Creed Space Fleet evidence and resilience replay.
5. Local Ed25519 verification of the cross-language signed Fleet vector.
6. Evidence-only fallback when WebGL is unavailable.
7. Browser accessibility, responsive-layout, failure-state, and interaction release gates.
8. Apache License 2.0 licensing and attribution.
9. SHA-256 release manifest pinned to the merged canonical interlock commit.
