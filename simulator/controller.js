import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { WORLD_BOUNDS } from "../simulator-world.js";
import { createTownScene } from "./scene.js";
import { renderFleetRows } from "../ui/fleet-view.js";
import { loadPilotEvidence } from "../staging-feed.js";
import { SIMULATOR_SCENARIOS, validateReceiptBundle } from "../runtime/receipts/contracts.js";
import {
  FLEET_AUDIT_AUTHENTICATION,
  resolveFleetGuardianAliases,
  validateFleetEvidence
} from "../runtime/fleet/contracts.js";
import {
  MAX_RESILIENCE_EVENT_CHARACTERS,
  RESILIENCE_CONTRACTS,
  createResilienceStreamSequence,
  resolveAffectedGuardianIDs,
  resolveResilienceStreamURL
} from "../runtime/resilience/contracts.js";
import {
  MAX_FLEET_EVIDENCE_BYTES,
  MAX_RECEIPT_BUNDLE_BYTES,
  fetchSimulatorJSON,
  parseSimulatorJSON
} from "../runtime/transport/simulator-json.js";

const root = document.querySelector(".simulator-workbench");
const stage = root.querySelector(".simulator-stage");
const canvas = stage.querySelector("canvas");
const phaseElement = root.querySelector(".status-phase");
const statusCode = root.querySelector(".status-code");
const outcomeElement = root.querySelector(".decision-outcome");
const decisionCode = root.querySelector(".decision-code");
const reasonElement = root.querySelector(".decision-reason");
const adapterOutput = root.querySelector(".adapter-output");
const receiptSource = root.querySelector(".receipt-source");
const receiptFields = Object.fromEntries([...root.querySelectorAll("[data-receipt]")].map((element) => [element.dataset.receipt, element]));
const fleetFields = Object.fromEntries([...root.querySelectorAll("[data-fleet]")].map((element) => [element.dataset.fleet, element]));
const fleetNodes = root.querySelector("[data-fleet-nodes]");
const fleetSource = root.querySelector("[data-fleet-source]");
const playButton = root.querySelector("[data-action='play']");
const fleetButton = root.querySelector("[data-action='fleet']");
const tourButton = root.querySelector("[data-action='tour']");
const operatorTour = root.querySelector("[data-operator-tour]");
const receiptSummary = root.querySelector(".receipt-details summary");
const tourFields = Object.fromEntries([...root.querySelectorAll("[data-tour]")].map((element) => [element.dataset.tour, element]));
const tourActions = Object.fromEntries([...root.querySelectorAll("[data-tour-action]")].map((element) => [element.dataset.tourAction, element]));
const resilienceLab = root.querySelector(".resilience-lab");
const resilienceScenarios = root.querySelector("[data-resilience-scenarios]");
const resilienceEvents = root.querySelector("[data-resilience-events]");
const resilienceFields = Object.fromEntries([...root.querySelectorAll("[data-resilience]")].map((element) => [element.dataset.resilience, element]));
const resilienceScrubber = root.querySelector("[data-resilience-scrubber]");
const resilienceActions = Object.fromEntries([...root.querySelectorAll("[data-resilience-action]")].map((element) => [element.dataset.resilienceAction, element]));
const continuityProof = root.querySelector("[data-continuity-proof]");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const initialParameters = new URLSearchParams(window.location.search);

const RESILIENCE_RECEIPT_ENGINE = "Creed Space Fleet + Bounder Guardian";

const css = getComputedStyle(document.documentElement);
const cssColour = (name) => css.getPropertyValue(name).trim();
const colours = {
  ink: cssColour("--ink"),
  paper: cssColour("--paper"),
  signal: cssColour("--signal"),
  safety: cssColour("--safety"),
  route: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--route").trim(),
  friendly: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--friendly").trim(),
  civilian: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--civilian").trim(),
  protected: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--protected").trim(),
  humanitarian: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--humanitarian").trim()
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  stage.classList.add("is-ready");
} catch (error) {
  console.warn("Bounder simulator could not initialize WebGL", error);
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.setClearColor(new THREE.Color("#b9d7df"), 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#b9d7df");
scene.fog = new THREE.Fog(new THREE.Color("#b9d7df"), 28, 62);
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
camera.position.set(17, 16, 21);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, .8, 0);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 11;
controls.maxDistance = 34;
controls.maxPolarAngle = Math.PI * 0.48;
// OrbitControls sets touch-action:none in its constructor, which traps page scrolling on touch
// devices because the canvas spans the full width of the embedded stage. Give vertical panning
// back to the browser: a one-finger vertical swipe scrolls the page (OrbitControls ends the
// gesture through its own pointercancel handler), horizontal drag still orbits, and two fingers
// still dolly and tilt.
canvas.style.touchAction = "pan-y";
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

const navigationCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const pressedNavigationKeys = new Set();
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraMovement = new THREE.Vector3();
const syncNavigationState = () => {
  stage.dataset.navigationActive = String(pressedNavigationKeys.size > 0);
};
syncNavigationState();

const focusWithoutScroll = (element) => {
  try {
    element.focus({ preventScroll: true });
  } catch (error) {
    console.warn("Bounder could not move keyboard focus", error);
  }
};

const handleCanvasPointerDown = () => focusWithoutScroll(canvas);
const handleCanvasKeyDown = (event) => {
  if (!navigationCodes.has(event.code)) return;
  event.preventDefault();
  pressedNavigationKeys.add(event.code);
  stage.dataset.lastNavigationKey = event.code;
  syncNavigationState();
  scheduleAnimation();
};
const handleCanvasKeyUp = (event) => {
  if (!navigationCodes.has(event.code)) return;
  event.preventDefault();
  pressedNavigationKeys.delete(event.code);
  syncNavigationState();
};
const handleCanvasBlur = () => {
  pressedNavigationKeys.clear();
  syncNavigationState();
};

canvas.addEventListener("pointerdown", handleCanvasPointerDown);
canvas.addEventListener("keydown", handleCanvasKeyDown);
canvas.addEventListener("keyup", handleCanvasKeyUp);
canvas.addEventListener("blur", handleCanvasBlur);

const releaseCanvasInput = () => {
  canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
  canvas.removeEventListener("keydown", handleCanvasKeyDown);
  canvas.removeEventListener("keyup", handleCanvasKeyUp);
  canvas.removeEventListener("blur", handleCanvasBlur);
};

const updateCameraNavigation = (delta) => {
  if (pressedNavigationKeys.size === 0) return;

  camera.getWorldDirection(cameraForward);
  cameraForward.y = 0;
  if (cameraForward.lengthSq() < 0.0001) cameraForward.set(0, 0, -1);
  cameraForward.normalize();
  cameraRight.crossVectors(cameraForward, camera.up).normalize();
  cameraMovement.set(0, 0, 0);

  if (pressedNavigationKeys.has("KeyW")) cameraMovement.add(cameraForward);
  if (pressedNavigationKeys.has("KeyS")) cameraMovement.sub(cameraForward);
  if (pressedNavigationKeys.has("KeyD")) cameraMovement.add(cameraRight);
  if (pressedNavigationKeys.has("KeyA")) cameraMovement.sub(cameraRight);
  if (pressedNavigationKeys.has("KeyE")) cameraMovement.y += 1;
  if (pressedNavigationKeys.has("KeyQ")) cameraMovement.y -= 1;
  if (cameraMovement.lengthSq() === 0) return;

  cameraMovement.normalize().multiplyScalar(delta * 6.5);
  const previousTarget = controls.target.clone();
  controls.target.add(cameraMovement);
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -WORLD_BOUNDS.width / 2, WORLD_BOUNDS.width / 2);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0.6, 10);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -WORLD_BOUNDS.depth / 2, WORLD_BOUNDS.depth / 2);
  camera.position.add(controls.target.clone().sub(previousTarget));
  stage.dataset.cameraPosition = camera.position.toArray().map((value) => value.toFixed(2)).join(",");
};

const { sun, civilianBoundary, friendlyBoundary, protectedBoundary, humanitarianBoundary, roeMarkers, altitudeCeiling, weatherGroup, ambientClouds, curves, drone, bounderEnvelope, fleetDrones, rotors, showRoute } = createTownScene({ scene, colours, stage });

const scenarioPresentation = Object.freeze({
  safe: { stop: 1, initial: "All reviewed constraints currently pass." },
  civilian: { stop: 0.94, initial: "The route is approaching an active civilian-protection buffer." },
  friendly: { stop: 0.94, initial: "Authenticated friendly presence is inside the planned route corridor." },
  protected: { stop: 0.94, initial: "The route is approaching a declared protected-site boundary." },
  humanitarian: { stop: 0.94, initial: "The route is approaching an active humanitarian movement corridor." },
  surrender: { stop: 0.94, initial: "A surrender indication is being checked before the evidence-only intercept decision." },
  incapacitated: { stop: 0.94, initial: "An incapacitated-person indication is being checked before the evidence-only intercept decision." },
  identification: { stop: 0.94, initial: "Positive identification has not yet been confirmed." },
  proportionality: { stop: 0.94, initial: "The signed proportionality condition has not yet been satisfied." },
  human_authorization: { stop: 0.94, initial: "Current human authorization has not yet been confirmed." },
  altitude: { stop: 0.57, initial: "Local altitude is being compared with the signed flight ceiling." },
  weather: { stop: 0.48, initial: "Visibility and wind observations are approaching the permitted envelope." },
  window: { stop: 0.22, initial: "The requested state change is being checked against its authorized time window." },
  link: { stop: 0.3, initial: "Bounder is monitoring heartbeat and telemetry freshness." },
  replay: { stop: 0, initial: "The supplied policy sequence was already accepted." }
});

const operatorTourSteps = Object.freeze([
  {
    id: "signed-baseline",
    scenario: "safe",
    fleet: false,
    title: "Inspect the recorded baseline",
    summary: "A narrow recovery request is permitted only after Bounder verifies its issuer, exact device subject, sequence, validity window, evidence, and local operating state.",
    proof: "Open the decision receipt and inspect the issuer, subject, sequence, evidence age, and policy hash."
  },
  {
    id: "fleet-projection",
    scenario: "safe",
    fleet: true,
    title: "Project one rule across the fleet",
    summary: "Creed Space signs a separate subject-bound envelope for every enrolled Guardian. Each Bounder instance verifies and enforces locally.",
    proof: "The Fleet panel reports one hundred distinct software Guardians across six platform classes and preserves each local decision receipt."
  },
  {
    id: "civilian-protection",
    scenario: "civilian",
    fleet: true,
    title: "Protect civilians at the final boundary",
    summary: "A route that enters the signed civilian buffer becomes a hold at the vehicle, even if every upstream service remains available.",
    proof: "The failed rule is civilian protection, the adapter sends no command, and the receipt records civilian_proximity."
  },
  {
    id: "friendly-separation",
    scenario: "friendly",
    fleet: true,
    title: "Prevent blue-on-blue action",
    summary: "Authenticated friendly presence inside the signed separation distance stops the requested state change locally.",
    proof: "The friendly-force rule changes to HOLD and the adapter retains its safe state."
  },
  {
    id: "evidence-only-roe",
    scenario: "surrender",
    fleet: true,
    title: "Keep high-consequence evidence non-authoritative",
    summary: "Surrender, incapacitation, identification, proportionality, and human authorization are modelled as evidence-only holds. They cannot become actuator authority.",
    proof: "The intercept receipt is denied with command_authorized false and command_sent false."
  },
  {
    id: "rollback-proof",
    resilience: "coherent-snapshot-rollback",
    fleet: true,
    title: "Reject a coherent older snapshot",
    summary: "Fleet's signed receipt floor exposes a locally valid but older Guardian state. Authority remains frozen through reconciliation.",
    proof: "Use Step in the resilience timeline. The local floor trails Fleet, the hold persists, and recovery requires a newer policy plus fresh checkpoint."
  }
]);

const expectedScenarioIDs = SIMULATOR_SCENARIOS;
let receiptBundle;
let receiptsByScenario = new Map();
let fleetEvidence;
let fleetGuardianAliases = new Map();
let fleetMode = false;

const loadReceiptBundle = async () => {
  const bundle = await fetchSimulatorJSON("./data/bounder-receipts.v1.json", {
    maxBytes: MAX_RECEIPT_BUNDLE_BYTES,
    label: "receipt bundle"
  });
  const receipts = validateReceiptBundle(bundle);
  receiptBundle = bundle;
  receiptsByScenario = receipts;
  stage.dataset.receiptBundleVersion = bundle.version;
  stage.dataset.receiptEngine = bundle.engine;
  stage.dataset.receiptCount = String(receipts.size);
  stage.dataset.receiptsReady = "true";
  if (rendererOperational) delete stage.dataset.failClosed;
};


const renderFleetEvidence = (evidence) => {
  fleetFields.name.textContent = evidence.fleet_id;
  fleetFields.devices.textContent = `${evidence.summary.devices} recorded`;
  fleetFields.policy.textContent = evidence.policy_profile;
  fleetFields.policy.title = evidence.policy_profile;
  fleetFields.evidence.textContent = `${evidence.summary.allowed} allow · ${evidence.summary.blocked} hold`;
  renderFleetRows(fleetNodes, evidence);
  stage.dataset.fleetEvidenceVersion = evidence.version;
  stage.dataset.fleetGuardians = String(evidence.summary.devices);
  stage.dataset.fleetReady = "true";
};

const resilienceRoute = Object.freeze(Object.fromEntries(Object.entries(RESILIENCE_CONTRACTS).map(([id, contract]) => [id, contract.route])));
const resilienceRule = Object.freeze(Object.fromEntries(Object.entries(RESILIENCE_CONTRACTS).map(([id, contract]) => [id, contract.rule])));

const continuityFrames = Object.freeze({
  "coherent-snapshot-rollback": [
    { status: "Floors agree", local: "Current durable receipt floor", fleet: "Matching signed receipt floor", lease: "05:00 signed", authority: "ACTIVE", held: false },
    { status: "Rollback exposed", local: "Coherent older snapshot", fleet: "Newer signed receipt floor", lease: "Revoked", authority: "FROZEN", held: true },
    { status: "Durable hold", local: "Rollback marker persisted", fleet: "Recorded signed proof", lease: "None", authority: "HOLD", held: true },
    { status: "Reconciliation required", local: "Awaiting floor adoption", fleet: "Hold receipt recorded", lease: "New policy required", authority: "HOLD", held: true }
  ],
  "continuity-lease-expiry": [
    { status: "Lease current", local: "Durable floors coherent", fleet: "Matching signed floors", lease: "05:00 signed", authority: "ACTIVE", held: false },
    { status: "Lease elapsed", local: "Durable floors coherent", fleet: "Last signed floor retained", lease: "00:00 expired", authority: "FROZEN", held: true },
    { status: "Offline authority ended", local: "Expiry hold persisted", fleet: "Reconnection pending", lease: "Expired", authority: "HOLD", held: true },
    { status: "Fresh checkpoint required", local: "No authority restored", fleet: "Hold receipt recorded", lease: "Renewal required", authority: "HOLD", held: true }
  ]
});
let selectedResilience;
let resilienceCursor = -1;
let resilienceTimers = [];
let resilienceSource;
let resilienceStreamTimeout;
let resilienceTransportGeneration = 0;
let resilienceMode = false;

const clearResilienceTransport = () => {
  resilienceTransportGeneration += 1;
  for (const timer of resilienceTimers) window.clearTimeout(timer);
  resilienceTimers = [];
  if (resilienceStreamTimeout) window.clearTimeout(resilienceStreamTimeout);
  resilienceStreamTimeout = undefined;
  const source = resilienceSource;
  resilienceSource = undefined;
  if (source) source.close();
  resilienceActions.pause.disabled = true;
  return resilienceTransportGeneration;
};

const renderResilienceTimeline = () => {
  if (!selectedResilience) return;
  const fragment = document.createDocumentFragment();
  selectedResilience.events.forEach((event, index) => {
    const item = document.createElement("li");
    item.className = "resilience-event";
    item.classList.toggle("is-reached", index <= resilienceCursor);
    item.classList.toggle("is-current", index === resilienceCursor);
    item.classList.toggle("is-fault", event.status === "fault");
    item.classList.toggle("is-held", event.status === "held");
    const time = document.createElement("time");
    time.textContent = `${(event.at_ms / 1000).toFixed(2)} s`;
    const label = document.createElement("b");
    label.textContent = event.kind;
    const code = document.createElement("code");
    code.textContent = event.code;
    item.title = event.message;
    item.append(time, label, code);
    fragment.append(item);
  });
  resilienceEvents.replaceChildren(fragment);
};

const renderContinuityProof = (cursor = resilienceCursor) => {
  const frames = selectedResilience && continuityFrames[selectedResilience.id];
  continuityProof.hidden = !frames;
  if (!frames) return;
  const frame = frames[Math.max(0, Math.min(cursor, frames.length - 1))];
  continuityProof.classList.toggle("is-held", frame.held);
  continuityProof.dataset.checkpointState = frame.held ? "held" : "verified";
  resilienceFields["checkpoint-status"].textContent = frame.status;
  resilienceFields["local-floor"].textContent = frame.local;
  resilienceFields["fleet-floor"].textContent = frame.fleet;
  resilienceFields.lease.textContent = frame.lease;
  resilienceFields.authority.textContent = frame.authority;
};

const markAffectedGuardians = (device) => {
  const nodes = [...fleetNodes.querySelectorAll(".fleet-node")];
  const guardianIDs = nodes.map((node) => node.dataset.deviceId);
  const affected = device ? new Set(resolveAffectedGuardianIDs(device, guardianIDs, fleetGuardianAliases)) : new Set();
  for (const node of nodes) {
    const isAffected = affected.has(node.dataset.deviceId);
    node.classList.toggle("is-affected", isAffected);
    node.setAttribute("aria-label", `${node.dataset.baseLabel}${isAffected ? "; affected by selected fault" : ""}`);
  }
};

const applyResilienceEvent = (event) => {
  if (!selectedResilience) return;
  const index = selectedResilience.events.findIndex((candidate) => candidate.at_ms === event.at_ms && candidate.code === event.code);
  if (index < 0) return;
  resilienceCursor = index;
  resilienceScrubber.value = String(event.at_ms);
  resilienceFields.time.textContent = `${(event.at_ms / 1000).toFixed(2)} s`;
  resilienceFields.transport.textContent = event.kind === "audit" ? "Evidence recorded" : event.message;
  renderResilienceTimeline();
  renderContinuityProof(index);
  markAffectedGuardians(event.device_id || selectedResilience.affected_device);
  receiptSource.textContent = "Fleet resilience evidence";
  receiptFields.engine.textContent = RESILIENCE_RECEIPT_ENGINE;
  receiptFields.signature.textContent = FLEET_AUDIT_AUTHENTICATION.label;
  receiptFields.policy.textContent = fleetEvidence.policy_profile;
  receiptFields.issuer.textContent = "creed.space/fleet";
  receiptFields.subject.textContent = event.device_id || selectedResilience.affected_device;
  receiptFields.sequence.textContent = String(event.policy_sequence || 0);
  receiptFields.evidence.textContent = selectedResilience.proof;
  receiptFields.evaluated.textContent = `t + ${(event.at_ms / 1000).toFixed(2)} seconds`;
  receiptFields.hash.textContent = "See signed Fleet evidence bundle";
  if (event.kind === "baseline") {
    phaseElement.textContent = "Policy active";
    outcomeElement.textContent = "Monitoring";
    delete outcomeElement.dataset.outcome;
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
    bounderEnvelope.material.color.set(colours.safety);
  } else {
    phaseElement.textContent = "Receipt recorded";
    outcomeElement.textContent = "Audited";
    adapterOutput.textContent = "Safe state retained";
  }
  statusCode.textContent = event.code;
  decisionCode.textContent = event.code;
  reasonElement.textContent = event.message;
};

const resetResilience = () => {
  clearResilienceTransport();
  delete stage.dataset.resilienceFallback;
  resilienceCursor = -1;
  resilienceScrubber.value = "0";
  resilienceFields.time.textContent = "0.00 s";
  resilienceFields.transport.textContent = "Ready";
  markAffectedGuardians("");
  renderResilienceTimeline();
  renderContinuityProof(-1);
  if (selectedResilience) {
    const first = selectedResilience.events[0];
    drone.position.copy(curves[resilienceRoute[selectedResilience.id]].getPointAt(0));
    bounderEnvelope.material.color.set(colours.signal);
    statusCode.textContent = first.code;
    decisionCode.textContent = "ready";
    phaseElement.textContent = "Fault laboratory ready";
    outcomeElement.textContent = "Ready";
    reasonElement.textContent = selectedResilience.fault;
    adapterOutput.textContent = "No state change yet";
    receiptSource.textContent = "Fleet resilience evidence";
    receiptFields.engine.textContent = RESILIENCE_RECEIPT_ENGINE;
    receiptFields.signature.textContent = FLEET_AUDIT_AUTHENTICATION.label;
    receiptFields.policy.textContent = fleetEvidence.policy_profile;
    receiptFields.issuer.textContent = "creed.space/fleet";
    receiptFields.subject.textContent = selectedResilience.affected_device;
    receiptFields.sequence.textContent = String(first.policy_sequence || 0);
    receiptFields.evidence.textContent = selectedResilience.proof;
    receiptFields.evaluated.textContent = "Ready to stream";
    receiptFields.hash.textContent = "See signed Fleet evidence bundle";
    setRuleState(resilienceRule[selectedResilience.id], false);
  }
};

const playResilienceLocally = () => {
  const generation = clearResilienceTransport();
  if (!selectedResilience) return;
  const scenarioID = selectedResilience.id;
  const origin = resilienceCursor >= 0 ? selectedResilience.events[resilienceCursor].at_ms : 0;
  let pending = 0;
  selectedResilience.events.forEach((event, index) => {
    if (index <= resilienceCursor) return;
    pending += 1;
    resilienceTimers.push(window.setTimeout(() => {
      if (generation !== resilienceTransportGeneration || selectedResilience?.id !== scenarioID) return;
      applyResilienceEvent(event);
      if (index === selectedResilience.events.length - 1) resilienceActions.pause.disabled = true;
    }, Math.max(0, event.at_ms - origin)));
  });
  resilienceActions.pause.disabled = pending === 0;
  resilienceFields.transport.textContent = pending === 0 ? "Evidence recorded" : "Deterministic evidence replay";
};

// Every path that attempted a live stream and abandoned it marks the fallback, so an operator can
// tell "no live stream was configured" apart from "the configured stream could not be opened".
// Deliberately unguarded: the synchronous callers run before a stream generation exists.
const useRecordedEvidence = (reason) => {
  console.warn("Bounder resilience stream unavailable; continuing with recorded evidence", reason);
  stage.dataset.resilienceFallback = "true";
  playResilienceLocally();
};

const runResilience = () => {
  if (!selectedResilience) return;
  resetResilience();
  const scenario = selectedResilience;
  const configuredEndpoint = document.querySelector('meta[name="bounder-resilience-stream"]')?.content ?? "";
  let endpoint;
  try {
    endpoint = resolveResilienceStreamURL(configuredEndpoint, window.location.href, scenario.id);
  } catch (error) {
    useRecordedEvidence(error);
    return;
  }
  if (!endpoint) {
    // No live stream was configured: recorded evidence is the primary source, not a fallback.
    playResilienceLocally();
    return;
  }
  if (!("EventSource" in window)) {
    useRecordedEvidence(new Error("EventSource is unavailable in this browser"));
    return;
  }

  const generation = resilienceTransportGeneration;
  const sequence = createResilienceStreamSequence(scenario);
  let source;
  const isCurrent = () => generation === resilienceTransportGeneration && selectedResilience?.id === scenario.id && resilienceSource === source;
  const fallBack = (error) => {
    if (!isCurrent()) return;
    console.warn("Bounder resilience stream was rejected; continuing with recorded evidence", error);
    stage.dataset.resilienceFallback = "true";
    playResilienceLocally();
  };
  const armTimeout = () => {
    if (resilienceStreamTimeout) window.clearTimeout(resilienceStreamTimeout);
    resilienceStreamTimeout = window.setTimeout(() => fallBack(new Error("resilience stream timed out")), 2500);
  };
  try {
    source = new EventSource(endpoint);
  } catch (error) {
    useRecordedEvidence(error);
    return;
  }
  resilienceSource = source;
  resilienceActions.pause.disabled = false;
  resilienceFields.transport.textContent = "Connecting to local Fleet stream";
  armTimeout();
  source.addEventListener("resilience", ({ data }) => {
    if (!isCurrent()) return;
    try {
      if (typeof data !== "string" || data.length > MAX_RESILIENCE_EVENT_CHARACTERS) {
        throw new Error("resilience stream event is malformed or oversized");
      }
      const { event, complete } = sequence.push(parseSimulatorJSON(data, "resilience stream event", {
        maxBytes: MAX_RESILIENCE_EVENT_CHARACTERS
      }));
      applyResilienceEvent(event);
      if (complete) {
        sequence.finish();
        clearResilienceTransport();
        resilienceFields.transport.textContent = "Evidence recorded";
      } else {
        armTimeout();
      }
    } catch (error) {
      fallBack(error);
    }
  });
  source.addEventListener("complete", () => {
    if (!isCurrent()) return;
    try {
      sequence.finish();
      clearResilienceTransport();
      resilienceFields.transport.textContent = "Evidence recorded";
    } catch (error) {
      fallBack(error);
    }
  });
  source.onerror = () => fallBack(new Error("resilience stream failed"));
};

const selectResilienceScenario = (id) => {
  const scenario = fleetEvidence.resilience.scenarios.find((candidate) => candidate.id === id);
  root.querySelector("#fault-replay").open = true;
  if (!scenario) return;
  clearResilienceTransport();
  resilienceMode = false;
  selectScenario(resilienceRoute[id]);
  resilienceMode = true;
  setPlaying(false);
  playButton.disabled = true;
  for (const button of root.querySelectorAll("[data-scenario]")) {
    button.setAttribute("aria-pressed", "false");
  }
  selectedResilience = scenario;
  for (const button of resilienceScenarios.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.resilienceScenario === id));
  }
  resilienceFields.name.textContent = scenario.name;
  resilienceFields.fault.textContent = scenario.fault;
  resilienceFields.device.textContent = scenario.affected_device;
  resilienceFields.expected.textContent = scenario.expected_code;
  resilienceFields.response.textContent = scenario.safe_response;
  resilienceFields.proof.textContent = scenario.proof;
  resilienceScrubber.max = String(scenario.events[scenario.events.length - 1].at_ms);
  resetResilience();
};

const renderResilienceEvidence = (evidence) => {
  const fragment = document.createDocumentFragment();
  for (const scenario of evidence.resilience.scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "resilience-scenario";
    button.dataset.resilienceScenario = scenario.id;
    button.setAttribute("aria-pressed", "false");
    button.disabled = true;
    button.textContent = scenario.name;
    button.addEventListener("click", () => selectResilienceScenario(scenario.id));
    fragment.append(button);
  }
  resilienceScenarios.replaceChildren(fragment);
  resilienceLab.hidden = false;
};

const loadFleetEvidence = async () => {
  const fixture = await fetchSimulatorJSON("./data/bounder-fleet-evidence.v1.json", {
    maxBytes: MAX_FLEET_EVIDENCE_BYTES,
    label: "Fleet evidence"
  });
  const resilienceEvidence = await validateFleetEvidence(fixture);

  try {
    const configuredURL = document.querySelector('meta[name="bounder-staging-feed"]')?.content ?? "";
    const configuredIntegrity = document.querySelector('meta[name="bounder-staging-feed-integrity"]')?.content ?? "";
    const pilot = await loadPilotEvidence({ configuredURL, configuredIntegrity });
    // The staging pilot is the current fleet snapshot; the separately
    // published laboratory fixture owns the deterministic resilience
    // timelines. Compose both before bootstrap so a valid pilot without a
    // `resilience` member cannot accidentally fail the independent receipt
    // bundle closed.
    fleetEvidence = {
      ...pilot.evidence,
      resilience: resilienceEvidence.resilience
    };
    fleetGuardianAliases = resolveFleetGuardianAliases(
      resilienceEvidence.devices.map(({ device_id: id }) => id),
      fleetEvidence.devices.map(({ device_id: id }) => id)
    );
    fleetSource.textContent = pilot.warning ? `${pilot.sourceLabel} · ${pilot.warning}` : pilot.sourceLabel;
    fleetSource.dataset.source = pilot.source;
  } catch (error) {
    fleetEvidence = resilienceEvidence;
    fleetGuardianAliases = new Map(resilienceEvidence.devices.map((device) => [device.device_id, device.device_id]));
    fleetSource.textContent = "Recorded Fleet laboratory · 100-device pilot unavailable";
    fleetSource.dataset.source = "fallback";
    console.warn("Bounder staging pilot evidence unavailable", error);
  }
  renderFleetEvidence(fleetEvidence);
  renderResilienceEvidence(fleetEvidence);
};

let selectedScenario = "safe";
let progress = 0;
let playing = false;
let lastTime = 0;
let deniedTime = 0;
let currentReceipt;
let animationFrame;
let reduceMotionTimer;
let rendererOperational = true;
let stageVisible = true;
let bootstrapSettled = false;

const setPlaying = (enabled) => {
  playing = Boolean(enabled) && rendererOperational && !document.hidden;
  playButton.textContent = playing ? "Pause simulation" : "Play simulation";
  playButton.setAttribute("aria-pressed", String(playing));
  stage.dataset.playing = String(playing);
};

setPlaying(false);

const setRuleState = (failedRule, triggered) => {
  for (const item of root.querySelectorAll(".rule-stack li")) {
    const isTarget = item.dataset.rule === failedRule;
    item.classList.toggle("is-failed", isTarget && triggered);
    item.classList.toggle("is-monitoring", isTarget && !triggered);
    item.querySelector("strong").textContent = isTarget ? (triggered ? "HOLD" : "CHECK") : "PASS";
  }
};

const renderReceiptMetadata = (receipt) => {
  receiptSource.textContent = receipt.decision_source === receiptBundle.engine ? "Go interlock receipt" : "Adapter receipt after Go verification";
  receiptFields.engine.textContent = receipt.decision_source;
  receiptFields.signature.textContent = receipt.signature_verified ? "Recorded as verified by Go engine" : "Recorded verification failed";
  receiptFields.policy.textContent = receipt.policy_id;
  receiptFields.issuer.textContent = receipt.issuer;
  receiptFields.subject.textContent = receipt.subject;
  receiptFields.sequence.textContent = String(receipt.sequence);
  receiptFields.evidence.textContent = `${receipt.evidence.tier} · ${receipt.evidence.auditor} · age ${receipt.evidence.age_seconds}s`;
  receiptFields.evaluated.textContent = receipt.evaluated_at;
  receiptFields.hash.textContent = receipt.policy_hash;
};

const setDecision = (receipt, presentation, triggered) => {
  renderReceiptMetadata(receipt);
  if (!triggered) {
    phaseElement.textContent = "Bounder monitoring";
    statusCode.textContent = "evaluating";
    outcomeElement.textContent = "Monitoring";
    delete outcomeElement.dataset.outcome;
    decisionCode.textContent = "evaluating";
    reasonElement.textContent = presentation.initial;
    adapterOutput.textContent = "No state change yet";
    setRuleState(receipt.rule, false);
    return;
  }
  phaseElement.textContent = receipt.allowed ? "Route complete" : "Bounder denied";
  statusCode.textContent = receipt.code;
  outcomeElement.textContent = receipt.allowed ? "Request allowed" : "Request denied";
  outcomeElement.dataset.outcome = receipt.allowed ? "allowed" : "held";
  decisionCode.textContent = receipt.code;
  reasonElement.textContent = receipt.reason;
  adapterOutput.textContent = receipt.adapter.output;
  setRuleState(receipt.rule, !receipt.allowed);
};

const selectScenario = (name) => {
  const receipt = receiptsByScenario.get(name);
  if (!receipt) return;
  selectedScenario = name;
  currentReceipt = receipt;
  progress = scenarioPresentation[name].stop;
  deniedTime = 0;
  setPlaying(false);
  for (const button of root.querySelectorAll("[data-scenario]")) {
    button.setAttribute("aria-pressed", String(button.dataset.scenario === name));
  }
  civilianBoundary.visible = name === "civilian";
  friendlyBoundary.visible = name === "friendly";
  protectedBoundary.visible = name === "protected";
  humanitarianBoundary.visible = name === "humanitarian";
  for (const [scenario, marker] of Object.entries(roeMarkers)) marker.visible = name === scenario;
  altitudeCeiling.visible = name === "altitude";
  weatherGroup.visible = name === "weather";
  sun.intensity = name === "window" ? 0.75 : name === "weather" ? 1.35 : 3.1;
  scene.background.set(name === "window" ? "#68778b" : name === "weather" ? "#88979b" : "#b9d7df");
  scene.fog.color.copy(scene.background);
  scene.fog.near = name === "weather" ? 18 : 28;
  scene.fog.far = name === "weather" ? 32 : 62;
  ambientClouds.visible = name !== "weather";
  showRoute(curves[name]);
  drone.position.copy(curves[name].getPointAt(progress));
  bounderEnvelope.material.color.set(colours.signal);
  bounderEnvelope.scale.setScalar(1);
  setDecision(receipt, scenarioPresentation[name], true);
  const selected = root.querySelector(`[data-scenario="${name}"]`);
  const group = selected?.closest("details");
  if (group) group.open = true;
  scheduleAnimation();
};

const setFleetMode = (enabled) => {
  if (!fleetEvidence) return;
  fleetMode = enabled;
  if (enabled) root.querySelector("#fleet-evidence").open = true;
  fleetButton.textContent = fleetMode ? "Single Guardian" : "Show fleet";
  fleetButton.setAttribute("aria-pressed", String(fleetMode));
  root.querySelector(".fleet-control-panel").classList.toggle("is-active", fleetMode);
  if (!fleetMode) for (const guardian of fleetDrones) guardian.visible = false;
  scheduleAnimation();
};

let operatorTourIndex = 0;

const syncOperatorTourURL = (step) => {
  if (initialParameters.get("embed") === "1") return;
  const parameters = new URLSearchParams(window.location.search);
  parameters.set("tour", "1");
  parameters.set("step", step.id);
  parameters.delete("scenario");
  parameters.delete("resilience");
  if (step.resilience) parameters.set("resilience", step.resilience);
  else parameters.set("scenario", step.scenario);
  if (step.fleet) parameters.set("fleet", "1");
  else parameters.delete("fleet");
  window.history.replaceState(null, "", `${window.location.pathname}?${parameters.toString()}${window.location.hash}`);
};

const showOperatorTourStep = (index) => {
  operatorTourIndex = Math.max(0, Math.min(index, operatorTourSteps.length - 1));
  const step = operatorTourSteps[operatorTourIndex];
  if (step.resilience) root.querySelector("#fault-replay").open = true;
  if (step.fleet) root.querySelector("#fleet-evidence").open = true;
  clearResilienceTransport();
  if (step.resilience) selectResilienceScenario(step.resilience);
  else {
    resilienceMode = false;
    selectedResilience = undefined;
    markAffectedGuardians("");
    playButton.disabled = false;
    selectScenario(step.scenario);
  }
  setFleetMode(step.fleet);
  tourFields.position.textContent = `Step ${operatorTourIndex + 1} of ${operatorTourSteps.length}`;
  tourFields.progress.style.transform = `scaleX(${(operatorTourIndex + 1) / operatorTourSteps.length})`;
  tourFields.title.textContent = step.title;
  tourFields.summary.textContent = step.summary;
  tourFields.proof.textContent = step.proof;
  tourActions.previous.disabled = operatorTourIndex === 0;
  tourActions.next.textContent = operatorTourIndex === operatorTourSteps.length - 1 ? "Finish tour" : "Next proof";
  root.dataset.operatorTourStep = step.id;
  syncOperatorTourURL(step);
};

const openOperatorTour = (requestedStep) => {
  const requestedIndex = operatorTourSteps.findIndex(({ id }) => id === requestedStep);
  operatorTour.hidden = false;
  tourButton.setAttribute("aria-expanded", "true");
  tourButton.textContent = "Tour open";
  showOperatorTourStep(requestedIndex >= 0 ? requestedIndex : 0);
};

const closeOperatorTour = (options = {}) => {
  const restoreFocus = options?.restoreFocus !== false;
  const shouldRestoreFocus = restoreFocus && operatorTour.contains(document.activeElement);
  operatorTour.hidden = true;
  tourButton.setAttribute("aria-expanded", "false");
  tourButton.textContent = "Guided tour";
  delete root.dataset.operatorTourStep;
  if (initialParameters.get("embed") !== "1") {
    const parameters = new URLSearchParams(window.location.search);
    parameters.delete("tour");
    parameters.delete("step");
    window.history.replaceState(null, "", `${window.location.pathname}${parameters.size ? `?${parameters}` : ""}${window.location.hash}`);
  }
  if (shouldRestoreFocus) focusWithoutScroll(tourButton);
};

const update = (delta, elapsed) => {
  if (!currentReceipt) return;
  const presentation = scenarioPresentation[selectedScenario];
  if (playing && progress < presentation.stop) progress = Math.min(presentation.stop, progress + delta * 0.085);
  const point = curves[selectedScenario].getPointAt(progress);
  const nextPoint = curves[selectedScenario].getPointAt(Math.min(progress + 0.008, 1));
  drone.position.copy(point);
  if (playing && !reduceMotion) drone.position.y += Math.sin(elapsed * 0.004) * 0.045;
  drone.rotation.y = Math.atan2(nextPoint.x - point.x, nextPoint.z - point.z);
  for (let index = 0; index < fleetDrones.length; index += 1) {
    const guardian = fleetDrones[index];
    guardian.visible = fleetMode;
    if (!fleetMode) continue;
    const guardianProgress = Math.max(0, progress - (index + 1) * 0.055);
    const guardianPoint = curves[selectedScenario].getPointAt(guardianProgress);
    const guardianNext = curves[selectedScenario].getPointAt(Math.min(guardianProgress + 0.008, 1));
    guardian.position.copy(guardianPoint);
    if (playing && !reduceMotion) guardian.position.y += Math.sin(elapsed * 0.003 + index) * 0.04;
    guardian.rotation.y = Math.atan2(guardianNext.x - guardianPoint.x, guardianNext.z - guardianPoint.z);
  }
  if (playing && !reduceMotion) for (const rotor of rotors) rotor.rotation.z += delta * 12;
  if (playing && !reduceMotion) ambientClouds.position.x = Math.sin(elapsed * 0.00008) * 0.55;
  if (weatherGroup.visible && playing && !reduceMotion) {
    weatherGroup.rotation.y += delta * 0.035;
    const rain = weatherGroup.children[weatherGroup.children.length - 1];
    const positions = rain.geometry.attributes.position;
    for (let index = 1; index < positions.count * 3; index += 3) {
      positions.array[index] -= delta * 5;
      if (positions.array[index] < 0.3) positions.array[index] = 6.5;
    }
    positions.needsUpdate = true;
  }

  if (resilienceMode) return;

  const triggered = progress >= presentation.stop;
  if (triggered && !currentReceipt.allowed) {
    deniedTime += delta;
    bounderEnvelope.material.color.set(colours.safety);
    bounderEnvelope.scale.setScalar(playing && !reduceMotion ? 1 + Math.sin(deniedTime * 7) * 0.13 : 1);
    if (decisionCode.textContent !== currentReceipt.code) setDecision(currentReceipt, presentation, true);
  } else if (triggered && currentReceipt.allowed) {
    if (decisionCode.textContent !== currentReceipt.code) setDecision(currentReceipt, presentation, true);
  }
};

const resize = () => {
  if (!rendererOperational) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  scheduleAnimation();
};

const animate = (time) => {
  animationFrame = undefined;
  if (!rendererOperational) {
    stage.dataset.animationState = "unavailable";
    return;
  }
  if (document.hidden) {
    stage.dataset.animationState = "hidden";
    return;
  }
  if (reduceMotion && time - lastTime < 2000) {
    // Wait on a timer rather than re-queueing a full-rate frame: a visitor who asked for reduced
    // motion should not have the page woken sixty times a second to render twice a second.
    reduceMotionTimer = window.setTimeout(() => {
      reduceMotionTimer = undefined;
      scheduleAnimation();
    }, Math.max(0, 2000 - (time - lastTime)));
    stage.dataset.animationState = "scheduled";
    return;
  }
  const delta = Math.min((time - lastTime) / 1000 || 0, 0.05);
  lastTime = time;
  try {
    update(delta, time);
    updateCameraNavigation(delta);
    const cameraChanged = controls.update();
    renderer.render(scene, camera);
    stage.dataset.renderFrames = String(Number(stage.dataset.renderFrames ?? 0) + 1);
    if (playing || pressedNavigationKeys.size || cameraChanged) scheduleAnimation();
    else if (animationFrame === undefined) stage.dataset.animationState = "idle";
  } catch (error) {
    console.error("Bounder WebGL rendering stopped", error);
    handleWebGLRuntimeFailure();
    return;
  }
};

const scheduleAnimation = () => {
  if (animationFrame === undefined && reduceMotionTimer === undefined && rendererOperational && bootstrapSettled && !document.hidden && stageVisible && !stage.classList.contains("is-explaining")) {
    animationFrame = requestAnimationFrame(animate);
    stage.dataset.animationState = "scheduled";
  }
};

const stopAnimation = (state = "stopped") => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  if (reduceMotionTimer !== undefined) window.clearTimeout(reduceMotionTimer);
  reduceMotionTimer = undefined;
  stage.dataset.animationState = state;
};

const handleWebGLRuntimeFailure = () => {
  if (!rendererOperational) return;
  const focusedElement = document.activeElement;
  const shouldMoveFocus = focusedElement instanceof Element && (
    focusedElement === canvas ||
    operatorTour.contains(focusedElement) ||
    focusedElement.matches("[data-action='play'], [data-action='fleet'], [data-action='tour'], [data-camera], [data-render-quality], [data-scenario], [data-resilience-action], [data-resilience-scrubber], .resilience-scenario")
  );
  rendererOperational = false;
  stopAnimation("unavailable");
  // Release the input surface. controls.dispose() removes the canvas pointer/wheel/contextmenu
  // listeners and the capturing document keydown, and restores touch-action to auto, so the dead
  // canvas stops swallowing touch scrolling and keyboard input while the page says it is paused.
  controls.enabled = false;
  for (const button of root.querySelectorAll("[data-camera]")) button.disabled = true;
  root.querySelector("[data-render-quality]").disabled = true;
  controls.dispose();
  releaseCanvasInput();
  renderer.dispose();
  setPlaying(false);
  pressedNavigationKeys.clear();
  syncNavigationState();
  clearResilienceTransport();
  playButton.disabled = true;
  fleetButton.disabled = true;
  tourButton.disabled = true;
  setScenarioControlsEnabled(false);
  setResilienceControlsEnabled(false);
  closeOperatorTour({ restoreFocus: false });
  stage.classList.remove("is-ready");
  stage.classList.add("is-unavailable");
  stage.dataset.webgl = "runtime-error";
  stage.dataset.failClosed = "true";
  phaseElement.textContent = "Simulation paused";
  statusCode.textContent = "renderer_unavailable";
  outcomeElement.textContent = "Unavailable";
  decisionCode.textContent = "renderer_unavailable";
  reasonElement.textContent = "The rendering context was lost. Bounder retained no command authority.";
  adapterOutput.textContent = "No command authority";
  setRulesUnavailable();
  if (shouldMoveFocus) focusWithoutScroll(receiptSummary);
};

for (const button of root.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => {
    clearResilienceTransport();
    resilienceMode = false;
    selectedResilience = undefined;
    markAffectedGuardians("");
    playButton.disabled = false;
    selectScenario(button.dataset.scenario);
  });
}
playButton.addEventListener("click", () => {
  if (!playing && progress >= scenarioPresentation[selectedScenario].stop) {
    progress = 0;
    setDecision(currentReceipt, scenarioPresentation[selectedScenario], false);
  }
  setPlaying(!playing);
  scheduleAnimation();
});
fleetButton.addEventListener("click", () => {
  if (!fleetEvidence) return;
  setFleetMode(!fleetMode);
});
tourButton.addEventListener("click", () => operatorTour.hidden ? openOperatorTour() : closeOperatorTour());
tourActions.previous.addEventListener("click", () => showOperatorTourStep(operatorTourIndex - 1));
tourActions.next.addEventListener("click", () => {
  if (operatorTourIndex === operatorTourSteps.length - 1) closeOperatorTour();
  else showOperatorTourStep(operatorTourIndex + 1);
});
tourActions.close.addEventListener("click", closeOperatorTour);
resilienceActions.run.addEventListener("click", runResilience);
resilienceActions.pause.addEventListener("click", () => {
  clearResilienceTransport();
  resilienceFields.transport.textContent = "Paused";
});
resilienceActions.step.addEventListener("click", () => {
  if (!selectedResilience) return;
  clearResilienceTransport();
  const next = Math.min(resilienceCursor + 1, selectedResilience.events.length - 1);
  applyResilienceEvent(selectedResilience.events[next]);
});
resilienceActions.reset.addEventListener("click", resetResilience);
resilienceScrubber.addEventListener("input", () => {
  if (!selectedResilience) return;
  clearResilienceTransport();
  const time = Number(resilienceScrubber.value);
  const index = selectedResilience.events.findLastIndex((event) => event.at_ms <= time);
  if (index >= 0) applyResilienceEvent(selectedResilience.events[index]);
  else resetResilience();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setPlaying(false);
    pressedNavigationKeys.clear();
    syncNavigationState();
    clearResilienceTransport();
    if (selectedResilience) resilienceFields.transport.textContent = "Paused while this page is hidden";
    stopAnimation("hidden");
  } else {
    lastTime = 0;
    scheduleAnimation();
  }
});
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  handleWebGLRuntimeFailure();
});
canvas.addEventListener("webglcontextrestored", () => {
  stage.dataset.webgl = "runtime-error";
});
new ResizeObserver(resize).observe(stage);

const setScenarioControlsEnabled = (enabled) => {
  const available = Boolean(enabled) && rendererOperational;
  for (const button of root.querySelectorAll("[data-scenario]")) {
    button.disabled = !available;
    if (!available) button.setAttribute("aria-pressed", "false");
  }
};

const setResilienceControlsEnabled = (enabled) => {
  const available = Boolean(enabled) && rendererOperational;
  for (const button of resilienceScenarios.querySelectorAll("button")) button.disabled = !available;
  for (const [name, control] of Object.entries(resilienceActions)) control.disabled = !available || name === "pause";
  resilienceScrubber.disabled = !available;
};

const setRulesUnavailable = () => {
  for (const item of root.querySelectorAll(".rule-stack li")) {
    item.classList.remove("is-failed", "is-monitoring");
    item.querySelector("strong").textContent = "UNAVAILABLE";
  }
};

const showReceiptLoadFailure = () => {
  setPlaying(false);
  playButton.disabled = true;
  fleetButton.disabled = true;
  tourButton.disabled = true;
  setScenarioControlsEnabled(false);
  setResilienceControlsEnabled(false);
  stage.dataset.receiptsReady = "false";
  stage.dataset.failClosed = "true";
  receiptSource.textContent = "Receipt fixture unavailable";
  phaseElement.textContent = "Simulation paused";
  statusCode.textContent = "fixture_unavailable";
  outcomeElement.textContent = "Unavailable";
  decisionCode.textContent = "fixture_unavailable";
  reasonElement.textContent = "The Go interlock receipt bundle could not be loaded or validated. The simulation remains paused.";
  adapterOutput.textContent = "No command authority";
  setRulesUnavailable();
};

const showFleetLoadFailure = () => {
  stage.dataset.fleetReady = "false";
  fleetButton.disabled = true;
  tourButton.disabled = true;
  setResilienceControlsEnabled(false);
  resilienceLab.hidden = true;
  fleetSource.textContent = "Fleet evidence unavailable · local receipts remain usable";
  fleetSource.dataset.source = "unavailable";
};

const showBootstrapFailure = () => {
  showReceiptLoadFailure();
  showFleetLoadFailure();
  receiptSource.textContent = "Simulator initialisation unavailable";
  statusCode.textContent = "bootstrap_unavailable";
  decisionCode.textContent = "bootstrap_unavailable";
  reasonElement.textContent = "The simulation could not initialise and remains paused.";
};

const bootstrap = async () => {
  stage.dataset.receiptsReady = "false";
  stage.dataset.fleetReady = "false";
  playButton.disabled = true;
  fleetButton.disabled = true;
  tourButton.disabled = true;
  setScenarioControlsEnabled(false);
  setResilienceControlsEnabled(false);

  try {
    const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    const receiptTask = settle(loadReceiptBundle());
    const fleetTask = settle(loadFleetEvidence());
    const requestedResilience = initialParameters.get("resilience");
    const requestedScenario = initialParameters.get("scenario");

    const receiptResult = await receiptTask;
    const receiptReady = receiptResult.ok;
    if (receiptReady && rendererOperational) {
      setScenarioControlsEnabled(true);
      playButton.disabled = false;
      selectScenario(expectedScenarioIDs.includes(requestedScenario) ? requestedScenario : "safe");
    } else if (!receiptReady) {
      console.warn("Bounder receipt bundle failed closed", receiptResult.error);
      showRoute(curves.safe);
      drone.position.copy(curves.safe.getPointAt(0));
      showReceiptLoadFailure();
    }

    const fleetResult = await fleetTask;
    const fleetReady = fleetResult.ok;
    if (!fleetReady) {
      console.warn("Bounder Fleet evidence is unavailable", fleetResult.error);
      showFleetLoadFailure();
    }

    if (receiptReady && fleetReady && rendererOperational) {
      fleetButton.disabled = false;
      tourButton.disabled = false;
      setResilienceControlsEnabled(true);
      if (initialParameters.get("tour") === "1") {
        openOperatorTour(initialParameters.get("step"));
      } else if (fleetEvidence.resilience.scenarios.some(({ id }) => id === requestedResilience)) {
        selectResilienceScenario(requestedResilience);
        setFleetMode(initialParameters.get("fleet") === "1");
      } else if (expectedScenarioIDs.includes(requestedScenario)) {
        clearResilienceTransport();
        resilienceMode = false;
        selectedResilience = undefined;
        playButton.disabled = false;
        selectScenario(requestedScenario);
        setFleetMode(initialParameters.get("fleet") === "1");
      } else {
        selectScenario("safe");
        setFleetMode(initialParameters.get("fleet") === "1");
        if (root.querySelector("#fault-replay").open) selectResilienceScenario(fleetEvidence.resilience.scenarios[0].id);
      }
    }
  } catch (error) {
    console.error("Bounder simulator bootstrap failed closed", error);
    showBootstrapFailure();
  } finally {
    bootstrapSettled = true;
    resize();
    scheduleAnimation();
  }
};

const syncStageRendering = () => {
  if (!stageVisible || stage.classList.contains('is-explaining')) stopAnimation('offscreen');
  else { lastTime = 0; scheduleAnimation(); }
};
if (typeof IntersectionObserver === 'function') {
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    stageVisible = entry.isIntersecting;
    syncStageRendering();
  });
  visibilityObserver.observe(stage);
}
stage.addEventListener('viewchange', syncStageRendering);
controls.addEventListener('change', scheduleAnimation);

// These views change presentation only; they never change receipt inputs or outcomes.
const viewButtons = [...root.querySelectorAll('[data-camera]')];
const setCameraView = (view) => {
  if (!rendererOperational) return;
  if (view === 'top') {
    controls.target.set(0, 0, 0);
    camera.position.set(0, 31, .1);
  } else if (view === 'focus') {
    controls.target.copy(drone.position);
    camera.position.copy(drone.position).add(new THREE.Vector3(9, 8, 11));
  } else {
    controls.target.set(0, .8, 0);
    camera.position.set(17, 16, 21);
  }
  // Flush damping before setting a deliberate camera pose.
  controls.update();
  stage.dataset.cameraView = view;
  viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.camera === view)));
};
viewButtons.forEach((button) => {
  button.disabled = false;
  button.addEventListener('click', () => setCameraView(button.dataset.camera));
});
const qualityControl = root.querySelector('[data-render-quality]');
qualityControl.addEventListener('change', () => {
  if (!rendererOperational) return;
  const low = qualityControl.value === 'low';
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = !low;
  stage.dataset.renderQuality = low ? 'low' : 'standard';
  resize();
});
root.querySelector('#fault-replay').addEventListener('toggle', (event) => {
  if (event.target.open && fleetEvidence && receiptsByScenario.size && !resilienceMode) {
    selectResilienceScenario(selectedResilience?.id ?? fleetEvidence.resilience.scenarios[0].id);
  }
});

bootstrap().catch((error) => {
  console.error("Bounder simulator bootstrap could not fail closed", error);
});
