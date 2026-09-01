export const MAX_JSON_DEPTH = 32;

export class DuplicateJsonMemberError extends Error {
  constructor(message = "duplicate JSON member") {
    super(message);
    this.name = "DuplicateJsonMemberError";
  }
}

export function rejectDuplicateJsonMembers(source, maxDepth = MAX_JSON_DEPTH) {
  if (typeof source !== "string") throw new TypeError("JSON source must be a string");
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 256) {
    throw new TypeError("JSON maximum depth is invalid");
  }

  let index = 0;
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const syntaxError = () => { throw new SyntaxError("invalid JSON"); };
  const skipWhitespace = () => {
    while (index < source.length && /[\t\n\r ]/.test(source[index])) index += 1;
  };
  const readString = () => {
    if (source[index] !== '"') syntaxError();
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      if (character === "\\") {
        index += 1;
        if (index >= source.length) syntaxError();
        if (source[index] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5))) syntaxError();
          index += 5;
        } else if ('"\\/bfnrt'.includes(source[index])) {
          index += 1;
        } else {
          syntaxError();
        }
      } else {
        if (source.charCodeAt(index) <= 0x1f) syntaxError();
        index += 1;
      }
    }
    syntaxError();
  };
  const scanValue = (depth) => {
    if (depth > maxDepth) syntaxError();
    skipWhitespace();
    const character = source[index];
    if (character === "{") {
      index += 1;
      const names = new Set();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        skipWhitespace();
        const name = readString();
        if (names.has(name)) throw new DuplicateJsonMemberError();
        names.add(name);
        skipWhitespace();
        if (source[index] !== ":") syntaxError();
        index += 1;
        scanValue(depth + 1);
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") syntaxError();
        index += 1;
      }
      syntaxError();
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (index < source.length) {
        scanValue(depth + 1);
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") syntaxError();
        index += 1;
      }
      syntaxError();
    }
    if (character === '"') {
      readString();
      return;
    }
    numberPattern.lastIndex = index;
    const number = numberPattern.exec(source);
    if (number) {
      index = numberPattern.lastIndex;
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (source.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    syntaxError();
  };

  scanValue(0);
  skipWhitespace();
  if (index !== source.length) syntaxError();
}

export function parseUniqueJson(source, maxDepth = MAX_JSON_DEPTH) {
  rejectDuplicateJsonMembers(source, maxDepth);
  return JSON.parse(source);
}
