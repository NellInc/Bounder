# Bounder workspace design QA

Self-review: this implementation and the selected mockup were produced with my input.

## Iteration 1
Compared the approved Option 1 image (1488 × 1058) and the first built desktop capture (1440 × 1024) together. The small viewport mismatch prevents pixel-level scoring; these are visible composition findings.

- P1: pale canonical wordmark against a pale header has insufficient visual contrast. Use the approved dark header, retaining the actual wordmark.
- P2: excessive introductory height and a tall scene push camera controls below the desktop fold. Compact the introductory hierarchy and frame the town within a landscape scene.
- P2: default camera includes excessive sky and makes the protected subject small. Lower the overview target to frame the town.
- Fixed before this comparison: WebGL fallback white copy on light scene had 1.46:1 contrast. Dark fallback copy replaces it.

The scene/result relationship, genuine scenario controls, recorded adapter response and receipt disclosure are present. Exact source fonts, real branding and evidence identifiers are intentional departures from invented mock details. No account UI is introduced.

Iteration 1 result: blocked

Revised matched-viewport capture, mobile review and final regression gates are pending.

## Iteration 2, desktop
Compared the selected target and revised `artifacts/verification/workspace-desktop.png` together at 1488 × 1058, device scale 1, civilian-buffer selected, receipt collapsed.

- The canonical wordmark is legible on the corrected dark header.
- The scene, decision and camera controls are now visible together in the desktop capture.
- The lower camera target better frames the town. Focus subject and top-down offer closer/spatial inspection without changing the recorded outcome.
- Typography deliberately retains the existing Bounder display/sans/mono tokens instead of the mockup's invented type treatment.
- The actual paper/ink/lime palette is retained, with readable rust for the held outcome. Provenance and adapter response remain visibly separate.
- Real Three.js geometry remains interactive, with no raster substitution or invented physical telemetry. The evidence is the source of the displayed cause.
- The four quick scenarios, additional operating limits, real six-step tour and existing navigation deliberately replace mockup-only controls.

Desktop comparison: no remaining P0/P1/P2 visual finding. Remaining P3: a tighter subject-first framing could be explored later; the overview intentionally retains town context. Header navigation remains site-wide, rather than replacing it with a mockup-specific app bar.

At this stage mobile and full browser validation remained pending.

## Iteration 3, final visual comparison
The final desktop capture and selected reference were reopened together at 1488 × 1058. The mobile capture was reviewed at its native 390-pixel width, and the Fleet detail capture was inspected at readable size. The final shorter GitHub source label and reduced tracking on the provenance label preserve the chosen hierarchy.

All five fidelity surfaces were checked: existing display/sans/mono typography, scene/result spacing and responsive stacking, paper/ink/lime/rust colors, live scene image quality, and source-grounded copy. No actionable P0/P1/P2 visual difference remains. The source fonts, real wordmark, site navigation, overview framing and factual evidence controls are intentional product constraints rather than literal reproductions of fictional mock content.

Mobile controls wrap without horizontal overflow; the recorded response remains readable after the scene, and secondary tools remain collapsed until requested. Expanded evidence passes the browser accessibility check. Fleet inspection exposes the complete reason and receipt after platform/outcome/search filtering. Its source limits remain visible. Remaining P3: an optional compact mobile site header and a tighter subject-first default camera could be explored in a future design iteration.

Source target (local): `/Users/nellwatson/.codex/generated_images/01a07b0a-b48e-7da1-9d01-50e4d3f4045a/exec-34c31d79-2df5-4881-bcd7-be3944b3df6e.png`.
Captures (local): `artifacts/verification/workspace-desktop.png`, `artifacts/verification/workspace-mobile.png`, `artifacts/verification/fleet-detail.png`.
The formal repository Playwright runner produced these captures because the in-app and Chrome connectors were unavailable. It checked the built site; this is not a deployment claim or a physical-device test.

final result: passed

The aggregate quality command and release authority are separate gates, recorded in `artifacts/experience-polish-notes.md`.
