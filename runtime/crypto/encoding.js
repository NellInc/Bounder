import { MAX_VECTOR_BYTES, assertSafeInteger, toBytes } from "../policy/primitives.js";

export const TRUSTED_FLEET_KEY = Object.freeze({
  id: "creed-fleet-simulation-2026",
  base64: "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw="
});

export const TRUSTED_AUDIT_KEY = Object.freeze({
  id: "bounder-roundtrip-simulation-2026",
  base64: "/RckOFqgx1tk+3jNYC+h2ZH96/drE8WO1wLqyDXp9hg="
});

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

export const decodeBase64 = (value, label, { maxBytes = MAX_VECTOR_BYTES } = {}) => {
  assertSafeInteger(maxBytes, `${label} byte limit`, { min: 1 });
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (typeof value !== "string" || value.length === 0 || value.length > maxEncodedLength || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${label} is not canonical base64`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > maxBytes || bytesToBase64(bytes) !== value) throw new Error(`${label} is not canonical base64`);
  return bytes;
};

export const sha256Hex = async (bytes, cryptoImpl = globalThis.crypto) => {
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto is unavailable");
  const hash = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", toBytes(bytes)));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
