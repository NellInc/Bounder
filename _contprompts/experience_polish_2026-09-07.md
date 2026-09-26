# Bounder experience polish

## Contract
Goal: implement the approved Option 1 scene-and-decision workspace, guided progression and top-down view, clearer Fleet inspection and contract explanations, truthful public copy, focused modularisation and validated local delivery.
Allowed surfaces: canonical site HTML/CSS/JS, existing runtime/UI seams, tests, guides, system descriptor and wiki documentation required by source changes.
Invariants: simulation-only; recorded decisions remain producer-owned; signatures, parsing limits, time/replay rules and fallback remain unchanged; no actuator transport; existing public facades retained; historical manifests and docs/ snapshot untouched.
Non-goals: deployment, producer mutation, new authenticated evidence, framework replacement, physical validation or newly claimed certification.
Proof: unit coverage, build byte check, browser suite, rendered desktop/mobile inspection, keyboard/fallback/timeout scenarios, pinned design lint and system/docs checks. Producer derivation and release sealing remain separate from local delivery.
Publication authority: none.

## Adversarial pre-check
The mockup contains invented branding/account controls and receipt identifiers; retain canonical brand assets and omit unsupported UI. Richer models must remain evidence-driven, with no inferred decisions. Progressive disclosure must retain visible provenance and keyboard access. Existing tour has six supported steps; reuse rather than replace it with an invented three-step evidence flow. The six-platform asset family is limited to existing evidence-backed platform classification; no fabricated platform physics. Human comprehension and hardware measurements cannot be established by browser tests.

## Plan
1. Recompose simulator into scene/result workspace with grouped scenarios and secondary evidence sections.
2. Add accessible Fleet search/filter/detail, camera controls and explanatory view; improve scene focus and lifecycle.
3. Move policy implementations into their existing logical seams without semantic change.
4. Refine public copy and developer contract guide; correct source ownership metadata.
5. Add behavioural regression coverage and run aggregate gates plus rendered QA.
6. Record exact achieved proof and residual release/human gates.

## Deviations
- Approved refinements are applied to the selected Option 1 target: actual wordmark, no account UI, no invented identifier; existing six-step tour retained.
- The existing live Three.js model is retained instead of replacing it with a raster mockup, preserving interaction and receipt-driven explanation.

- Validation instrumentation: automatic Playwright trace filmstrips are disabled after repeated GPU ReadPixels stalls. DOM/source traces and explicit QA screenshots remain, with all assertions and application transport limits retained.

## Status
Completed for the approved local scope. `npm run quality` passed (406 unit tests with configured per-file coverage floors, 25 browser tests, design lint). Built desktop/mobile/Fleet visual QA passed. Public fixtures, historical manifests and producer code remain unchanged. Release sealing, deployment, actual contact delivery and physical/human validation remain separate gates.

## Status note (2026-09-26)
Recorded as facts after this plan closed; the contract above is unchanged. The work continued past the local scope: v1.2.0, v1.2.1 and v1.2.2 were sealed on 2026-09-07 (commits `c5b6fb5`, `6f7f85a`, `bd42b37`) and reached `main`, and v1.2.3 (source commit `56fdbed`, 2026-09-11) was deployed without a sealed manifest. "Publication authority: none" therefore no longer describes the state of this line. No git tags were created for these versions. The launch-readiness pass continues as the unsealed 1.2.4 candidate.
