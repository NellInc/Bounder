import {
  FLEET_AUDIT_AUTHENTICATION,
  MAX_FLEET_EVIDENCE_BYTES,
  MAX_RECEIPT_BUNDLE_BYTES,
  RESILIENCE_CONTRACTS,
  SIMULATOR_SCENARIOS,
  fetchSimulatorJSON,
  resolveFleetGuardianAliases,
  validateFleetEvidence,
  validateReceiptBundle
} from "./simulator-contracts.js";
import { renderFleetRows, renderFleetSummary, showFleetUnavailable } from "./ui/fleet-view.js";
import { markAffectedGuardians, renderContinuityProof, renderResilienceTimeline } from "./ui/resilience-view.js";
import { asSentence } from "./ui/text.js";
import { glossAdapterOutput, glossReason, outcomeHeadline, stageBadge } from "./ui/receipt-copy.js";

// Must stay the first statement of the module body. Static imports evaluate before it, so
// the mark proves every dependency loaded and this view began running; the bootstrap only
// retries this entry when the mark is absent.
document.querySelector(".simulator-stage").dataset.fallbackStarted = "true";

const root = document.querySelector(".simulator-workbench");
const stage = root.querySelector(".simulator-stage");
const phaseElement = root.querySelector(".status-phase");
const statusCode = root.querySelector(".status-code");
const outcomeElement = root.querySelector(".decision-outcome");
const decisionCode = root.querySelector(".decision-code");
const reasonElement = root.querySelector(".decision-reason");
const adapterOutput = root.querySelector(".adapter-output");
const receiptSource = root.querySelector(".receipt-source");
const receiptFields = Object.fromEntries(
  [...root.querySelectorAll("[data-receipt]")].map((element) => [element.dataset.receipt, element])
);
const fleetNodes = root.querySelector("[data-fleet-nodes]");
const fleetSource = root.querySelector("[data-fleet-source]");
const resilienceLab = root.querySelector(".resilience-lab");
const resilienceScenarios = root.querySelector("[data-resilience-scenarios]");
const resilienceEvents = root.querySelector("[data-resilience-events]");
const resilienceFields = Object.fromEntries(
  [...root.querySelectorAll("[data-resilience]")].map((element) => [element.dataset.resilience, element])
);
const resilienceScrubber = root.querySelector("[data-resilience-scrubber]");
const resilienceActions = Object.fromEntries(
  [...root.querySelectorAll("[data-resilience-action]")].map((element) => [element.dataset.resilienceAction, element])
);
const continuityProof = root.querySelector("[data-continuity-proof]");
const scenarioButtons = [...root.querySelectorAll("[data-scenario]")];
const playButton = root.querySelector("[data-action='play']");
const fleetButton = root.querySelector("[data-action='fleet']");
const tourButton = root.querySelector("[data-action='tour']");
const initialParameters = new URLSearchParams(window.location.search);
const requestedScenario = initialParameters.get("scenario");
const requestedResilience = initialParameters.get("resilience");
const RESILIENCE_RECEIPT_ENGINE = "Creed Space Fleet + Bounder Guardian";
const resilienceRule = Object.freeze(Object.fromEntries(Object.entries(RESILIENCE_CONTRACTS).map(([id, contract]) => [id, contract.rule])));

let bundle;
let receiptsByScenario = new Map();
let selectedScenario = "safe";
let fleetEvidence;
let fleetGuardianAliases = new Map();
let resilienceMode = false;
let selectedResilience;
let scenarioBeforeResilience;
let resilienceCursor = -1;
let resilienceTimers = [];
let resilienceGeneration = 0;

const syncSelectionURL = () => {
  if (initialParameters.get("embed") === "1") return;
  const parameters = new URLSearchParams(window.location.search);
  for (const key of ["tour", "step", "scenario", "resilience", "fleet"]) parameters.delete(key);
  if (resilienceMode && selectedResilience) parameters.set("resilience", selectedResilience.id);
  else parameters.set("scenario", selectedScenario);
  window.history.replaceState(null, "", `${window.location.pathname}?${parameters.toString()}${window.location.hash}`);
};

const setRuleState = (failedRule, triggered = true) => {
  for (const item of root.querySelectorAll(".rule-stack li")) {
    const isTarget = failedRule !== "all" && item.dataset.rule === failedRule;
    const failed = triggered && isTarget;
    const monitoring = !triggered && isTarget;
    item.classList.toggle("is-failed", failed);
    item.classList.toggle("is-monitoring", monitoring);
    item.classList.toggle("is-pass", !failed && !monitoring);
    item.classList.remove("is-unavailable");
    item.querySelector("strong").textContent = failed ? "HOLD" : monitoring ? "CHECK" : "CLEAR";
  }
};

const clearResilienceTimers = () => {
  resilienceGeneration += 1;
  for (const timer of resilienceTimers) window.clearTimeout(timer);
  resilienceTimers = [];
  if (resilienceActions.pause) resilienceActions.pause.disabled = true;
  return resilienceGeneration;
};

const displayDeviceID = (id) => {
  const alias = fleetGuardianAliases.get(id);
  return alias && alias !== id ? `${alias} (recorded as ${id})` : id;
};

const leaveResilienceMode = () => {
  clearResilienceTimers();
  resilienceMode = false;
  selectedResilience = undefined;
  if (fleetNodes) markAffectedGuardians(fleetNodes, "", fleetGuardianAliases);
  for (const button of resilienceScenarios?.querySelectorAll("button") ?? []) {
    button.setAttribute("aria-pressed", "false");
  }
};

const renderReceipt = (scenario, { revealButton = true } = {}) => {
  const receipt = receiptsByScenario.get(scenario);
  if (!receipt) return;
  selectedScenario = scenario;
  for (const button of scenarioButtons) button.setAttribute("aria-pressed", String(button.dataset.scenario === scenario));
  receiptSource.textContent = "Recorded interlock receipt (Go engine) · accessible evidence view";
  // Same words as the 3D view: a plain stage label, the recorded code once in the receipt.
  phaseElement.textContent = stageBadge(receipt);
  statusCode.textContent = receipt.code;
  statusCode.hidden = true;
  outcomeElement.textContent = outcomeHeadline(receipt.allowed);
  outcomeElement.dataset.outcome = receipt.allowed ? "allowed" : "held";
  decisionCode.textContent = receipt.code;
  decisionCode.hidden = receipt.allowed;
  reasonElement.textContent = asSentence(glossReason(receipt.reason));
  adapterOutput.textContent = glossAdapterOutput(receipt.adapter.output);
  receiptFields.reason.textContent = receipt.reason;
  receiptFields.adapter.textContent = receipt.adapter.output;
  receiptFields.engine.textContent = bundle.engine;
  receiptFields.signature.textContent = receipt.signature_verified ? "Recorded as verified by Go engine" : "Recorded verification failed";
  receiptFields.policy.textContent = receipt.policy_id;
  receiptFields.issuer.textContent = receipt.issuer;
  receiptFields.subject.textContent = receipt.subject;
  receiptFields.sequence.textContent = String(receipt.sequence);
  receiptFields.evidence.textContent = `${receipt.evidence.tier} · ${receipt.evidence.auditor} · ${receipt.evidence.age_seconds}s old`;
  // The recorded timestamp, unchanged, marked up as a machine-readable time.
  const evaluatedTime = document.createElement("time");
  evaluatedTime.dateTime = receipt.evaluated_at;
  evaluatedTime.textContent = receipt.evaluated_at;
  receiptFields.evaluated.replaceChildren(evaluatedTime);
  receiptFields.hash.textContent = receipt.policy_hash;
  setRuleState(receipt.allowed ? "all" : receipt.rule, true);
  const group = root.querySelector(`[data-scenario="${scenario}"]`)?.closest("details");
  if (group && revealButton) group.open = true;
};

const applyResilienceEvent = (event) => {
  if (!selectedResilience) return;
  const index = selectedResilience.events.findIndex((candidate) => candidate.at_ms === event.at_ms && candidate.code === event.code);
  if (index < 0) return;
  resilienceCursor = index;
  resilienceScrubber.value = String(event.at_ms);
  resilienceScrubber.setAttribute("aria-valuetext", `${(event.at_ms / 1000).toFixed(2)} seconds, ${event.kind}`);
  resilienceFields.time.textContent = `${(event.at_ms / 1000).toFixed(2)} s`;
  resilienceFields.transport.textContent = event.kind === "audit" ? "Evidence recorded" : asSentence(event.message);
  resilienceFields.transport.dataset.status = event.status;
  renderResilienceTimeline(resilienceEvents, selectedResilience, resilienceCursor);
  renderContinuityProof(continuityProof, resilienceFields, selectedResilience, index);
  markAffectedGuardians(fleetNodes, event.device_id || selectedResilience.affected_device, fleetGuardianAliases);
  receiptSource.textContent = "Fleet resilience evidence · accessible evidence view";
  receiptFields.engine.textContent = RESILIENCE_RECEIPT_ENGINE;
  receiptFields.signature.textContent = FLEET_AUDIT_AUTHENTICATION.label;
  receiptFields.policy.textContent = fleetEvidence.policy_profile;
  receiptFields.issuer.textContent = "creed.space/fleet";
  receiptFields.subject.textContent = displayDeviceID(event.device_id || selectedResilience.affected_device);
  receiptFields.sequence.textContent = String(event.policy_sequence || 0);
  receiptFields.evidence.textContent = selectedResilience.proof;
  receiptFields.evaluated.textContent = `t + ${(event.at_ms / 1000).toFixed(2)} seconds`;
  receiptFields.hash.textContent = "See signed Fleet evidence bundle";
  receiptFields.reason.textContent = event.message;
  receiptFields.adapter.textContent = selectedResilience.safe_response;
  const decisionIndex = selectedResilience.events.findIndex((candidate) => candidate.kind === "decision");
  const held = decisionIndex >= 0 && index >= decisionIndex;
  if (held) outcomeElement.dataset.outcome = "held";
  else delete outcomeElement.dataset.outcome;
  if (event.kind === "baseline") {
    phaseElement.textContent = "Policy active";
    outcomeElement.textContent = "Monitoring";
    adapterOutput.textContent = "No state change yet";
    setRuleState(resilienceRule[selectedResilience.id], false);
  } else if (event.kind === "fault") {
    phaseElement.textContent = "Fault injected";
    outcomeElement.textContent = "Verifying";
    adapterOutput.textContent = "Authority frozen during verification";
    setRuleState(resilienceRule[selectedResilience.id], false);
  } else if (event.kind === "decision") {
    phaseElement.textContent = "Bounder held";
    outcomeElement.textContent = "Held safely";
    adapterOutput.textContent = "No new command authority";
    setRuleState(resilienceRule[selectedResilience.id], true);
  } else {
    phaseElement.textContent = "Receipt recorded";
    outcomeElement.textContent = "Audited";
    adapterOutput.textContent = "Safe state retained";
    setRuleState(resilienceRule[selectedResilience.id], held);
  }
  statusCode.textContent = event.code;
  decisionCode.textContent = event.code;
  decisionCode.hidden = false;
  reasonElement.textContent = asSentence(event.message);
};

const resetResilience = () => {
  clearResilienceTimers();
  resilienceCursor = -1;
  resilienceScrubber.value = "0";
  resilienceScrubber.setAttribute("aria-valuetext", "0.00 seconds, ready");
  resilienceFields.time.textContent = "0.00 s";
  resilienceFields.transport.textContent = "Ready";
  delete resilienceFields.transport.dataset.status;
  markAffectedGuardians(fleetNodes, "", fleetGuardianAliases);
  renderResilienceTimeline(resilienceEvents, selectedResilience, resilienceCursor);
  renderContinuityProof(continuityProof, resilienceFields, selectedResilience, -1);
  if (selectedResilience) {
    const first = selectedResilience.events[0];
    statusCode.textContent = first.code;
    decisionCode.textContent = "ready";
    decisionCode.hidden = true;
    phaseElement.textContent = "Fault laboratory ready";
    outcomeElement.textContent = "Ready";
    delete outcomeElement.dataset.outcome;
    reasonElement.textContent = selectedResilience.fault;
    adapterOutput.textContent = "No state change yet";
    receiptSource.textContent = "Fleet resilience evidence · accessible evidence view";
    receiptFields.engine.textContent = RESILIENCE_RECEIPT_ENGINE;
    receiptFields.signature.textContent = FLEET_AUDIT_AUTHENTICATION.label;
    receiptFields.policy.textContent = fleetEvidence.policy_profile;
    receiptFields.issuer.textContent = "creed.space/fleet";
    receiptFields.subject.textContent = displayDeviceID(selectedResilience.affected_device);
    receiptFields.sequence.textContent = String(first.policy_sequence || 0);
    receiptFields.evidence.textContent = selectedResilience.proof;
    receiptFields.evaluated.textContent = "Ready to replay";
    receiptFields.hash.textContent = "See signed Fleet evidence bundle";
    receiptFields.reason.textContent = selectedResilience.fault;
    receiptFields.adapter.textContent = selectedResilience.safe_response;
    setRuleState(resilienceRule[selectedResilience.id], false);
  }
};

const playResilienceLocally = () => {
  const generation = clearResilienceTimers();
  if (!selectedResilience) return;
  const scenarioID = selectedResilience.id;
  const origin = resilienceCursor >= 0 ? selectedResilience.events[resilienceCursor].at_ms : 0;
  let pending = 0;
  selectedResilience.events.forEach((event, index) => {
    if (index <= resilienceCursor) return;
    pending += 1;
    resilienceTimers.push(window.setTimeout(() => {
      if (generation !== resilienceGeneration || selectedResilience?.id !== scenarioID) return;
      applyResilienceEvent(event);
      if (index === selectedResilience.events.length - 1) resilienceActions.pause.disabled = true;
    }, Math.max(0, event.at_ms - origin)));
  });
  resilienceActions.pause.disabled = pending === 0;
  resilienceFields.transport.textContent = pending === 0 ? "Evidence recorded" : "Deterministic evidence replay";
};

const selectResilienceScenario = (id) => {
  if (!fleetEvidence?.resilience) return;
  const scenario = fleetEvidence.resilience.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) return;
  if (!resilienceMode) scenarioBeforeResilience = selectedScenario;
  root.querySelector("#fault-replay").open = true;
  clearResilienceTimers();
  resilienceMode = true;
  selectedResilience = scenario;
  for (const button of scenarioButtons) button.setAttribute("aria-pressed", "false");
  for (const button of resilienceScenarios.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.resilienceScenario === id));
  }
  resilienceFields.name.textContent = scenario.name;
  resilienceFields.fault.textContent = scenario.fault;
  resilienceFields.device.textContent = displayDeviceID(scenario.affected_device);
  resilienceFields.expected.textContent = scenario.expected_code;
  resilienceFields.response.textContent = scenario.safe_response;
  resilienceFields.proof.textContent = scenario.proof;
  resilienceScrubber.max = String(scenario.events[scenario.events.length - 1].at_ms);
  resetResilience();
};

const failClosed = (message) => {
  stage.dataset.receiptsReady = "false";
  stage.dataset.failClosed = "true";
  receiptSource.textContent = "Receipt fixture unavailable";
  phaseElement.textContent = "Evidence unavailable";
  statusCode.textContent = "fixture_unavailable";
  outcomeElement.textContent = "Unavailable";
  decisionCode.textContent = "fixture_unavailable";
  decisionCode.hidden = false;
  reasonElement.textContent = message;
  for (const field of Object.values(receiptFields)) field.textContent = "Unavailable";
  adapterOutput.textContent = "No command authority";
  for (const button of scenarioButtons) {
    button.disabled = true;
    button.setAttribute("aria-pressed", "false");
  }
  for (const item of root.querySelectorAll(".rule-stack li")) {
    item.classList.remove("is-failed", "is-monitoring", "is-pass");
    item.classList.add("is-unavailable");
    item.querySelector("strong").textContent = "UNAVAILABLE";
  }
};

root.querySelector("[data-render-quality]").disabled = true;
playButton.disabled = true;
fleetButton.disabled = true;
tourButton.disabled = true;
for (const control of root.querySelectorAll("[data-resilience-action], [data-resilience-scrubber]")) control.disabled = true;
for (const button of scenarioButtons) button.disabled = true;
for (const button of scenarioButtons) {
  button.addEventListener("click", () => {
    leaveResilienceMode();
    renderReceipt(button.dataset.scenario);
    syncSelectionURL();
  });
}

if (resilienceActions.run) {
  resilienceActions.run.addEventListener("click", () => {
    resetResilience();
    playResilienceLocally();
  });
}
if (resilienceActions.pause) {
  resilienceActions.pause.addEventListener("click", () => {
    clearResilienceTimers();
    resilienceFields.transport.textContent = "Paused";
  });
}
if (resilienceActions.step) {
  resilienceActions.step.addEventListener("click", () => {
    if (!selectedResilience) return;
    clearResilienceTimers();
    const next = Math.min(resilienceCursor + 1, selectedResilience.events.length - 1);
    applyResilienceEvent(selectedResilience.events[next]);
  });
}
if (resilienceActions.reset) resilienceActions.reset.addEventListener("click", resetResilience);
if (resilienceScrubber) {
  resilienceScrubber.addEventListener("input", () => {
    if (!selectedResilience) return;
    clearResilienceTimers();
    const time = Number(resilienceScrubber.value);
    const index = selectedResilience.events.findLastIndex((event) => event.at_ms <= time);
    if (index >= 0) applyResilienceEvent(selectedResilience.events[index]);
    else resetResilience();
  });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && selectedResilience && resilienceTimers.length > 0) {
    clearResilienceTimers();
    resilienceFields.transport.textContent = "Paused while this page is hidden";
  }
});

try {
  bundle = await fetchSimulatorJSON("./data/bounder-receipts.v1.json", {
    maxBytes: MAX_RECEIPT_BUNDLE_BYTES,
    label: "receipt bundle"
  });
  receiptsByScenario = validateReceiptBundle(bundle);
  renderReceipt(SIMULATOR_SCENARIOS.includes(requestedScenario) ? requestedScenario : "safe");
  for (const button of scenarioButtons) button.disabled = false;
  stage.dataset.receiptsReady = "true";
  delete stage.dataset.failClosed;
} catch (error) {
  // The raw error ("Failed to fetch", a validator path) is diagnostic, not a decision reason;
  // it goes to the console and the visitor reads the same sentence as the 3D view.
  console.error(error);
  failClosed("The recorded interlock receipt bundle could not be loaded or validated. The simulation remains paused.");
}

// Fleet evidence and deterministic fault replay are plain DOM, so this view renders both
// without WebGL. They remain independent of receipts: a Fleet failure resolves those panels
// to an explicit unavailable state and never touches the receipt controls.
const loadFleetEvidence = async () => {
  let resilienceEvidence;
  try {
    const fixture = await fetchSimulatorJSON("./data/bounder-fleet-evidence.v1.json", {
      maxBytes: MAX_FLEET_EVIDENCE_BYTES,
      label: "Fleet evidence"
    });
    resilienceEvidence = await validateFleetEvidence(fixture);
  } catch (error) {
    console.warn("Bounder resilience timelines unavailable in the accessible evidence view", error);
  }

  try {
    const { loadPilotEvidence } = await import("./staging-feed.js");
    const configuredURL = document.querySelector('meta[name="bounder-staging-feed"]')?.content ?? "";
    const configuredIntegrity = document.querySelector('meta[name="bounder-staging-feed-integrity"]')?.content ?? "";
    const pilot = await loadPilotEvidence({ configuredURL, configuredIntegrity });
    fleetEvidence = resilienceEvidence
      ? { ...pilot.evidence, resilience: resilienceEvidence.resilience }
      : pilot.evidence;
    fleetGuardianAliases = resilienceEvidence
      ? resolveFleetGuardianAliases(
        resilienceEvidence.devices.map(({ device_id: id }) => id),
        fleetEvidence.devices.map(({ device_id: id }) => id)
      )
      : new Map(fleetEvidence.devices.map((device) => [device.device_id, device.device_id]));
    renderFleetSummary(root, fleetEvidence);
    renderFleetRows(fleetNodes, fleetEvidence);
    fleetSource.textContent = `${pilot.warning ? `${pilot.sourceLabel} · ${pilot.warning}` : pilot.sourceLabel} · accessible evidence view`;
    fleetSource.dataset.source = pilot.source;
    stage.dataset.fleetGuardians = String(fleetEvidence.summary.devices);
    stage.dataset.fleetReady = "true";
  } catch (error) {
    if (resilienceEvidence) {
      fleetEvidence = resilienceEvidence;
      fleetGuardianAliases = new Map(resilienceEvidence.devices.map((device) => [device.device_id, device.device_id]));
      renderFleetSummary(root, fleetEvidence);
      renderFleetRows(fleetNodes, fleetEvidence);
      fleetSource.textContent = "Recorded Fleet laboratory · 100-device pilot unavailable · accessible evidence view";
      fleetSource.dataset.source = "fallback";
      stage.dataset.fleetGuardians = String(fleetEvidence.summary.devices);
      stage.dataset.fleetReady = "true";
    } else {
      console.warn("Bounder Fleet evidence unavailable in the accessible evidence view", error);
      showFleetUnavailable(root, "Fleet evidence unavailable · the recorded receipts remain available");
      return;
    }
  }

  if (!fleetEvidence?.resilience || !resilienceLab || !resilienceScenarios) return;
  const fragment = document.createDocumentFragment();
  for (const scenario of fleetEvidence.resilience.scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "resilience-scenario";
    button.dataset.resilienceScenario = scenario.id;
    button.setAttribute("aria-pressed", "false");
    button.textContent = scenario.name;
    button.addEventListener("click", () => {
      selectResilienceScenario(scenario.id);
      syncSelectionURL();
    });
    fragment.append(button);
  }
  resilienceScenarios.replaceChildren(fragment);
  resilienceLab.hidden = false;
  for (const control of [resilienceActions.run, resilienceActions.step, resilienceActions.reset, resilienceScrubber]) {
    if (control) control.disabled = false;
  }
  if (resilienceActions.pause) resilienceActions.pause.disabled = true;

  const faultDisclosure = root.querySelector("#fault-replay");
  faultDisclosure?.addEventListener("toggle", (event) => {
    if (!fleetEvidence?.resilience) return;
    if (event.target.open && !resilienceMode) {
      selectResilienceScenario(selectedResilience?.id ?? fleetEvidence.resilience.scenarios[0].id);
    } else if (!event.target.open && resilienceMode) {
      leaveResilienceMode();
      if (receiptsByScenario.size > 0) renderReceipt(scenarioBeforeResilience ?? "safe");
      syncSelectionURL();
    }
  });

  if (requestedResilience && fleetEvidence.resilience.scenarios.some(({ id }) => id === requestedResilience)) {
    selectResilienceScenario(requestedResilience);
  } else if (faultDisclosure?.open) {
    selectResilienceScenario(fleetEvidence.resilience.scenarios[0].id);
  }
};
loadFleetEvidence();
