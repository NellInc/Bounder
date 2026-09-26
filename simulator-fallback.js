import {
  MAX_RECEIPT_BUNDLE_BYTES,
  SIMULATOR_SCENARIOS,
  fetchSimulatorJSON,
  validateReceiptBundle
} from "./simulator-contracts.js";
import { renderFleetRows, renderFleetSummary, showFleetUnavailable } from "./ui/fleet-view.js";
import { asSentence } from "./ui/text.js";

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
const scenarioButtons = [...root.querySelectorAll("[data-scenario]")];
const playButton = root.querySelector("[data-action='play']");
const fleetButton = root.querySelector("[data-action='fleet']");
const tourButton = root.querySelector("[data-action='tour']");
const requestedScenario = new URLSearchParams(window.location.search).get("scenario");
let bundle;
let receiptsByScenario = new Map();

const setRuleState = (failedRule) => {
  for (const item of root.querySelectorAll(".rule-stack li")) {
    const failed = failedRule !== "all" && item.dataset.rule === failedRule;
    item.classList.toggle("is-failed", failed);
    item.querySelector("strong").textContent = failed ? "HOLD" : "PASS";
  }
};

const renderReceipt = (scenario) => {
  const receipt = receiptsByScenario.get(scenario);
  if (!receipt) return;
  for (const button of scenarioButtons) button.setAttribute("aria-pressed", String(button.dataset.scenario === scenario));
  receiptSource.textContent = "Recorded Go interlock receipt · accessible evidence view";
  phaseElement.textContent = receipt.allowed ? "Bounder permits" : "Bounder holds";
  statusCode.textContent = receipt.code;
  outcomeElement.textContent = receipt.allowed ? "Request allowed" : "Request denied";
  outcomeElement.dataset.outcome = receipt.allowed ? "allowed" : "held";
  decisionCode.textContent = receipt.code;
  reasonElement.textContent = asSentence(receipt.reason);
  adapterOutput.textContent = receipt.adapter.output;
  receiptFields.engine.textContent = bundle.engine;
  receiptFields.signature.textContent = receipt.signature_verified ? "Recorded as verified by Go engine" : "Recorded verification failed";
  receiptFields.policy.textContent = receipt.policy_id;
  receiptFields.issuer.textContent = receipt.issuer;
  receiptFields.subject.textContent = receipt.subject;
  receiptFields.sequence.textContent = String(receipt.sequence);
  receiptFields.evidence.textContent = `${receipt.evidence.tier} · ${receipt.evidence.auditor} · ${receipt.evidence.age_seconds}s old`;
  receiptFields.evaluated.textContent = receipt.evaluated_at;
  receiptFields.hash.textContent = receipt.policy_hash;
  setRuleState(receipt.allowed ? "all" : receipt.rule);
  const group = root.querySelector(`[data-scenario="${scenario}"]`)?.closest("details");
  if (group) group.open = true;
};

const failClosed = (message) => {
  stage.dataset.receiptsReady = "false";
  stage.dataset.failClosed = "true";
  receiptSource.textContent = "Receipt fixture unavailable";
  phaseElement.textContent = "Evidence unavailable";
  statusCode.textContent = "fixture_unavailable";
  outcomeElement.textContent = "Unavailable";
  decisionCode.textContent = "fixture_unavailable";
  reasonElement.textContent = message;
  adapterOutput.textContent = "No command authority";
  for (const button of scenarioButtons) {
    button.disabled = true;
    button.setAttribute("aria-pressed", "false");
  }
  for (const item of root.querySelectorAll(".rule-stack li")) {
    item.classList.remove("is-failed", "is-monitoring");
    item.querySelector("strong").textContent = "UNAVAILABLE";
  }
};

root.querySelector("[data-render-quality]").disabled = true;
playButton.disabled = true;
fleetButton.disabled = true;
tourButton.disabled = true;
for (const control of root.querySelectorAll("[data-resilience-action], [data-resilience-scrubber]")) control.disabled = true;
for (const button of scenarioButtons) button.disabled = true;
for (const button of scenarioButtons) button.addEventListener("click", () => renderReceipt(button.dataset.scenario));

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
  failClosed(error instanceof Error ? error.message : "The recorded receipt bundle could not be loaded.");
}

// Fleet evidence is plain DOM, so this view renders the recorded 100-Guardian pilot too.
// It is independent of the receipts above: a Fleet failure resolves the panel to an
// explicit unavailable state and never touches the receipt controls. The 3D Fleet view
// and the fault replay need the renderer and stay disabled here. It is not awaited, so the
// module (and the bootstrap's embedded-height reporting after it) settles on the receipts.
const fleetSource = root.querySelector("[data-fleet-source]");
const loadFleetEvidence = async () => {
  try {
    const { loadPilotEvidence } = await import("./staging-feed.js");
    const configuredURL = document.querySelector('meta[name="bounder-staging-feed"]')?.content ?? "";
    const configuredIntegrity = document.querySelector('meta[name="bounder-staging-feed-integrity"]')?.content ?? "";
    const pilot = await loadPilotEvidence({ configuredURL, configuredIntegrity });
    renderFleetSummary(root, pilot.evidence);
    renderFleetRows(root.querySelector("[data-fleet-nodes]"), pilot.evidence);
    fleetSource.textContent = `${pilot.warning ? `${pilot.sourceLabel} · ${pilot.warning}` : pilot.sourceLabel} · accessible evidence view`;
    fleetSource.dataset.source = pilot.source;
    stage.dataset.fleetGuardians = String(pilot.evidence.summary.devices);
    stage.dataset.fleetReady = "true";
  } catch (error) {
    console.warn("Bounder Fleet evidence unavailable in the accessible evidence view", error);
    showFleetUnavailable(root, "Fleet evidence unavailable · the recorded receipts remain available");
  }
};
loadFleetEvidence();
