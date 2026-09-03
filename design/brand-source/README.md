# Brand source material

Hand-authored and generated candidates behind the shipped marks in `assets/`.
This directory is design provenance only: it is outside the publication
allowlist in `scripts/build-site.mjs` and never ships to the website.

| Shipped asset | Descent |
|---|---|
| `assets/bounder-wordmark.svg` | Byte-identical to `bounder-logo-v2/bounder-wordmark.optimized.svg` |
| `assets/bounder-mark.svg` | Hand-edited after generation; matches no tracked candidate byte-for-byte |

`bounder-logo-v2/generate_candidates.py` produced the numbered candidate
sheets. The `.png` and `.pbm` files are tracing intermediates kept so the
descent above can be re-checked; regenerate rather than edit them.
