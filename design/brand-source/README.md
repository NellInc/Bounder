# Brand source material

Hand-authored and generated candidates behind the shipped marks in `assets/`.
This directory is design provenance only: it is outside the publication
allowlist in `scripts/build-site.mjs` and never ships to the website.

| Shipped asset | Descent |
|---|---|
| `assets/bounder-wordmark.svg` | Byte-identical to `bounder-logo-v2/bounder-wordmark.optimized.svg` |
| `assets/bounder-mark.svg` | Hand-edited after generation; matches no tracked candidate byte-for-byte; recoloured to the site's `--ink` and `--signal` tokens |
| `favicon.ico` | 16, 32 and 48 px renders of `assets/bounder-mark.svg`, packed by `render-icons.py` |
| `assets/apple-touch-icon.png` | 180 px full-bleed render of the same mark, from `render-icons.py` |

Run `python3 design/brand-source/render-icons.py` from the repository root, with
`rsvg-convert` on `PATH`, after any change to the mark; it rewrites both raster icons.

`bounder-logo-v2/generate_candidates.py` produced the numbered candidate
sheets. The `.png` and `.pbm` files are tracing intermediates kept so the
descent above can be re-checked; regenerate rather than edit them.

| Source | Origin |
|---|---|
| `bounder-logo-v2/` marks | Drawn from geometric primitives by `generate_candidates.py` (Pillow), then traced to SVG with potrace 1.16 |
| `bounder-logo-v2/bounder-wordmark*` | The letters `B` and `UNDER` are set in Avenir Next Heavy (index 8 of the macOS system font file `/System/Library/Fonts/Avenir Next.ttc`, a Monotype typeface that ships with macOS) beside the drawn `O` mark, rendered by `generate_candidates.py` and traced with potrace 1.16. The font is not in this repository |
| `bounder-logo/` | Retired first mark (concentric C forms around a diamond), not shipped. Its 1,200 px source PNG and potrace 1.16 trace arrived in commit `0b26a96` (2026-07-14) under `tmp/custom-icons/` with no generator, so how the source image was made is not recorded |

The candidates and the wordmark regenerate on any system with Pillow and a
licensed copy of Avenir Next Heavy: set `BOUNDER_WORDMARK_FONT` to the font file
and, for a font collection, `BOUNDER_WORDMARK_FONT_INDEX` to the Heavy face. The
defaults are the macOS path and index 8; the script stops before writing
anything if the font is missing. Another face produces a different wordmark.

The Bounder name, wordmark and mark are not licensed under Apache-2.0; see
`NOTICE`.
