import { bootstrapPolicyRoundTrip, classifyAuthority, createLatestRequestGate } from "../runtime/policy/core.js";

export { bootstrapPolicyRoundTrip, classifyAuthority, createLatestRequestGate };

// The UI seam owns mounting the panel. Importing the runtime policy core must stay free of DOM side effects.
if (typeof document !== "undefined") bootstrapPolicyRoundTrip(document);
