"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Working if browser tools select installed Chrome and never a cached Playwright build.
function findChrome() {
  const explicit = process.env.CHROME;
  const candidates = explicit ? [explicit] : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
          .filter(Boolean).map(root => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
      : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"];
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; }
    catch (error) { if (!["ENOENT", "EACCES"].includes(error.code)) throw error; }
  }
  throw new Error("Installed stable Chrome is required. Install Chrome, then retry; bundled Chromium is not a fallback.");
}
module.exports = { findChrome };
