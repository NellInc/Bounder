import { MAX_JSON_DEPTH, MAX_VECTOR_BYTES, assertSafeInteger, hasUnpairedSurrogate, toBytes } from "../policy/primitives.js";

const normalizedDecimal = (token) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return undefined;
  const [, sign, integer, fraction = "", exponent = "0"] = match;
  let digits = `${integer}${fraction}`.replace(/^0+/, "");
  if (digits === "") return "0e0";
  let scale = BigInt(exponent) - BigInt(fraction.length);
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale += 1n;
  }
  return `${sign}${digits}e${scale}`;
};

export const parseStrictJSON = (input, label = "JSON", { maxBytes = MAX_VECTOR_BYTES } = {}) => {
  assertSafeInteger(maxBytes, "JSON byte limit", { min: 1 });
  let source;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
    source = input;
  } else {
    const bytes = toBytes(input, label);
    if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
    try {
      source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`${label} is not valid UTF-8`);
    }
  }
  if (source.length === 0 || source.charCodeAt(0) === 0xfeff) throw new Error(`${label} is not strict JSON`);

  let offset = 0;
  const fail = (message = "is not strict JSON") => {
    throw new Error(`${label} ${message} at character ${offset}`);
  };
  const whitespace = () => {
    while (source[offset] === " " || source[offset] === "\t" || source[offset] === "\r" || source[offset] === "\n") offset += 1;
  };
  const parseString = () => {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        let value;
        try {
          value = JSON.parse(source.slice(start, offset));
        } catch {
          fail();
        }
        if (hasUnpairedSurrogate(value)) fail("contains an unpaired Unicode surrogate");
        return value;
      }
      if (code < 0x20) fail();
      if (code === 0x5c) {
        offset += 1;
        const escape = source[offset];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset + 1, offset + 5))) fail();
          offset += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape)) fail();
      }
      offset += 1;
    }
    fail("contains an unterminated string");
  };
  const parseValue = (depth) => {
    if (depth > MAX_JSON_DEPTH) fail(`exceeds the ${MAX_JSON_DEPTH}-level nesting limit`);
    whitespace();
    if (source[offset] === '"') return parseString();
    if (source[offset] === "{") {
      offset += 1;
      const result = {};
      const keys = new Set();
      whitespace();
      if (source[offset] === "}") {
        offset += 1;
        return result;
      }
      while (offset < source.length) {
        whitespace();
        if (source[offset] !== '"') fail("has an invalid object key");
        const key = parseString();
        if (keys.has(key)) fail(`contains duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (source[offset] !== ":") fail();
        offset += 1;
        const value = parseValue(depth + 1);
        Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
        whitespace();
        if (source[offset] === "}") {
          offset += 1;
          return result;
        }
        if (source[offset] !== ",") fail();
        offset += 1;
      }
      fail("contains an unterminated object");
    }
    if (source[offset] === "[") {
      offset += 1;
      const result = [];
      whitespace();
      if (source[offset] === "]") {
        offset += 1;
        return result;
      }
      while (offset < source.length) {
        result.push(parseValue(depth + 1));
        whitespace();
        if (source[offset] === "]") {
          offset += 1;
          return result;
        }
        if (source[offset] !== ",") fail();
        offset += 1;
      }
      fail("contains an unterminated array");
    }
    for (const [token, value] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, offset)) {
        offset += token.length;
        return value;
      }
    }
    const number = source.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (!number) fail();
    offset += number.length;
    const value = Number(number);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      fail("contains a non-finite or unsafe number");
    }
    if (normalizedDecimal(number) !== normalizedDecimal(JSON.stringify(value))) {
      fail("contains a lossy or underflowed number");
    }
    return value;
  };

  const value = parseValue(0);
  whitespace();
  if (offset !== source.length) fail("has trailing content");
  return value;
};

export { MAX_VECTOR_BYTES };
