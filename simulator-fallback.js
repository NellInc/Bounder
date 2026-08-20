import {
  MAX_RECEIPT_BUNDLE_BYTES,
  SIMULATOR_SCENARIOS,
  fetchSimulatorJSON,
  validateReceiptBundle
} from "./simulator-contracts.js";

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
  outcomeElement.textContent = receipt.allowed ? "Permitted" : "Held";
  decisionCode.textContent = receipt.code;
  reasonElement.textContent = receipt.reason;
  adapterOutput.textContent = receipt.adapter.output;
  receiptFields.engine.textContent = bundle.engine;
  receiptFields.signature.textContent = receipt.signature_verified ? "Recorded as verified by Go engine" : "Recorded verification failed";
  receiptFields.policy.textContent = receipt.policy_id;
  receiptFields.issuer.textContent = receipt.issuer;
  receiptFields.subject.textContent = receipt.subject;
  receiptFields.sequence.textContent = String(receipt.sequence);
  receiptFields.evidence.textContent = `${receipt.evidence.age_seconds}s old · ${receipt.evidence.tier} evidence`;
  receiptFields.evaluated.textContent = receipt.evaluated_at;
  receiptFields.hash.textContent = receipt.policy_hash;
  setRuleState(receipt.allowed ? "all" : receipt.rule);
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
