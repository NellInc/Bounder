// Presentation only. Recorded receipts keep their producer bytes: codes, reasons and adapter
// outputs are never rewritten in the evidence. These helpers choose the words a visitor reads
// beside that evidence, in plain British English, and fall back to the recorded text whenever
// a string is not one they know, so a producer change can never be hidden behind a stale gloss.

const OUTCOME_HEADLINES = Object.freeze({ allowed: "Request allowed", held: "Request held" });

// Short stage labels keyed by the recorded code. Unknown codes fall back to the outcome alone.
const STAGE_REASONS = Object.freeze({
  allowed: "All checks pass",
  civilian_proximity: "Civilians too close",
  friendly_force_proximity: "Own team too close",
  protected_site: "Protected site",
  humanitarian_corridor_protected: "Humanitarian corridor",
  surrender_protected: "Surrender signalled",
  incapacitated_person_protected: "Incapacitated person",
  positive_identification_required: "Identity unconfirmed",
  proportionality_unconfirmed: "Consequence check unresolved",
  human_authorization_required: "No current human authorisation",
  altitude_above_maximum: "Above the altitude ceiling",
  weather_outside_envelope: "Wind above the limit",
  operating_window_closed: "Outside the operating window",
  transport_unavailable: "Link lost",
  policy_replay: "Replayed policy"
});

// Exact recorded strings mapped to plain en-GB wording. Matching is exact on purpose.
const ADAPTER_GLOSSES = Object.freeze({
  "LOITER authorized; fixture generation has no vehicle channel": "Loiter authorised. No command was sent: this recorded fixture has no vehicle link",
  "Await authorized window": "Wait for the authorised operating window",
  "Hold pending current human authorization": "Hold pending current human authorisation",
  "No new adapter authority": "No new command authority"
});

const REASON_GLOSSES = Object.freeze({
  "current human authorization is required for this action": "current human authorisation is required for this action",
  "policy is not active": "the policy is not active: its operating window is closed",
  "MAVLink transport has no current heartbeat": "the vehicle link (MAVLink) has no current heartbeat"
});

const text = (value) => String(value ?? "").trim();

export const outcomeHeadline = (allowed) => (allowed ? OUTCOME_HEADLINES.allowed : OUTCOME_HEADLINES.held);

export const stageBadge = (receipt) => {
  const outcome = receipt?.allowed ? "Allowed" : "Held";
  const reason = Object.hasOwn(STAGE_REASONS, receipt?.code) ? STAGE_REASONS[receipt.code] : "";
  return reason ? `${outcome} · ${reason}` : outcome;
};

export const glossAdapterOutput = (value) => {
  const recorded = text(value);
  return Object.hasOwn(ADAPTER_GLOSSES, recorded) ? ADAPTER_GLOSSES[recorded] : recorded;
};

export const glossReason = (value) => {
  const recorded = text(value);
  return Object.hasOwn(REASON_GLOSSES, recorded) ? REASON_GLOSSES[recorded] : recorded;
};
