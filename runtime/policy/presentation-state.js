import { isPlainObject } from "./primitives.js";
import { parseRFC3339 } from "./contracts.js";

export const createLatestRequestGate = () => {
  let generation = 0;
  let activeController;
  return {
    begin() {
      activeController?.abort();
      activeController = new AbortController();
      const ownGeneration = ++generation;
      return Object.freeze({
        signal: activeController.signal,
        isCurrent: () => ownGeneration === generation
      });
    },
    cancel() {
      generation += 1;
      activeController?.abort();
      activeController = undefined;
    }
  };
};

export const classifyAuthority = (validity, now = Date.now()) => {
  let nowNanoseconds;
  if (typeof now === "string") nowNanoseconds = parseRFC3339(now, "authority evaluation time").epochNanoseconds;
  else if (typeof now === "bigint") nowNanoseconds = now;
  else if (isPlainObject(now) && typeof now.epochNanoseconds === "bigint") nowNanoseconds = now.epochNanoseconds;
  else if (typeof now === "number" && Number.isFinite(now)) nowNanoseconds = BigInt(Math.round(now * 1_000_000));
  else throw new Error("authority evaluation time is invalid");
  const notBefore = typeof validity?.notBeforeNanoseconds === "bigint"
    ? validity.notBeforeNanoseconds
    : BigInt(Math.round(validity?.notBefore * 1_000_000));
  const expiresAt = typeof validity?.expiresAtNanoseconds === "bigint"
    ? validity.expiresAtNanoseconds
    : BigInt(Math.round(validity?.expiresAt * 1_000_000));
  if (nowNanoseconds < notBefore) return "not-yet-valid";
  if (nowNanoseconds >= expiresAt) return "expired";
  return "current";
};
