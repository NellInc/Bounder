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
}
