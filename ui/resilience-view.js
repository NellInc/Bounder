import { resolveAffectedGuardianIDs } from "../runtime/resilience/contracts.js";

export const CONTINUITY_FRAMES = Object.freeze({
  "coherent-snapshot-rollback": Object.freeze([
    Object.freeze({ status: "Floors agree", local: "Current durable receipt floor", fleet: "Matching signed receipt floor", lease: "05:00 signed", authority: "ACTIVE", held: false }),
    Object.freeze({ status: "Rollback exposed", local: "Coherent older snapshot", fleet: "Newer signed receipt floor", lease: "Revoked", authority: "FROZEN", held: true }),
    Object.freeze({ status: "Durable hold", local: "Rollback marker persisted", fleet: "Recorded signed proof", lease: "None", authority: "HOLD", held: true }),
    Object.freeze({ status: "Reconciliation required", local: "Awaiting floor adoption", fleet: "Hold receipt recorded", lease: "New policy required", authority: "HOLD", held: true })
  ]),
  "continuity-lease-expiry": Object.freeze([
    Object.freeze({ status: "Lease current", local: "Durable floors coherent", fleet: "Matching signed floors", lease: "05:00 signed", authority: "ACTIVE", held: false }),
    Object.freeze({ status: "Lease elapsed", local: "Durable floors coherent", fleet: "Last signed floor retained", lease: "00:00 expired", authority: "FROZEN", held: true }),
    Object.freeze({ status: "Offline authority ended", local: "Expiry hold persisted", fleet: "Reconnection pending", lease: "Expired", authority: "HOLD", held: true }),
    Object.freeze({ status: "Fresh checkpoint required", local: "No authority restored", fleet: "Hold receipt recorded", lease: "Renewal required", authority: "HOLD", held: true })
  ])
});

// Recorded codes break only after an underscore, so a narrow timeline never splits a word.
// The element's text stays exactly the recorded code.
export const appendBreakableCode = (element, value) => {
  String(value).split(/(?<=_)/).forEach((part, index) => {
    if (index) element.append(document.createElement("wbr"));
    element.append(part);
  });
};

export const renderResilienceTimeline = (container, scenario, cursor) => {
  if (!scenario) return;
  const fragment = document.createDocumentFragment();
  scenario.events.forEach((event, index) => {
    const item = document.createElement("li");
    item.className = "resilience-event";
    item.classList.toggle("is-reached", index <= cursor);
    item.classList.toggle("is-current", index === cursor);
    if (index === cursor) item.setAttribute("aria-current", "step");
    item.classList.toggle("is-fault", event.status === "fault");
    item.classList.toggle("is-held", event.status === "held");
    const time = document.createElement("time");
    time.textContent = `${(event.at_ms / 1000).toFixed(2)} s`;
    const label = document.createElement("b");
    label.textContent = event.kind;
    const code = document.createElement("code");
    appendBreakableCode(code, event.code);
    item.title = event.message;
    item.append(time, label, code);
    fragment.append(item);
  });
  container.replaceChildren(fragment);
};

export const renderContinuityProof = (container, fields, scenario, cursor) => {
  const frames = scenario && CONTINUITY_FRAMES[scenario.id];
  container.hidden = !frames;
  if (!frames) return;
  const frame = frames[Math.max(0, Math.min(cursor, frames.length - 1))];
  container.classList.toggle("is-held", frame.held);
  container.dataset.checkpointState = frame.held ? "held" : "verified";
  fields["checkpoint-status"].textContent = frame.status;
  fields["local-floor"].textContent = frame.local;
  fields["fleet-floor"].textContent = frame.fleet;
  fields.lease.textContent = frame.lease;
  fields.authority.textContent = frame.authority;
};

export const markAffectedGuardians = (fleetNodes, device, aliases) => {
  const nodes = [...fleetNodes.querySelectorAll(".fleet-node")];
  const guardianIDs = nodes.map((node) => node.dataset.deviceId);
  const affected = device ? new Set(resolveAffectedGuardianIDs(device, guardianIDs, aliases)) : new Set();
  for (const node of nodes) {
    const isAffected = affected.has(node.dataset.deviceId);
    node.classList.toggle("is-affected", isAffected);
    node.setAttribute("aria-label", `${node.dataset.baseLabel}${isAffected ? "; affected by selected fault" : ""}`);
  }
};
