import { bootstrapPolicyRoundTrip } from "./policy-panel.js";
import { classifyAuthority, createLatestRequestGate } from "../runtime/policy/presentation-state.js";

export { bootstrapPolicyRoundTrip, classifyAuthority, createLatestRequestGate };

// The UI seam owns mounting the panel. Importing the runtime policy core must stay free of DOM side effects.
if (typeof document !== "undefined") bootstrapPolicyRoundTrip(document);
