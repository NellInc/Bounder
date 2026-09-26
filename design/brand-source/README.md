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
