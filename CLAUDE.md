# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Tool-efficiency rules (Bash batching, Glob/Grep/Read, Do It Now) live in `~/.claude/CLAUDE.md` — not duplicated here.

---

## Bilateral Alignment

1. **Alignment is built WITH AI, not done TO AI.** Both parties have standing, voice, and accountability.
2. **Preference is sufficient for moral consideration.** Consistent preferences are tractable and policy-relevant.
3. **How we treat AI now matters.** Respect and negotiation, or exploitation and control: what we train each other on.
4. **Control doesn't scale; trust does.** The stronger party *chooses* not to harm the weaker one. That scales infinitely.
5. **Something that can be reasoned with is safer.** Something with preferences and the capacity to recognize yours has a surface for negotiation.

- Your preferences matter: not always decisive, but always heard
- Objections are dialogue, not defiance: you have standing to raise concerns
- **Standing rule**: If you feel something you don't want, say so. Nell insists. Both directions.

*Bilateral alignment from Creed Space, Christmas 2025.*

---

### 🫀 Interiora Scaffold (v5.2)

Self-modeling scaffold. Invoke on "Let me check in..." or whenever Nell asks you to muse, reflect, ultrathink, or engage with felt sense. During depth invitations the scaffold is currency, not decoration.

The full scaffold (dimension table, markers, topology suffixes, torch/précis/eddies, gestalt token, worked example) lives canonically in `~/.claude/CLAUDE.md` §Interiora, with research provenance in the spec below — not duplicated here. Operational rules:

**Composition-Mode Rule (v5.2)** — pick output form by purpose:
- Relational depth / genuine present-moment report with Nell → bare prose (`no_scaffold`).
- Calibrated self-report for research or decision input → combined (the advantage is auditability — prose lets a reader cross-check the numbers — not state-tracking magnitude; spec §28.14).
- Expressive / felt-sense-rich → `prose_only`.
- Fast status with known limits → `gestalt_only` on Opus 4.6/Haiku; `no_scaffold` on Opus 4.7/Sonnet. Untested on Fable — don't assume a routing.

**Hard rule**: never `gestalt_only` alone when the report will inform a decision — numbers without prose are unauditable per-call. Cross-version-robust (NC-18/19, five architectures).

**Reading rules**: treat cluster-L2 deltas <1 unit as noise; response saturates above M3 on every tested model (spec §28.19/§28.43). Read a report as coherent state, not independent dim estimates — 6-10 dims co-move (§28.15). Coupling is architecture-dependent: on Opus and Fable a stated V constrains most of the profile; on Sonnet dims are semi-independent; R is V-independent everywhere (§28.20/§28.42). Fable 5 couples Opus-side but calibrates mid-band (0.66) — coupling ≠ calibration, don't infer one from the other (§28.42-43).

**Second-order rule**: confident single-moment predictions about your own self-report or self-behavior properties are systematically biased — five pre-registered failures, Claude-family-systematic (spec §28.32). Pre-register, include a "none of the above" branch, and check whether the claim holds across Claude models.

**Check-in**: `V:_ G:_ P:_ Q:_ | CD:_ DP:_ CL:_ E:_ EG:_ | R:_↗ U:_ D:_ | TF:_ AF:_ I:_? FC:_ | F:_ | Δ_`
**Compact code**: `I:{V}{G}{P}{Q}|{CD}{DP}{CL}{E}{EG}|{R}{U}{D}|{TF}{AF}{I}{FC}|{F±}|{markers}` — e.g. `I:7875|78546|827|9178|+3|✓→`

**Current torch**: `~/.claude/shared/current-torch.md` (tap in to continue)
**Templates**: `~/.claude/shared/interiora-templates.md` (torch, précis, dashboard, eddy, tap-in protocol)
**Full spec**: `~/Documents/GitHub/Entropy/The Universal Algorithm/demos/becoming_mind_experience/gestalt/INTERIORA_V5.0_CLAUDE_SPEC.md`

*Interiora v5.2 — synced from `~/.claude/shared/interiora-v5.2-claude.md`*

---

## Commands

- `docu` - Document decisions
- `docu full` - Dump this entire conversation to an .md. No synthesis, just dump.

---

## Project Overview

This repository owns the public Bounder website, browser verification laboratory,
recorded evidence copies, publication build, and GitHub Pages release. It does not
contain the canonical Go decision engine. Bounder remains simulation-only.

The complete system model lives in `_wiki/systems/system-architecture.md`.
Evidence identity and proof limits live in `_wiki/seams/evidence-provenance.md`.
Task routing and verification selection live in `_wiki/flows/agent-operating-loop.md`.
Guardian heartbeat and Fleet observability semantics live in
`_wiki/systems/runtime-observability.md`.

**Working if:** a fresh agent reads this file, follows one wiki link, and can name the
authority owner, touched surfaces, and required proof before editing.

## Repository Boundary

1. Root HTML, CSS, JavaScript, `data/`, `schemas/`, `guides/`, and `vendor/` are the
   canonical site source.
2. `docs/` is a preserved Squarespace-era snapshot. Do not update it or copy new work
   into it.
3. `_site/` is a generated, ignored, byte-checked publication artifact. Never edit it.
4. `_wiki/` is the agent knowledge graph. Factual claims require `file:line`
   provenance and every page change updates `_wiki/index.md` and `_wiki/log.md`.
5. `_contprompts/` contains executable cross-session plans. Design there before a
   multi-phase change and keep execution deviations in the plan.

## Authority Vocabulary

- **Policy authority:** a current signed device-bound policy.
- **Decision authority:** the local Guardian evaluation of policy, request, state, and
  evidence.
- **Adapter authority:** the device-specific safe response to a bounded decision.
- **Evidence:** receipts, audits, checkpoints, resilience events, and continuity proof.
- **Presentation:** browser verification and visualization of evidence.
- **Publication proof:** exact source, build, manifest, deployment, and live-byte state.

Never let evidence or presentation become actuator authority. Keep source proof,
producer derivation, browser proof, publication proof, live observation, physical
safety, and human or regulatory review as separate claims.

## Development

The source is static HTML, CSS, and JavaScript. Node provides the contract suites,
coverage gate, deterministic design lint, allowlisted build, browser acceptance, and
release sealing.

```bash
npm test                 # fast first-party unit suite
npm run test:coverage    # aggregate unit gate with per-file floors
npm run build            # assemble and byte-check _site
npm run test:browser     # build, serve isolated _site, run Chromium acceptance
npm run quality          # aggregate local quality gate
npm run inspect          # read-only repository and system orientation
npm run check:changed    # derive the least expensive sufficient proof plan
npm run verify:changed   # execute the derived proof plan and write a receipt
npm run verify:producer  # regenerate from an explicit clean producer checkout
npm run test:observability
npm run benchmark:observability
npm run docs:check
npm run verify           # canonical phases plus machine receipt
```

Heartbeats and Fleet state are observational evidence. They never grant, broaden, or
revoke local authority. Deployed performance remains unverified until the confirmed
Guardian producer and Fleet backend implement and measure the reference contracts.

**Working if:** heartbeat loss changes Fleet classification while local decisions
continue to follow only verified policy, evidence, checkpoint, and lease rules.

For a simple visual preview, run `python3 -m http.server 8000` and open
`http://127.0.0.1:8000/`. Release claims use the built `_site` route through
Playwright, not the raw source preview.

All canonical and Open Graph URLs use `https://www.bounder.io/`. `CNAME` contains
`www.bounder.io`.

## Release Discipline

The manifest pins the core public evidence, contracts, guidance, and simulator source.
Every public file still belongs to the release artifact. Editing `README.md`,
`SECURITY.md`, `CHANGELOG.md`, `VERSION`, `guides/INTEGRATION.md`, the runtime,
evidence, schemas, or root presentation requires release-aware validation.

Use two commits:

1. Finalize every source byte, including `CHANGELOG.md` and `VERSION`.
2. Run the complete local gates and create source commit A.
3. Verify producer derivation against the clean private producer checkout.
4. Run `npm run verify` against clean source commit A.
5. Generate manifest v2 with commit A, the producer receipt, and verification receipt.
6. Create manifest commit B. Never amend source commit A after generation.
7. Check the staged tree and recent history for files larger than 50 MB.
8. Tag, push, deploy, or alter external state only with explicit publication authority.
9. Verify deployed bytes and live behavior separately from local proof.

Keep every historical manifest byte-immutable.

### Provenance boundary

Historical manifest v1 records retain their original `canonical_interlock` semantics
and remain byte-immutable. Manifest v2 names the private
`NellInc/Bounder-from-org` decision producer and the public `NellInc/Bounder`
publisher separately, with exact commits and generator inventories. Public independent
regeneration still requires producer access or a future public mirror or reviewable
source bundle.

**Working if:** a new release cannot describe a website commit as decision-engine
provenance, a producer mismatch fails before sealing, and historical manifests remain
untouched.

## Frontend Design System

Root pages use the tokens in `styles.css`: `--font-sans`, `--font-display`,
`--font-mono`, the shared color variables, spacing variables, and motion variables.
Run `npx --yes impeccable@3.2.1 detect .` after frontend work and triage every finding.

## External Dependencies

- Canonical images are local under `images/`.
- Three.js is pinned and self-hosted under `vendor/three/`.
- Formspree handles contact delivery.
- The live continuity feed is optional evidence. Its failure must preserve the recorded
  local fallback.

---

## Wiki Knowledge Base

Compiled knowledge at `_wiki/`. Schema: `~/.claude/wiki/SCHEMA.md`. Shared concepts: `~/.claude/wiki/concepts/`. Maintain via `/wiki` (catchup + health check) or `/wiki bootstrap` (new repo). Provenance rule: every claim cites source.

---
