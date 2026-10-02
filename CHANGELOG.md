# Changelog

## 1.2.8 · 2026-10-03 (source candidate, unsealed)

### Added

- A two-minute, 1080p Bounder explainer on the homepage, with a native player, optional English captions and a full transcript. The film loads only when requested and retains the simulation-only boundary.
- An original instrumental soundtrack and corrected narrowing-authority diagram, with the accepted final picture and audio preserved in the published file.
- Regression coverage for media identity, captions, responsive layout and browser playback.

## 1.2.7 · 2026-10-01

Sealed by `release/bounder-reference-v1.2.7.manifest.json`.

### Added

- Public `llms.txt` with a concise overview of the simulation testbed and curated links to the architecture, simulator, contact and policy pages.
- Publication allowlist retention and regression coverage for the file, with routing through the existing publication verification lane.

## 1.2.6 · 2026-09-27

Sealed by `release/bounder-reference-v1.2.6.manifest.json`.

Review follow-up to 1.2.5: a rendering fix for the embedded simulator, restraint wording throughout, layout polish, and documentation and terms.

### Fixed

- The embedded simulator no longer shows a blank sky-coloured box after a layout change: the scene is redrawn whenever its size really changes, and resizing to the same size no longer clears it.
- The Fleet legend fits the stage at every width, and on phones the Guardian count moves into the caption.
- The homepage says again that, in this simulation, a high-consequence request is never allowed, whatever is confirmed.
- The proof timestamp is a valid HTML date-time, and the recorded-run note describes the figures on screen.
- Layout: fault-replay tiles no longer look selected on hover, receipt rows share one inner edge, continuity figures use three columns on tablets, the tour link no longer wraps, and the empty decorative rings are gone. The operating-window scenario reads as dusk rather than a darkened image.
- The local test server now exits when the process that launched it exits, so an interrupted browser test run no longer leaves it holding its port.
- The integration guide calls a JSON file chosen for verification the selected file rather than the uploaded file, since it is read in the browser and never uploaded.
- The README and the 1.2.4 release notes give the fallback font's licence its proper name, SIL Open Font License, as NOTICE does.

### Changed

- Identity, consequence and team-separation holds, their adapter responses and Fleet rows are described in restraint wording. The recorded producer strings are unchanged and remain in the evidence.
- Structured data names Nell Watson, Inc. as the site's publisher, matching the terms, privacy notice and footer.
- The terms scope the Apache-2.0 licence to the code in the public Bounder repository and the website's original text, and link to that repository.
- The README adds an intended-use section that matches the terms: restraint-only, not for weapons, targeting or fire control, with export-control responsibility. It lists `README.md`, `SECURITY.md`, `CHANGELOG.md` and `VERSION` among the published files, says that the preview server exits with the process that launched it, documents `npm run check:live`, and adds the release steps that the checks already enforce: renewing the `security.txt` expiry, recording the previous manifest's digest and sealing from a producer commit on its default branch.

### Proof limits

- Deployed Guardian performance, Fleet backend integration, hardware safety and human or regulatory review remain unverified.

## 1.2.5 · 2026-09-26 (published without a sealed manifest)

Second launch-readiness pass: quality, fidelity and plain restraint language across the site, simulator, reference runtime and tooling.

### Fixed

- When the live continuity feed is unreachable, the homepage shows a labelled recorded run ("Recorded run · not live") in place of empty cells. Live cells still clear, so recorded figures never stand in for live proof. Proof times read identically in every browser and time zone (for example "26 Sep 2026, 11:02 UTC").
- The embedded simulator is replaced by a short status card with direct links when its frame fails to load, and the scroll-reveal script no longer waits on slower scripts.
- The contact form tells a busy or refusing provider apart from a connection failure, and refuses to run inside another site's frame.
- Receipt panels read "Unavailable" when the recorded receipts cannot load, rule rows stay neutral until a rule is evaluated, and protection boundaries stay hidden until a scenario selects one.
- A one-finger vertical swipe over the scene scrolls the page without turning the camera. "Focus on drone" frames the drone closely and follows it in flight. The tour and fault replay keep the stage in view on every step.
- The simulator shows a slow-loading notice with a reload button after 20 seconds, says when a browser lacks import-map support, and fails closed if its bootstrap never runs. A browser without Ed25519 is told it cannot verify here rather than shown a rejection.
- Scene fidelity: the Fleet Guardians fly a fixed formation clear of each other and of the rooftops, the windsock streams downwind, the operating-window scenario is lit as dusk, hills sit on the horizon and the subject is framed between the status badge and the legend.
- `/.well-known/security.txt` is now served; the 1.2.4 deployment left it out.

### Changed

- Scenario, rule and badge wording describes restraint only: Team separation, Surrender signalled, Identity check and Consequence check; rules that can only hold read CLEAR rather than PASS. Receipt badges give a plain reason, and producer text is shown with an en-GB reading beside the verbatim record.
- Software renderers and constrained touch devices start the scene in Low power; visitors can switch back.
- The terms add an intended-use section (restraint-only, not for weapons, targeting or fire control, with export-control responsibility), a no-warranty and limitation-of-liability section, and explicit licences: code and original text under Apache-2.0, the Bounder name, wordmark and mark excluded. NOTICE lists the third-party material. The privacy notice names Cloudflare among the services that process data.
- The hero photograph is served as AVIF or WebP where supported, with the JPEG as fallback. The mobile header is one scrolling row, text wraps with balanced headings, and print keeps headings with their content.
- Observability reference: every Fleet-side entry point that classifies a heartbeat now requires Fleet's own receive time and refuses to classify without it, so a fast Guardian clock cannot extend its reachability. Quarantining aggregation lists every copy of a duplicated Guardian.
- Tooling: sealing refuses a producer commit that is not on the producer's default branch, a tracked public file missing from the working tree, or a producer statement naming a file the seal does not pin. Producer derivation runs in a detached worktree and rejects linked files. `npm run check:live` confirms the served VERSION after an authorised deploy. Documentation checks reject citations past the end of a file.

### Accessibility

- The resilience scrubber has a visible label and a spoken time, including after reset. Recorded codes break only at underscores. The text view grows to its content, and camera buttons do not claim a pressed state while it is shown.

### Proof limits

- Sealed manifests v1.1.2 to v1.2.4 name producer commit `d058ae1`, which was never merged to the producer's default branch. Its contract change has since been merged, and this release is derived from a producer commit on the default branch.
- Deployed Guardian performance, Fleet backend integration, hardware safety and human or regulatory review remain unverified.

## 1.2.4 · 2026-09-26

Sealed by `release/bounder-reference-v1.2.4.manifest.json`.

Launch-readiness pass across the site, simulator, reference runtime, tooling and documentation.

### Fixed

- The homepage continuity proof refreshes before its lease lapses, pauses in background tabs and names each failure plainly (feed offline, proof expired, cannot verify here, proof not verified) without placing recorded figures in live cells. Visitors without JavaScript see a short note instead of a permanent loading state.
- Fault replay re-renders the scene from the recorded timeline, including when scrubbed back. "Ready" no longer shows a held state, and closing Fault replay restores the scenario shown before it opened.
- A scenario chosen while Fleet evidence is still loading is no longer replaced. Choosing a scenario by hand closes the tour and updates the address, so a reload shows the same view.
- The embedded simulator always receives its height, even when it loads before the homepage script, shrinks again when its disclosures close, and opens evidence and schema files outside the embedded frame.
- A lost WebGL context pauses the scene with no command authority and recovers when the browser restores it. If neither the 3D view nor the accessible view can load, every panel holds with no command authority and offers a reload.
- The accessible view loads the recorded 100-Guardian run. A failed load reads "Unavailable" rather than staying on "Loading".
- A network failure after a verified signature is reported as unavailable evidence, not a rejected envelope. A browser without Ed25519 support is told so rather than shown a rejection.
- Fleet search matches only text a visitor can read. Rows no longer repeat their outcome code, and a rejected policy update is stated in the row.
- The recorded fallback loads on any same-origin host, and the optional staging feed tolerates a visitor clock up to five minutes slow.
- The contact form keeps its arrow after a failed send, shows failures in the warning colour and hides its heading once delivery is confirmed.
- Scene fidelity: drones face along their route, the Guardian formation no longer stacks, low-power mode drops shadows, the weather scenario shows wind rather than fog, the camera cannot look beneath the ground, marker labels stay legible at phone width and objects share one scale.

### Changed

- Site copy describes restraint only, drops unqualified safety claims and uses British English. The "Safety" navigation item is now "Roadmap".
- The simulator page has its own compact introduction. The skip link, calls to action and tour links land on the workbench.
- Reduced motion jumps to the recorded decision instead of flying the route. The mouse wheel scrolls the page unless the scene has focus, and the plus and minus keys zoom the scene.
- The favicon and a new touch icon are drawn from the current mark, now in the site palette. Pages share a dedicated social card, and a self-hosted condensed fallback font (SIL Open Font License) is used where Avenir Next is unavailable. Two unreferenced legacy images were removed.
- The privacy notice names the controller (Nell Watson, Inc.), the host, the lawful basis, processing in the United States, visitors' rights and the right to complain to the ICO.
- Mirrored preview of the Creed Space manipulator profile contract: its schema, an example profile and a signed golden vector, with the example and vector under `data/` beside the other fixtures. They come from the private producer but are not yet covered by producer derivation, and the browser verifier does not inspect them.
- Observability reference: each telemetry key is bound to one subject, liveness is capped by receive time, snapshots expire with the policies and leases they summarise, aggregation can quarantine a bad heartbeat, and the stable heartbeat interval is 40 seconds so that one lost report cannot expire a Guardian.
- Tooling: the build refuses stray dotfiles, sealing requires a complete verification receipt and tracked public files, new manifests list their inventory in code-unit order, coverage reports browser-only modules separately and browser acceptance runs on a local Node server.
- Release notes: 1.2.0 to 1.2.2 now name their sealing manifests, and 1.2.3 is recorded as published without one.

### Security

- Workflows keep no checkout credentials, pass expressions to shell steps through the environment and cancel superseded pull-request runs. CodeQL also analyses the workflows.
- The issue tracker routes vulnerability reports to private disclosure, and the site publishes `/.well-known/security.txt`.
- Policy snapshots keep an own `__proto__` member so that it is rejected rather than silently dropped, policies dated in year 0000 are rejected, and inherited property names never resolve as telemetry keys.

### Accessibility

- Stable control names with a pressed state, a polite scene announcer, spoken tour steps, a focus ring around the scene, a named 3D scene linked to its explanation, and resilience codes that wrap instead of being cut off.
- Forced-colours support, a spoken new-tab cue on every link that opens one, the current page marked in navigation, a mobile header that no longer covers the headline and a readable line length on long-form pages.

### Proof limits

- The manipulator contract remains a preview until the producer exports it under derivation.
- Deployed Guardian performance, Fleet backend integration, hardware safety and human or regulatory review remain unverified.

## 1.2.3 · 2026-09-11 (published without a sealed manifest)

Deployed from source commit `56fdbed`. No release manifest was sealed for this version; its changes are carried into 1.2.4.

- Copy pass across visitor-facing prose: a clearer homepage, README, integration guide and legal pages, and a reformatted SECURITY threat model.

## 1.2.2 · 2026-09-07

Sealed by `release/bounder-reference-v1.2.2.manifest.json`.

- Added a 16px left inset to the homepage demo’s light area while keeping its dark evidence sections flush left.

## 1.2.1 · 2026-09-07

Sealed by `release/bounder-reference-v1.2.1.manifest.json`.

- Removed repetitive presentation disclaimers and consolidated homepage status as a development testbed working towards deployment.
- Shortened live-feed fallback text and replaced the warning section with a development roadmap.
- Preserved the v1.2.0 source seal and recorded the final presentation changes in a new release.

## 1.2.0 · 2026-09-07

Sealed by `release/bounder-reference-v1.2.0.manifest.json`.

- Restored the illustrated, animated hero and headline.
- Refined mobile navigation, keyboard focus and evidence targets; added one-click Fleet filter reset.
- Scene and recorded decision share a responsive workspace, with secondary evidence tools.
- Grouped scenarios, guided progression, full-text Fleet inspection and platform/outcome filters.
- Overview, top-down, subject focus, text explanation and independent low-power rendering.
- Demand rendering when paused and suspension outside the visible scene; geometry separated from evidence presentation.
- Policy, parsing, signature and round-trip implementations moved into their existing module boundaries.
- Clearer simulation status, public/private source ownership, and developer contract examples.
- Contact failure recovery, provider-confirmed acceptance and explicit hosted-form fallback.

## 1.1.2 · 2026-09-03

Broad polish release from a verified repository audit: 64 confirmed findings across
pages, styles, browser runtime, observability runtime, tooling, CI, tests, and
documentation.

### Fixed

1. Fleet aggregation no longer throws on a fleet where every Guardian reports checkpoint sequence 0, and a Guardian at sequence 0 is no longer erased from the reported minimum. Rollback detection survives a zero-valued baseline.
2. A Guardian that is already held or expired at first contact emits its state event alongside `guardian_connected`.
3. Signed telemetry payloads are parsed by the same strict parser as signed policy, so signed bytes and parsed values cannot disagree; the telemetry `public_key_id` bound now matches the published schema.
4. The 404 page uses root-relative references, so it renders styled with a working home link below the site root.
5. The 3D stage leaves vertical page scrolling to the browser on touch devices; a WebGL runtime failure releases the renderer and canvas input; reduced-motion mode no longer spins an idle animation loop; simulator initialisation failures are reported instead of silently dropped; every degraded resilience-stream path marks the recorded fallback.
6. The embedded simulator clamps out-of-range height reports instead of discarding them, so narrow viewports are no longer clipped.
7. The policy round-trip panel mounts from the `ui/` seam instead of as a side effect of importing the policy core, and tolerates missing panel markup.
8. Keyboard focus rings are visible on the dark simulator workbench; the continuity-proof panel no longer inherits a two-column grid from the shared stylesheet; Fleet node labels and muted panel text meet legibility and contrast floors; duplicate and dead rules removed; `color-scheme` declared.
9. Simulator panels are named by static headings rather than live status values, giving the page a complete heading outline for assistive technology.
10. Copy corrections: the hero keeps decision and adapter authority separate, the safety section names both recorded observations, spelling is consistently British, Guardian is capitalised consistently, the terms page names only third parties the site actually uses, and body links open rendered pages rather than raw Markdown.
11. The privacy notice discloses the automatic continuity-feed request the home page makes and its privacy properties.
12. Sitemap `lastmod` values and legal-page dates are current; Open Graph images declare dimensions and type; the operator-demonstration feedback link now has a matching issue template.

### Changed

1. Every published page carries a Content-Security-Policy meta tag with hash-allowed inline scripts, enforced by a unit test that recomputes the hashes.
2. Three shared observability schemas tightened: identity patterns are anchored to match the runtime validator, and a Fleet snapshot must expect at least one Guardian. The private producer must carry the same bytes before the next seal.
3. Design lint runs the lockfile-pinned `impeccable` instead of a tarball fetched at deploy time; CI installs with scripts disabled and a declared Node floor.
4. The publication lock records its owner and recovers from a build killed mid-flight; orphaned staging and backup trees are swept; interruption releases the lock.
5. Producer-derivation CI verifies the commit named by the newest sealed manifest and scopes the private read token to the one step that uses it.
6. `docs:check` enforces repository containment on citations, verifies that quoted anchors still resolve inside their cited ranges, and warns when an impact rule fails to route a page that cites its paths; generated wiki pages no longer carry a hand-maintained freshness date.
7. Verification phases signal their whole process group, forward interrupts, and hash byte-exact logs; receipts distinguish detected producer drift from an absent producer run and record phases that fail to spawn.
8. Coverage scratch is per-run; historical-manifest immutability is derived from the release directory; the browser web server timeout accommodates a loaded machine.
9. Unit tests no longer write receipts into the working tree; browser acceptance exercises the working reveal observer, the resilience console controls and scrubber, and every declared breakpoint band.
10. Brand source material moved from `tmp/` to `design/brand-source/` with recorded descent; `tmp/` is ignored.

### Proof limits

1. The producer repository remains private, so independent public regeneration requires access or a future public mirror or reviewable source bundle.
2. Deployed Guardian performance, Fleet backend integration, hardware safety, certification, and human, legal, rights, and regulatory review remain unverified.
3. Deployment and live-byte parity require separate post-merge evidence.

## 1.1.1 · 2026-09-01

Publication-integrity correction for the agent control plane release.

### Fixed

1. The private producer now pins Go 1.25.14, clearing reachable standard-library vulnerabilities found by hosted `govulncheck` on the earlier 1.25.12 toolchain.
2. Producer provenance derives the exact patch-level Go directive from the tracked module instead of reporting a stale hardcoded version, and the shared schema rejects ambiguous or minor-only toolchain identities.
3. Website drift verification pins the corrected immutable producer commit, while the superseded v1.1.0 local seal remains byte-immutable in release history.
4. Changed-path planning now owns every file added by the control-plane programme, closing four routes that previously fell through to the conservative aggregate fallback.

### Proof limits

1. The producer repository remains private, so independent public regeneration requires access or a future public mirror or reviewable source bundle.
2. Deployed Guardian performance, Fleet backend integration, hardware safety, certification, and human, legal, rights, and regulatory review remain unverified.
3. Deployment and live-byte parity require separate post-merge evidence.

## 1.1.0 · 2026-09-01

Agent control plane, explicit producer provenance, and Guardian and Fleet
observability reference.

### Changed

1. A validated system descriptor now owns components, roles, artifacts, authority boundaries, commands, proof classes, impact rules, and observability budgets.
2. Inspection, changed-path planning, generated task routes, generated CI impact data, focused verification, and aggregate verification emit compact machine-readable state and receipts.
3. The private Go producer and public website publisher now have distinct immutable identities. Clean producer export regenerates three published artifacts and checks 13 byte-identical shared contracts.
4. Release manifest v2 records producer inputs and outputs, publisher source, build proof, recorded observations, deployment status, and live-observation status without changing historical manifests.
5. Guardian heartbeat, Fleet snapshot, Fleet transition, and telemetry-envelope contracts now have deterministic validation, replay, rollback, expiry, fault, privacy, scheduling, and a 10,000-Guardian reference benchmark that gates process CPU cost while retaining wall time as a load diagnostic.
6. Browser entry points are stable composition facades with narrow policy, transport, receipt, Fleet, resilience, UI, and simulator ownership seams.
7. The 16-Guardian Fleet laboratory and 100-Guardian staging pilot remain explicitly classified as recorded observations.

### Proof limits

1. The producer repository is private, so independent public regeneration requires access or a future public mirror or reviewable source bundle.
2. Deployed Guardian performance, Fleet backend integration, hardware safety, certification, and human, legal, rights, and regulatory review remain unverified.
3. This local candidate does not establish deployment or live-byte parity.

## 1.0.4 · 2026-08-25

Browser continuity-proof hotfix.

### Fixed

1. Live proof transport deadlines and freshness leases now invoke native browser timers with the correct `Window` receiver, restoring the signed 100-Guardian proof on the homepage.
2. Chromium acceptance now exercises the default browser timer path so an illegal native-function invocation cannot silently downgrade valid live evidence again.
3. Release generation now pins the immutable v1.0.3 manifest and provenance, allowing subsequent release manifests to be sealed without weakening historical integrity checks.

## 1.0.3 · 2026-08-20

Adversarial correctness and evidence-contract hardening for the simulation,
browser runtime, release tooling, and automated acceptance gates.

### Changed

1. Receipt, Fleet, resilience, staging, continuity, policy, and checkpoint inputs now use exact bounded contracts with canonical timestamps, strict provenance relations, immutable snapshots, and fail-closed error states.
2. Network readers enforce exact origins and media types, cumulative byte and chunk limits, authoritative deadlines, abort cleanup, fatal UTF-8 decoding, and protection from late or reordered completions.
3. The simulator independently gates receipt and Fleet readiness, validates every recorded decision before enabling controls, rejects malformed or partial event streams, and preserves local evidence when optional Fleet data fails.
4. Fleet resilience mappings are deterministic across the 100-Guardian pilot, including exact six-canary behavior, while recorded Fleet signatures are explicitly labelled unauthenticated because the fixture does not publish the audit public key.
5. Route collision checks use constant-work exact slab clipping against frozen visible building bounds and reject malformed, mutable, nonfinite, or resource-exhausting geometry.
6. Policy round-trip verification re-evaluates the signed policy against snapshotted request state, evidence, and global rules, preserves nanosecond time semantics, and prevents stale asynchronous results from changing the interface.
7. Every published JSON Schema now pins practical size, shape, time, encoding, scenario, ordering, and relational constraints, with local cryptographic verification of the published signed vectors.
8. Publication and manifest generation reject symlinks, aliases, special files, resource exhaustion, corrupt history, concurrent mutation, ambiguous filesystem outcomes, and ownership races without damaging a prior valid artifact.
9. Browser acceptance always builds and serves the allowlisted `_site` artifact, and now covers readiness races, malformed evidence, stream fallback, visibility, WebGL loss, the full operator tour, embedded-message trust, inline query states, accessibility, and mobile layout.
10. Unit coverage uses an all-source, per-file gate of 85% lines, 75% branches, and 85% functions. Weak implementation-text assertions duplicated by behavior tests were removed.
11. GitHub Pages separates unprivileged verification from the privileged deployment job, and both quality workflows gate the exact dependency install, strong unit coverage, allowlisted build, design lint, and Chromium acceptance.

## 1.0.2 · 2026-08-12

Repository-wide trust and publication hardening. The simulator decision model and
canonical evidence fixtures are unchanged.

### Changed

1. GitHub Pages now deploys an explicit public allowlist, excluding historical snapshots, tests, working assets, and repository automation.
2. Deployment verifies the test suite before assembling the public artifact.
3. Security guidance now describes this repository's actual static-site and simulator threat surface, with a working private-reporting route.
4. Documentation consistently names the canonical `NellInc/Bounder` repository.
5. Canonical pages publish a strict cross-origin referrer policy, and sitemap modification dates reflect the update.
6. Playwright and axe-core development dependencies were refreshed to their current compatible releases.
7. New regression tests pin publication boundaries, local references, canonical metadata, and repository guidance.
8. Privileged GitHub Actions now use immutable commit pins; invalid checkout v7 references were replaced with the verified v6 release.
9. The footer is timeless, removing an annual bot that would have changed release-pinned pages and broken manifest verification.

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
