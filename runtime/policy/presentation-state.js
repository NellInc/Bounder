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

const millisecondsToNanoseconds = (value, label) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  const whole = Math.trunc(value);
  return BigInt(whole) * 1_000_000n + BigInt(Math.round((value - whole) * 1_000_000));
};

export const classifyAuthority = (validity, now = Date.now()) => {
  let nowNanoseconds;
  if (typeof now === "string") nowNanoseconds = parseRFC3339(now, "authority evaluation time").epochNanoseconds;
  else if (typeof now === "bigint") nowNanoseconds = now;
  else if (isPlainObject(now) && typeof now.epochNanoseconds === "bigint") nowNanoseconds = now.epochNanoseconds;
  else if (typeof now === "number" && Number.isFinite(now)) nowNanoseconds = millisecondsToNanoseconds(now, "authority evaluation time");
  else throw new Error("authority evaluation time is invalid");
  const notBefore = typeof validity?.notBeforeNanoseconds === "bigint"
    ? validity.notBeforeNanoseconds
    : millisecondsToNanoseconds(validity?.notBefore, "authority notBefore");
  const expiresAt = typeof validity?.expiresAtNanoseconds === "bigint"
    ? validity.expiresAtNanoseconds
    : millisecondsToNanoseconds(validity?.expiresAt, "authority expiresAt");
  if (nowNanoseconds < notBefore) return "not-yet-valid";
  if (nowNanoseconds >= expiresAt) return "expired";
  return "current";
};
