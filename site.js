const embeddedSimulator = document.querySelector("[data-bounder-simulator]");

const MIN_EMBEDDED_SIMULATOR_HEIGHT = 500;
const MIN_EMBEDDED_SIMULATOR_CEILING = 2400;
const MAX_EMBEDDED_SIMULATOR_VIEWPORTS = 8;

// An absurdity guard, not a layout decision. The embedded simulator is several thousand pixels
// tall on a narrow viewport, so a fixed 2400px ceiling would reject every legitimate mobile
// measurement and leave the iframe at its stale CSS height with a nested inner scroll region.
const maxEmbeddedSimulatorHeight = () => Math.max(
  MIN_EMBEDDED_SIMULATOR_CEILING,
  Math.round(window.innerHeight * MAX_EMBEDDED_SIMULATOR_VIEWPORTS)
);

if (embeddedSimulator) {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== embeddedSimulator.contentWindow) return;
    if (event.data?.type !== "bounder-simulator-height") return;
    const height = event.data.height;
    if (!Number.isFinite(height)) return;
    const clamped = Math.min(maxEmbeddedSimulatorHeight(), Math.max(MIN_EMBEDDED_SIMULATOR_HEIGHT, height));
    embeddedSimulator.style.height = `${Math.ceil(clamped)}px`;
  });
  // The frame reports once at start-up and then only on resize. If it loaded before this
  // listener existed, that first report was lost, so ask for a fresh one now and on load.
  const requestEmbeddedHeight = () => {
    embeddedSimulator.contentWindow?.postMessage({ type: "bounder-simulator-height-request" }, window.location.origin);
  };
  embeddedSimulator.addEventListener("load", requestEmbeddedHeight);
  requestEmbeddedHeight();
}

// The live-proof verifier is a module. If it never starts (scripts blocked, a browser
// without module support, or a module that failed to load), the section must not claim
// an in-progress check forever. Deferred and module scripts have all run by the time
// DOMContentLoaded fires, so a root still unmarked then is a verifier that will not run.
const continuityRoot = document.querySelector("[data-continuity]");

if (continuityRoot) {
  document.addEventListener("DOMContentLoaded", () => {
    if (continuityRoot.dataset.continuityStarted === "true" || continuityRoot.dataset.state !== "loading") return;
    continuityRoot.dataset.state = "unavailable";
    continuityRoot.dataset.reason = "unsupported";
    const badge = continuityRoot.querySelector("[data-continuity-state]");
    if (badge) {
      badge.textContent = "Cannot verify here";
      badge.setAttribute("aria-label", "This browser cannot verify the live proof; the recorded run remains available");
    }
    for (const figure of continuityRoot.querySelectorAll(".continuity-metrics dd")) figure.textContent = "—";
    const note = continuityRoot.querySelector("[data-continuity-note]");
    if (note) note.textContent = "This browser could not run the live proof verifier, so no live figures are shown. The recorded 100-Guardian run remains available to inspect.";
  });
}
