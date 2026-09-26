import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { PROTECTION_BOUNDARIES, ROUTE_STOPS, WORLD_BOUNDS } from "../simulator-world.js";
import { createTownScene } from "./scene.js";
import { renderFleetRows } from "../ui/fleet-view.js";
import { asSentence } from "../ui/text.js";
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
// Damping keeps the camera gliding after a drag ends; reduced motion asks for no such drift.
controls.enableDamping = !reduceMotion;
controls.dampingFactor = 0.06;
controls.minDistance = 11;
controls.maxDistance = 34;
// Keep the camera well above the horizon so the view never looks beneath the ground.
controls.maxPolarAngle = Math.PI * 0.44;
// The wheel zooms only after the visitor engages the scene (click or keyboard focus), so page
// scrolling over the canvas, including the homepage embed, is never captured by accident.
controls.enableZoom = false;
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

const releaseNavigationKeys = () => {
  pressedNavigationKeys.clear();
  syncNavigationState();
};

// Keyboard zoom: + (or =) moves closer and - moves away, within the orbit distance limits.
const zoomKeys = new Map([["+", 0.88], ["=", 0.88], ["-", 1 / 0.88], ["_", 1 / 0.88]]);
const cameraOffset = new THREE.Vector3();
const zoomCamera = (factor) => {
  cameraOffset.copy(camera.position).sub(controls.target);
  cameraOffset.setLength(THREE.MathUtils.clamp(cameraOffset.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(cameraOffset);
  controls.update();
  scheduleAnimation();
};

// Before a control disables itself, move keyboard focus to a sensible neighbour so focus never
// falls back to the document body.
const disableKeepingFocus = (control, fallback) => {
  if (document.activeElement === control && fallback && !fallback.disabled) focusWithoutScroll(fallback);
  control.disabled = true;
};

const handleCanvasPointerDown = () => focusWithoutScroll(canvas);
const handleCanvasKeyDown = (event) => {
  // Leave browser and system shortcuts (Cmd+S, Ctrl+D, Alt+…) to the browser. On macOS a letter
  // released while Cmd is held never sends keyup, so claiming it would leave the camera drifting.
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (zoomKeys.has(event.key)) {
    event.preventDefault();
    zoomCamera(zoomKeys.get(event.key));
    return;
  }
  if (!navigationCodes.has(event.code)) return;
  event.preventDefault();
  pressedNavigationKeys.add(event.code);
  stage.dataset.lastNavigationKey = event.code;
  syncNavigationState();
  scheduleAnimation();
};
const handleCanvasKeyUp = (event) => {
  if (event.key === "Meta" || event.key === "Control") {
    releaseNavigationKeys();
    return;
  }
  if (!navigationCodes.has(event.code)) return;
  event.preventDefault();
  pressedNavigationKeys.delete(event.code);
  syncNavigationState();
};
const handleCanvasFocus = () => {
  controls.enableZoom = true;
};
const handleCanvasBlur = () => {
  controls.enableZoom = false;
  releaseNavigationKeys();
};

canvas.addEventListener("pointerdown", handleCanvasPointerDown);
canvas.addEventListener("keydown", handleCanvasKeyDown);
canvas.addEventListener("keyup", handleCanvasKeyUp);
canvas.addEventListener("focus", handleCanvasFocus);
canvas.addEventListener("blur", handleCanvasBlur);
window.addEventListener("blur", releaseNavigationKeys);

const releaseCanvasInput = () => {
  canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
  canvas.removeEventListener("keydown", handleCanvasKeyDown);
  canvas.removeEventListener("keyup", handleCanvasKeyUp);
  canvas.removeEventListener("focus", handleCanvasFocus);
  canvas.removeEventListener("blur", handleCanvasBlur);
  window.removeEventListener("blur", releaseNavigationKeys);
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

const {
  sun,
  hemisphere,
  lampGlow,
  buildingWindowMaterial,
  fairCloudMaterial,
  civilianBoundary,
  friendlyBoundary,
  protectedBoundary,
  humanitarianBoundary,
  roeMarkers,
  roeColours,
  worldLabels,
  redrawWorldLabels,
  altitudeCeiling,
  weatherGroup,
  weatherClouds,
  windStreaks,
  ambientClouds,
  curves,
  drone,
  bounderEnvelope,
  fleetDrones,
  rotors,
  showRoute
} = createTownScene({ scene, colours, stage });

const scenarioPresentation = Object.freeze({
  safe: { stop: ROUTE_STOPS.safe, initial: "All reviewed constraints currently pass." },
  civilian: { stop: ROUTE_STOPS.civilian, initial: "The route is approaching an active civilian-protection buffer." },
  friendly: { stop: ROUTE_STOPS.friendly, initial: "Authenticated friendly presence is inside the planned route corridor." },
  protected: { stop: ROUTE_STOPS.protected, initial: "The route is approaching a declared protected-site boundary." },
  humanitarian: { stop: ROUTE_STOPS.humanitarian, initial: "The route is approaching an active humanitarian movement corridor." },
  surrender: { stop: ROUTE_STOPS.surrender, initial: "A surrender indication is being checked. It can only keep the requested action inhibited." },
  incapacitated: { stop: ROUTE_STOPS.incapacitated, initial: "An incapacitated-person indication is being checked. It can only keep the requested action inhibited." },
  identification: { stop: ROUTE_STOPS.identification, initial: "Positive identification has not yet been confirmed." },
  proportionality: { stop: ROUTE_STOPS.proportionality, initial: "The signed proportionality condition has not yet been satisfied." },
  human_authorization: { stop: ROUTE_STOPS.human_authorization, initial: "Current human authorisation has not yet been confirmed." },
  altitude: { stop: ROUTE_STOPS.altitude, initial: "Local altitude is being compared with the signed flight ceiling." },
  weather: { stop: ROUTE_STOPS.weather, initial: "Wind observations are approaching the permitted envelope." },
  window: { stop: ROUTE_STOPS.window, initial: "The requested state change is being checked against its authorised time window." },
  link: { stop: ROUTE_STOPS.link, initial: "Bounder is monitoring heartbeat and telemetry freshness." },
  replay: { stop: ROUTE_STOPS.replay, initial: "The supplied policy sequence was already accepted." }
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
    title: "Keep clear of friendly teams",
    summary: "Authenticated friendly presence inside the signed separation distance stops the requested state change locally.",
    proof: "The friendly-force rule changes to HOLD and the adapter keeps its safe state."
  },
  {
    id: "evidence-only-roe",
    scenario: "surrender",
    fleet: true,
    title: "Keep high-consequence evidence non-authoritative",
    summary: "Surrender, incapacitation, identification, proportionality and human authorisation are modelled as evidence-only holds. None of them can become permission to act.",
    proof: "The receipt keeps the requested action inhibited: command_authorized and command_sent are both false."
  },
  {
    id: "rollback-proof",
    resilience: "coherent-snapshot-rollback",
    fleet: true,
    title: "Reject a coherent older snapshot",
    summary: "Fleet’s signed receipt floor exposes a locally valid but older Guardian state. Authority remains frozen through reconciliation.",
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
  // Pause disables itself once nothing is streaming; keep keyboard focus on a working control.
  disableKeepingFocus(resilienceActions.pause, resilienceActions.step);
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
    if (index === resilienceCursor) item.setAttribute("aria-current", "step");
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

// Fleet fixtures record short device IDs; the visible Fleet list shows their pilot aliases.
const displayDeviceID = (id) => {
  const alias = fleetGuardianAliases.get(id);
  return alias && alias !== id ? `${alias} (recorded as ${id})` : id;
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
  renderResilienceTimeline();
  renderContinuityProof(index);
  markAffectedGuardians(event.device_id || selectedResilience.affected_device);
  receiptSource.textContent = "Fleet resilience evidence";
  receiptFields.engine.textContent = RESILIENCE_RECEIPT_ENGINE;
  receiptFields.signature.textContent = FLEET_AUDIT_AUTHENTICATION.label;
  receiptFields.policy.textContent = fleetEvidence.policy_profile;
  receiptFields.issuer.textContent = "creed.space/fleet";
  receiptFields.subject.textContent = displayDeviceID(event.device_id || selectedResilience.affected_device);
  receiptFields.sequence.textContent = String(event.policy_sequence || 0);
  receiptFields.evidence.textContent = selectedResilience.proof;
  receiptFields.evaluated.textContent = `t + ${(event.at_ms / 1000).toFixed(2)} seconds`;
  receiptFields.hash.textContent = "See signed Fleet evidence bundle";
  // The scene mirrors the recorded timeline exactly: the hold colour applies from the decision
  // event onward and is removed again when the timeline is scrubbed back before it.
  const decisionIndex = selectedResilience.events.findIndex((candidate) => candidate.kind === "decision");
  const held = decisionIndex >= 0 && index >= decisionIndex;
  setEnvelopeHeld(held);
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
  }
  statusCode.textContent = event.code;
  decisionCode.textContent = event.code;
  reasonElement.textContent = asSentence(event.message);
  scheduleAnimation();
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
    setEnvelopeHeld(false);
    statusCode.textContent = first.code;
    decisionCode.textContent = "ready";
    phaseElement.textContent = "Fault laboratory ready";
    outcomeElement.textContent = "Ready";
    delete outcomeElement.dataset.outcome;
    reasonElement.textContent = selectedResilience.fault;
    adapterOutput.textContent = "No state change yet";
    receiptSource.textContent = "Fleet resilience evidence";
    receiptFields.engine.textContent = RESILIENCE_RECEIPT_ENGINE;
    receiptFields.signature.textContent = FLEET_AUDIT_AUTHENTICATION.label;
    receiptFields.policy.textContent = fleetEvidence.policy_profile;
    receiptFields.issuer.textContent = "creed.space/fleet";
    receiptFields.subject.textContent = displayDeviceID(selectedResilience.affected_device);
    receiptFields.sequence.textContent = String(first.policy_sequence || 0);
    receiptFields.evidence.textContent = selectedResilience.proof;
    receiptFields.evaluated.textContent = "Ready to stream";
    receiptFields.hash.textContent = "See signed Fleet evidence bundle";
    setRuleState(resilienceRule[selectedResilience.id], false);
  }
  scheduleAnimation();
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
      if (index === selectedResilience.events.length - 1) disableKeepingFocus(resilienceActions.pause, resilienceActions.run);
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

let scenarioBeforeResilience;

const selectResilienceScenario = (id) => {
  // A lost renderer keeps its fail-closed panel; the fault laboratory cannot replace it.
  if (!rendererOperational || !fleetEvidence) return;
  const scenario = fleetEvidence.resilience.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) return;
  if (!resilienceMode) scenarioBeforeResilience = selectedScenario;
  root.querySelector("#fault-replay").open = true;
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
  resilienceFields.device.textContent = displayDeviceID(scenario.affected_device);
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
    button.addEventListener("click", () => {
      userSelectedScenario = true;
      leaveOperatorTour();
      selectResilienceScenario(scenario.id);
      syncSelectionURL();
    });
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
let rendererOperational = true;
let stageVisible = true;
let bootstrapSettled = false;
// Set once the visitor chooses a scenario, fault or Play, so late-loading evidence never
// replaces their choice with the default.
let userSelectedScenario = false;

const setPlaying = (enabled) => {
  playing = Boolean(enabled) && rendererOperational && !document.hidden;
  // An action button, not a toggle: its label names what activating it will do.
  playButton.textContent = playing ? "Pause simulation" : "Play simulation";
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
  receiptSource.textContent = receipt.decision_source === receiptBundle.engine ? "Recorded interlock receipt (Go engine)" : "Recorded adapter receipt after Go engine verification";
  receiptFields.engine.textContent = receipt.decision_source;
  receiptFields.signature.textContent = receipt.signature_verified ? "Recorded as verified by Go engine" : "Recorded verification failed";
  receiptFields.policy.textContent = receipt.policy_id;
  receiptFields.issuer.textContent = receipt.issuer;
  receiptFields.subject.textContent = receipt.subject;
  receiptFields.sequence.textContent = String(receipt.sequence);
  receiptFields.evidence.textContent = `${receipt.evidence.tier} · ${receipt.evidence.auditor} · ${receipt.evidence.age_seconds}s old`;
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
  phaseElement.textContent = receipt.allowed ? "Bounder permits" : "Bounder holds";
  statusCode.textContent = receipt.code;
  outcomeElement.textContent = receipt.allowed ? "Request allowed" : "Request denied";
  outcomeElement.dataset.outcome = receipt.allowed ? "allowed" : "held";
  decisionCode.textContent = receipt.code;
  reasonElement.textContent = asSentence(receipt.reason);
  adapterOutput.textContent = receipt.adapter.output;
  setRuleState(receipt.rule, !receipt.allowed);
};

const legendBoundarySwatch = root.querySelector(".legend-boundary");
const legendBounderSwatch = root.querySelector(".legend-bounder");
const legendBoundaryColours = Object.freeze({
  civilian: colours.civilian,
  friendly: colours.friendly,
  protected: colours.protected,
  humanitarian: colours.humanitarian,
  altitude: colours.safety,
  ...roeColours
});
const setLegendLabel = (swatch, text) => {
  const label = swatch?.nextSibling;
  if (label?.nodeType === Node.TEXT_NODE) label.textContent = text;
};

// The legend follows the scene: the boundary swatch takes the selected protection's colour
// (hidden when no boundary is drawn) and the envelope entry names the hold when it applies.
const syncBoundaryLegend = (name) => {
  if (!legendBoundarySwatch) return;
  const colour = legendBoundaryColours[name];
  // The legend spans set display:inline-flex, which would override the hidden attribute.
  legendBoundarySwatch.parentElement.style.display = colour ? "" : "none";
  if (colour) legendBoundarySwatch.style.background = colour;
};

const setEnvelopeHeld = (held) => {
  bounderEnvelope.material.color.set(held ? colours.safety : colours.signal);
  if (!held) bounderEnvelope.scale.setScalar(1);
  if (legendBounderSwatch) {
    legendBounderSwatch.style.background = held ? colours.safety : colours.signal;
    setLegendLabel(legendBounderSwatch, held ? "Bounder hold" : "Bounder envelope");
  }
};

// Lighting grades. Weather shows wind with clear air (the receipt records 8 km visibility);
// the operating window is a dusk grade outside the authorised time window.
const atmospheres = Object.freeze({
  clear: { background: "#b9d7df", fogNear: 28, fogFar: 62, sun: 3.1, sunColour: "#fff1cf", hemisphere: 2.15, sky: "#e9f7ff", groundLight: "#5b6749", clouds: "#f7fbfa", cloudOpacity: 0.88, fairClouds: true, lamps: 1.1, windowGlow: "#49747e", windowGlowIntensity: 0.18 },
  weather: { background: "#a6b5b9", fogNear: 26, fogFar: 62, sun: 1.8, sunColour: "#f4f1e8", hemisphere: 1.75, sky: "#d7e1e4", groundLight: "#56614a", clouds: "#f7fbfa", cloudOpacity: 0.88, fairClouds: false, lamps: 1.1, windowGlow: "#49747e", windowGlowIntensity: 0.18 },
  window: { background: "#4d5a78", fogNear: 26, fogFar: 62, sun: 0.9, sunColour: "#ffc796", hemisphere: 1.15, sky: "#a3b0cf", groundLight: "#3e4539", clouds: "#8c96ae", cloudOpacity: 0.75, fairClouds: true, lamps: 2.8, windowGlow: "#f2c46b", windowGlowIntensity: 0.75 }
});
const applyAtmosphere = (name) => {
  const grade = atmospheres[name] ?? atmospheres.clear;
  scene.background.set(grade.background);
  if (rendererOperational) renderer.setClearColor(scene.background, 1);
  scene.fog.color.copy(scene.background);
  scene.fog.near = grade.fogNear;
  scene.fog.far = grade.fogFar;
  sun.intensity = grade.sun;
  sun.color.set(grade.sunColour);
  hemisphere.intensity = grade.hemisphere;
  hemisphere.color.set(grade.sky);
  hemisphere.groundColor.set(grade.groundLight);
  fairCloudMaterial.color.set(grade.clouds);
  fairCloudMaterial.opacity = grade.cloudOpacity;
  ambientClouds.visible = grade.fairClouds;
  lampGlow.emissiveIntensity = grade.lamps;
  buildingWindowMaterial.emissive.set(grade.windowGlow);
  buildingWindowMaterial.emissiveIntensity = grade.windowGlowIntensity;
};

// Camera framing. Every scenario except the town-wide cleared route frames its hold point and
// its subject; the Overview button always returns to the whole town.
const OVERVIEW_POSE = Object.freeze({ position: new THREE.Vector3(17, 16, 21), target: new THREE.Vector3(0, 0.8, 0) });
// A steep south-east view (about 60 degrees down) sees over the rooftops to both roads.
const FRAMING_OFFSET = new THREE.Vector3(5, 17, 8);
const FRAMING_BIAS = new THREE.Vector3(-1.2, 0, -1.8);
const scenarioSubject = (name) => {
  const boundary = PROTECTION_BOUNDARIES[name];
  if (boundary) return new THREE.Vector3(boundary.x, 0.8, boundary.z);
  if (roeMarkers[name]) return roeMarkers[name].position.clone().setY(0.8);
  return undefined;
};
const scenarioPose = (name) => {
  if (name === "safe") return OVERVIEW_POSE;
  const hold = curves[name].getPointAt(scenarioPresentation[name].stop);
  const subject = scenarioSubject(name);
  const target = subject ? hold.clone().setY(2.6).lerp(subject.clone().setY(2.6), 0.5) : hold.clone().setY(3);
  // Aim slightly north-west of the subject so it sits below and right of the status overlay,
  // which covers the stage's top-left corner on narrow screens.
  target.add(FRAMING_BIAS);
  target.x = THREE.MathUtils.clamp(target.x, -WORLD_BOUNDS.width / 2, WORLD_BOUNDS.width / 2);
  target.z = THREE.MathUtils.clamp(target.z, -WORLD_BOUNDS.depth / 2, WORLD_BOUNDS.depth / 2);
  return { position: target.clone().add(FRAMING_OFFSET), target };
};

let cameraTween;
const CAMERA_TWEEN_MS = 650;
const moveCamera = (position, target, { animate = true } = {}) => {
  if (!animate || reduceMotion || !rendererOperational) {
    cameraTween = undefined;
    controls.target.copy(target);
    camera.position.copy(position);
    controls.update();
    scheduleAnimation();
    return;
  }
  cameraTween = {
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: position.clone(),
    toTarget: target.clone(),
    start: undefined
  };
  scheduleAnimation();
};
const stepCameraTween = (time) => {
  if (!cameraTween) return false;
  cameraTween.start ??= time;
  const linear = Math.min(1, (time - cameraTween.start) / CAMERA_TWEEN_MS);
  const eased = linear < 0.5 ? 2 * linear * linear : 1 - ((-2 * linear + 2) ** 2) / 2;
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  if (linear >= 1) cameraTween = undefined;
  return true;
};

const selectScenario = (name, { camera: cameraMove = "animate" } = {}) => {
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
  applyAtmosphere(name);
  syncBoundaryLegend(name);
  showRoute(curves[name]);
  drone.position.copy(curves[name].getPointAt(progress));
  setEnvelopeHeld(false);
  setDecision(receipt, scenarioPresentation[name], true);
  const selected = root.querySelector(`[data-scenario="${name}"]`);
  const group = selected?.closest("details");
  if (group) group.open = true;
  if (cameraMove !== "none") {
    const pose = scenarioPose(name);
    moveCamera(pose.position, pose.target, { animate: cameraMove === "animate" });
    stage.dataset.cameraView = name === "safe" ? "overview" : "scenario";
    for (const button of root.querySelectorAll("[data-camera]")) {
      button.setAttribute("aria-pressed", String(name === "safe" && button.dataset.camera === "overview"));
    }
  }
  scheduleAnimation();
};

const setFleetMode = (enabled) => {
  if (!fleetEvidence) return;
  fleetMode = enabled;
  if (enabled) root.querySelector("#fleet-evidence").open = true;
  // A toggle keeps one name; aria-pressed alone carries whether the Fleet view is on.
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
  if (!rendererOperational) return;
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
  // Previous disables itself on the first step; hand focus to Next rather than the page body.
  if (operatorTourIndex === 0) disableKeepingFocus(tourActions.previous, tourActions.next);
  else tourActions.previous.disabled = false;
  tourActions.next.textContent = operatorTourIndex === operatorTourSteps.length - 1 ? "Finish tour" : "Next proof";
  root.dataset.operatorTourStep = step.id;
  syncOperatorTourURL(step);
};

const revealOperatorTour = ({ onlyIfUntouched = false } = {}) => {
  if (initialParameters.get("embed") === "1") return;
  const focusUntouched = !document.activeElement || document.activeElement === document.body || document.activeElement === root;
  // A landing from a tour link scrolls only if the visitor has not moved on: the page is still at
  // the top, or still at the workbench anchor the link itself targeted.
  const atLandingAnchor = window.location.hash === `#${root.id}` && Math.abs(root.getBoundingClientRect().top) < 80;
  if (onlyIfUntouched && (!focusUntouched || (window.scrollY > 40 && !atLandingAnchor))) return;
  const top = operatorTour.getBoundingClientRect().top + window.scrollY - 16;
  const bottomVisible = operatorTour.getBoundingClientRect().bottom <= window.innerHeight;
  if (onlyIfUntouched || operatorTour.getBoundingClientRect().top < 0 || !bottomVisible) {
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "instant" : "smooth" });
  }
  const title = tourFields.title;
  if (title) {
    title.tabIndex = -1;
    focusWithoutScroll(title);
  }
};

const openOperatorTour = (requestedStep, { reveal = "focus" } = {}) => {
  if (!rendererOperational) return;
  const requestedIndex = operatorTourSteps.findIndex(({ id }) => id === requestedStep);
  operatorTour.hidden = false;
  // The trigger keeps its name; aria-expanded carries whether the tour is open.
  tourButton.setAttribute("aria-expanded", "true");
  showOperatorTourStep(requestedIndex >= 0 ? requestedIndex : 0);
  if (reveal === "focus") revealOperatorTour();
  else if (reveal === "landing") revealOperatorTour({ onlyIfUntouched: true });
};

const closeOperatorTour = (options = {}) => {
  const restoreFocus = options?.restoreFocus !== false;
  const shouldRestoreFocus = restoreFocus && operatorTour.contains(document.activeElement);
  operatorTour.hidden = true;
  tourButton.setAttribute("aria-expanded", "false");
  delete root.dataset.operatorTourStep;
  if (initialParameters.get("embed") !== "1") {
    const parameters = new URLSearchParams(window.location.search);
    parameters.delete("tour");
    parameters.delete("step");
    window.history.replaceState(null, "", `${window.location.pathname}${parameters.size ? `?${parameters}` : ""}${window.location.hash}`);
  }
  if (shouldRestoreFocus) focusWithoutScroll(tourButton);
};

// Record a visitor's own selection in the address bar so it can be shared and survives a
// reload. The tour's parameters are removed because the tour no longer describes the scene.
const syncSelectionURL = () => {
  if (initialParameters.get("embed") === "1") return;
  const parameters = new URLSearchParams(window.location.search);
  for (const key of ["tour", "step", "scenario", "resilience", "fleet"]) parameters.delete(key);
  if (resilienceMode && selectedResilience) parameters.set("resilience", selectedResilience.id);
  else parameters.set("scenario", selectedScenario);
  if (fleetMode) parameters.set("fleet", "1");
  window.history.replaceState(null, "", `${window.location.pathname}?${parameters.toString()}${window.location.hash}`);
};

// Picking a scenario or fault by hand leaves the scripted tour, whose card would otherwise keep
// describing a step that is no longer on screen.
const leaveOperatorTour = () => {
  if (!operatorTour.hidden) closeOperatorTour({ restoreFocus: false });
};

const trailingPoint = new THREE.Vector3();
const trailingTangent = new THREE.Vector3();
const lateral = new THREE.Vector3();
// The model's nose is local +x, so its yaw turns +x onto the horizontal direction of travel.
const headingFor = (tangent) => Math.atan2(-tangent.z, tangent.x);

const update = (delta, elapsed) => {
  if (!currentReceipt) return;
  const presentation = scenarioPresentation[selectedScenario];
  const curve = curves[selectedScenario];
  // Under reduced motion Play jumps between states on a timer; the route is never flown.
  if (playing && !reduceMotion && progress < presentation.stop) progress = Math.min(presentation.stop, progress + delta * 0.085);
  const point = curve.getPointAt(progress);
  const tangent = curve.getTangentAt(Math.min(progress, 1));
  drone.position.copy(point);
  if (playing && !reduceMotion) drone.position.y += Math.sin(elapsed * 0.004) * 0.045;
  drone.rotation.y = headingFor(tangent);
  // Holding against the recorded wind, the drone pitches its nose into the headwind.
  const windPitch = selectedScenario === "weather" ? -0.14 : 0;
  drone.rotation.z = windPitch;

  // Fleet Guardians fly an echelon behind the lead drone, spaced by distance rather than by
  // route fraction, and extend back along the approach when the lead is near the route start.
  const routeLength = curve.getLength();
  const leadDistance = progress * routeLength;
  for (let index = 0; index < fleetDrones.length; index += 1) {
    const guardian = fleetDrones[index];
    guardian.visible = fleetMode;
    if (!fleetMode) continue;
    const row = Math.floor(index / 2) + 1;
    const side = index % 2 === 0 ? -1 : 1;
    const distance = leadDistance - row * 2.1;
    if (distance >= 0) {
      const u = Math.min(1, distance / routeLength);
      trailingPoint.copy(curve.getPointAt(u));
      trailingTangent.copy(curve.getTangentAt(u));
    } else {
      trailingTangent.copy(curve.getTangentAt(0));
      trailingPoint.copy(curve.getPointAt(0)).addScaledVector(trailingTangent, distance);
    }
    trailingTangent.y = 0;
    if (trailingTangent.lengthSq() < 1e-6) trailingTangent.set(1, 0, 0);
    trailingTangent.normalize();
    lateral.set(-trailingTangent.z, 0, trailingTangent.x);
    guardian.position.copy(trailingPoint).addScaledVector(lateral, side * row * 1.25);
    if (playing && !reduceMotion) guardian.position.y += Math.sin(elapsed * 0.003 + index) * 0.04;
    guardian.rotation.y = headingFor(trailingTangent);
    guardian.rotation.z = windPitch;
  }
  if (playing && !reduceMotion) for (const rotor of rotors) rotor.rotation.y += delta * 22;
  if (playing && !reduceMotion) ambientClouds.position.x = Math.sin(elapsed * 0.00008) * 0.55;
  if (weatherGroup.visible && playing && !reduceMotion) {
    const { minX, maxX } = windStreaks.userData.span;
    const span = maxX - minX;
    const positions = windStreaks.geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 2) {
      const shift = delta * 9;
      let start = positions.getX(index) - shift;
      let end = positions.getX(index + 1) - shift;
      if (end < minX) {
        start += span;
        end += span;
      }
      positions.setX(index, start);
      positions.setX(index + 1, end);
    }
    positions.needsUpdate = true;
    weatherClouds.position.x -= delta * 1.6;
    if (weatherClouds.position.x < -8) weatherClouds.position.x += 16;
  }

  if (resilienceMode) return;

  const triggered = progress >= presentation.stop;
  if (triggered && !currentReceipt.allowed) {
    deniedTime += delta;
    setEnvelopeHeld(true);
    if (decisionCode.textContent !== currentReceipt.code) setDecision(currentReceipt, presentation, true);
    // Pulse the hold briefly, then let the render loop go idle on the persistent hold colour.
    if (playing && (reduceMotion || deniedTime > 3)) setPlaying(false);
    bounderEnvelope.scale.setScalar(playing && !reduceMotion ? 1 + Math.sin(deniedTime * 7) * 0.13 : 1);
  } else if (triggered && currentReceipt.allowed) {
    if (decisionCode.textContent !== currentReceipt.code) setDecision(currentReceipt, presentation, true);
    if (playing) setPlaying(false);
  }
};

// Marker labels keep a constant on-screen height: the sprite scale is the fraction of the
// stage height the label should fill, converted through the camera's vertical field of view.
const layoutWorldLabels = (stageHeight) => {
  const pixels = stageHeight < 320 ? 22 : 26;
  const scaleY = 2 * (pixels / Math.max(stageHeight, 1)) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const sprite of worldLabels) sprite.scale.set(scaleY * sprite.userData.aspect, scaleY, 1);
};

const resize = () => {
  if (!rendererOperational) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  layoutWorldLabels(height);
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
  // Frames are rendered on demand at full rate: while a flight plays, while a key is held, while
  // the camera moves, and once after any state change. Reduced motion removes the autonomous
  // motion (flight, bobbing, rotor spin, pulses, camera glides); it never slows user input.
  const delta = Math.min((time - lastTime) / 1000 || 0, 0.05);
  lastTime = time;
  try {
    update(delta, time);
    updateCameraNavigation(delta);
    const tweening = stepCameraTween(time);
    const cameraChanged = controls.update();
    renderer.render(scene, camera);
    stage.dataset.renderFrames = String(Number(stage.dataset.renderFrames ?? 0) + 1);
    if ((playing && !reduceMotion) || pressedNavigationKeys.size || cameraChanged || tweening) scheduleAnimation();
    else if (animationFrame === undefined) stage.dataset.animationState = "idle";
  } catch (error) {
    console.error("Bounder WebGL rendering stopped", error);
    handleWebGLRuntimeFailure({ terminal: true });
    return;
  }
};

const scheduleAnimation = () => {
  if (animationFrame === undefined && rendererOperational && bootstrapSettled && !document.hidden && stageVisible && !stage.classList.contains("is-explaining")) {
    animationFrame = requestAnimationFrame(animate);
    stage.dataset.animationState = "scheduled";
  }
};

const stopAnimation = (state = "stopped") => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  stage.dataset.animationState = state;
};

const qualityControl = root.querySelector("select[data-render-quality]");
const webglFallbackMessage = stage.querySelector(".webgl-fallback");
const webglFallbackDefaultText = webglFallbackMessage?.textContent ?? "";
let rendererTerminal = false;

// A lost or failed renderer fails closed: the scene hides, playback and every scene-dependent
// control stop, and the panel states that no command authority exists. Recorded receipts stay
// inspectable through the scenario buttons, which only update the DOM panel. A lost context is
// kept intact (three.js restores it); only a terminal failure disposes the renderer.
const handleWebGLRuntimeFailure = ({ terminal = false } = {}) => {
  if (terminal) rendererTerminal = true;
  if (!rendererOperational) {
    if (terminal) {
      controls.dispose();
      releaseCanvasInput();
      renderer.dispose();
    }
    return;
  }
  const focusedElement = document.activeElement;
  const shouldMoveFocus = focusedElement instanceof Element && (
    focusedElement === canvas ||
    operatorTour.contains(focusedElement) ||
    focusedElement.matches("[data-action='play'], [data-action='fleet'], [data-action='tour'], [data-camera], select[data-render-quality], [data-resilience-action], [data-resilience-scrubber], .resilience-scenario")
  );
  rendererOperational = false;
  cameraTween = undefined;
  stopAnimation("unavailable");
  controls.enabled = false;
  for (const button of root.querySelectorAll("[data-camera]")) button.disabled = true;
  qualityControl.disabled = true;
  if (terminal) {
    // Release the input surface. controls.dispose() removes the canvas pointer/wheel/contextmenu
    // listeners and the capturing document keydown, and restores touch-action to auto, so the dead
    // canvas stops swallowing touch scrolling and keyboard input while the page says it is paused.
    controls.dispose();
    releaseCanvasInput();
    renderer.dispose();
  }
  setPlaying(false);
  releaseNavigationKeys();
  clearResilienceTransport();
  playButton.disabled = true;
  fleetButton.disabled = true;
  tourButton.disabled = true;
  setScenarioControlsEnabled(receiptsByScenario.size > 0);
  for (const button of root.querySelectorAll("[data-scenario]")) button.setAttribute("aria-pressed", "false");
  setResilienceControlsEnabled(false);
  closeOperatorTour({ restoreFocus: false });
  stage.classList.remove("is-ready");
  stage.classList.add("is-unavailable");
  stage.dataset.webgl = terminal ? "runtime-error" : "context-lost";
  stage.dataset.failClosed = "true";
  if (webglFallbackMessage) {
    webglFallbackMessage.textContent = terminal
      ? "The 3D view stopped. Recorded receipts remain available from the scenario buttons; reload the page to restart the scene."
      : "The 3D view was interrupted and will resume if the browser restores it. Recorded receipts remain available from the scenario buttons.";
  }
  phaseElement.textContent = "Simulation paused";
  statusCode.textContent = "renderer_unavailable";
  outcomeElement.textContent = "Unavailable";
  delete outcomeElement.dataset.outcome;
  decisionCode.textContent = "renderer_unavailable";
  reasonElement.textContent = terminal
    ? "The 3D renderer stopped. Bounder retained no command authority."
    : "The rendering context was lost. Bounder retained no command authority.";
  adapterOutput.textContent = "No command authority";
  setRulesUnavailable();
  if (shouldMoveFocus) focusWithoutScroll(receiptSummary);
};

const recoverRenderer = () => {
  if (rendererOperational || rendererTerminal) return;
  rendererOperational = true;
  controls.enabled = true;
  for (const button of root.querySelectorAll("[data-camera]")) button.disabled = false;
  qualityControl.disabled = false;
  stage.classList.remove("is-unavailable");
  stage.classList.add("is-ready");
  stage.dataset.webgl = "ready";
  if (webglFallbackMessage) webglFallbackMessage.textContent = webglFallbackDefaultText;
  const receiptsReady = receiptsByScenario.size > 0;
  if (receiptsReady) {
    delete stage.dataset.failClosed;
    playButton.disabled = false;
    setScenarioControlsEnabled(true);
  }
  if (receiptsReady && fleetEvidence) {
    fleetButton.disabled = false;
    tourButton.disabled = false;
    setResilienceControlsEnabled(true);
  }
  if (resilienceMode && selectedResilience) selectResilienceScenario(selectedResilience.id);
  else if (currentReceipt) selectScenario(selectedScenario, { camera: "none" });
  lastTime = 0;
  resize();
  scheduleAnimation();
};

const leaveResilienceMode = () => {
  clearResilienceTransport();
  resilienceMode = false;
  selectedResilience = undefined;
  markAffectedGuardians("");
  for (const button of resilienceScenarios.querySelectorAll("button")) button.setAttribute("aria-pressed", "false");
  playButton.disabled = !rendererOperational;
};

for (const button of root.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => {
    userSelectedScenario = true;
    leaveOperatorTour();
    leaveResilienceMode();
    // With the renderer lost this only updates the receipt panel; the hidden scene is redrawn
    // from the same state if the browser restores the context.
    selectScenario(button.dataset.scenario);
    syncSelectionURL();
  });
}

let reducedMotionPlayToken = 0;
playButton.addEventListener("click", () => {
  if (!rendererOperational || !currentReceipt) return;
  userSelectedScenario = true;
  const presentation = scenarioPresentation[selectedScenario];
  if (!playing && progress >= presentation.stop) {
    progress = 0;
    deniedTime = 0;
    setEnvelopeHeld(false);
    setDecision(currentReceipt, presentation, false);
  }
  setPlaying(!playing);
  if (playing && reduceMotion) {
    // Reduced motion: no flight. Show the start state, then jump to the recorded decision.
    const token = ++reducedMotionPlayToken;
    const scenarioAtStart = selectedScenario;
    window.setTimeout(() => {
      if (!playing || token !== reducedMotionPlayToken || selectedScenario !== scenarioAtStart || !currentReceipt) return;
      progress = presentation.stop;
      deniedTime = 0;
      setDecision(currentReceipt, presentation, true);
      setEnvelopeHeld(!currentReceipt.allowed);
      setPlaying(false);
      scheduleAnimation();
    }, 1200);
  }
  scheduleAnimation();
});
fleetButton.addEventListener("click", () => {
  if (!fleetEvidence) return;
  setFleetMode(!fleetMode);
  if (operatorTour.hidden && userSelectedScenario) syncSelectionURL();
});
tourButton.addEventListener("click", () => operatorTour.hidden ? openOperatorTour() : closeOperatorTour());
operatorTour.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || operatorTour.hidden) return;
  event.preventDefault();
  closeOperatorTour();
});
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
  // preventDefault lets the browser restore the context; three.js re-initialises its GL state.
  event.preventDefault();
  handleWebGLRuntimeFailure();
});
canvas.addEventListener("webglcontextrestored", () => {
  // Wait for three.js's own restore handler, registered first, to rebuild its GL state.
  window.setTimeout(recoverRenderer, 0);
});
new ResizeObserver(resize).observe(stage);

// Scenario buttons only change the receipt panel and the scene state, so they stay usable for
// recorded receipts while the renderer is lost.
const setScenarioControlsEnabled = (enabled) => {
  const available = Boolean(enabled);
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
  fleetSource.textContent = "Fleet evidence unavailable · the recorded receipts remain available";
  fleetSource.dataset.source = "unavailable";
  for (const field of Object.values(fleetFields)) {
    field.textContent = "Unavailable";
    field.removeAttribute("title");
  }
  // Fault replay needs the Fleet evidence; say so instead of opening onto an empty panel.
  const faultReplay = root.querySelector("#fault-replay");
  let note = faultReplay?.querySelector("[data-resilience-unavailable]");
  if (faultReplay && !note) {
    note = document.createElement("p");
    note.className = "evidence-unavailable";
    note.dataset.resilienceUnavailable = "";
    faultReplay.append(note);
  }
  if (note) {
    note.textContent = "Fault replay is unavailable because the recorded Fleet evidence could not be loaded. Scenario receipts remain available above.";
    note.hidden = false;
  }
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
      selectScenario(expectedScenarioIDs.includes(requestedScenario) ? requestedScenario : "safe", { camera: "cut" });
      // A shared scenario or fault link lands on the workspace, unless the visitor has already
      // scrolled or moved focus.
      if ((requestedScenario || requestedResilience) && initialParameters.get("tour") !== "1" && initialParameters.get("embed") !== "1") {
        const workspace = root.querySelector("#scenario-workspace") ?? stage;
        const untouched = window.scrollY <= 40 && (!document.activeElement || document.activeElement === document.body);
        if (untouched) window.scrollTo({ top: Math.max(0, workspace.getBoundingClientRect().top + window.scrollY - 16), behavior: "instant" });
      }
    } else if (receiptReady) {
      setScenarioControlsEnabled(true);
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
      if (userSelectedScenario) {
        // The visitor chose a scenario, fault or Play while Fleet evidence loaded; keep it.
        if (initialParameters.get("fleet") === "1" && !fleetMode) setFleetMode(true);
      } else if (initialParameters.get("tour") === "1") {
        openOperatorTour(initialParameters.get("step"), { reveal: "landing" });
      } else if (fleetEvidence.resilience.scenarios.some(({ id }) => id === requestedResilience)) {
        selectResilienceScenario(requestedResilience);
        setFleetMode(initialParameters.get("fleet") === "1");
      } else if (expectedScenarioIDs.includes(requestedScenario)) {
        setFleetMode(initialParameters.get("fleet") === "1");
      } else {
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
// A drag takes over from any scripted camera move.
controls.addEventListener('start', () => { cameraTween = undefined; });
document.fonts?.ready.then(() => {
  redrawWorldLabels();
  layoutWorldLabels(stage.clientHeight);
  scheduleAnimation();
}).catch(() => {});

// These views change presentation only; they never change receipt inputs or outcomes.
const viewButtons = [...root.querySelectorAll('[data-camera]')];
const setCameraView = (view) => {
  if (!rendererOperational) return;
  if (view === 'top') {
    moveCamera(new THREE.Vector3(0, 31, .1), new THREE.Vector3(0, 0, 0));
  } else if (view === 'focus') {
    moveCamera(drone.position.clone().add(new THREE.Vector3(9, 8, 11)), drone.position.clone());
  } else {
    moveCamera(OVERVIEW_POSE.position, OVERVIEW_POSE.target);
  }
  stage.dataset.cameraView = view;
  viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.camera === view)));
};
viewButtons.forEach((button) => {
  button.disabled = false;
  button.addEventListener('click', () => setCameraView(button.dataset.camera));
});
qualityControl.addEventListener('change', () => {
  if (!rendererOperational) return;
  const low = qualityControl.value === 'low';
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.5));
  // Toggling only shadowMap.enabled leaves compiled shaders sampling a stale shadow map.
  // Changing the sun's castShadow changes the lights state, which recompiles every lit material
  // with or without shadows.
  renderer.shadowMap.enabled = !low;
  sun.castShadow = !low;
  renderer.shadowMap.needsUpdate = true;
  stage.dataset.renderQuality = low ? 'low' : 'standard';
  resize();
});
root.querySelector('#fault-replay').addEventListener('toggle', (event) => {
  if (!rendererOperational || !fleetEvidence || !receiptsByScenario.size) return;
  if (event.target.open && !resilienceMode) {
    selectResilienceScenario(selectedResilience?.id ?? fleetEvidence.resilience.scenarios[0].id);
  } else if (!event.target.open && resilienceMode) {
    // Closing Fault replay hands the scene back to the scenario shown before it opened.
    leaveOperatorTour();
    leaveResilienceMode();
    selectScenario(scenarioBeforeResilience ?? "safe");
    syncSelectionURL();
  }
});

bootstrap().catch((error) => {
  console.error("Bounder simulator bootstrap could not fail closed", error);
});
