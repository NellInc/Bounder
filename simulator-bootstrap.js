// Browser entry for the simulator page. It chooses the WebGL or the accessible evidence
// view and owns the embedded-height report; it never grants authority on any path.
const stage = document.querySelector(".simulator-stage");
const forceAccessibleFallback = new URLSearchParams(window.location.search).get("webgl") === "off";
let embeddedHeightObserver;

// Measure the content, not the frame. Inside an iframe the root element's scrollHeight is
// never smaller than the iframe's own viewport, so reporting it lets the parent grow the
// frame but never shrink it again after a disclosure closes. The body has no margin and
// no height or min-height in embed mode, so its box is exactly the content height.
const embeddedContentHeight = () => Math.ceil(document.body.getBoundingClientRect().height);

const reportEmbeddedHeight = () => {
  if (window.parent !== window) {
    window.parent.postMessage({
      type: "bounder-simulator-height",
      height: embeddedContentHeight()
    }, window.location.origin);
  }
};

const startEmbeddedHeightReporting = () => {
  if (window.parent === window) return;
  reportEmbeddedHeight();
  window.addEventListener("load", reportEmbeddedHeight, { once: true });
  if (typeof ResizeObserver === "function") {
    try {
      embeddedHeightObserver = new ResizeObserver(reportEmbeddedHeight);
      embeddedHeightObserver.observe(document.body);
    } catch (error) {
      console.warn("Bounder could not observe embedded simulator height changes", error);
    }
  }
};

// Last resort when no evidence view can start. It imports nothing, so it cannot fail the
// same way: every panel resolves to an explicit unavailable state with no command
// authority, every control stays disabled, and the only offered recovery is a reload.
const showBootstrapUnavailable = () => {
  const root = stage.closest(".simulator-workbench") ?? document;
  const setText = (selector, text) => {
    for (const element of root.querySelectorAll(selector)) element.textContent = text;
  };
  stage.dataset.webgl = "fallback-error";
  stage.dataset.receiptsReady = "false";
  stage.dataset.fleetReady = "false";
  stage.dataset.failClosed = "true";
  setText(".status-phase", "Evidence unavailable");
  setText(".status-code, .decision-code", "bootstrap_unavailable");
  setText(".decision-outcome", "Unavailable");
  setText(".receipt-source", "Simulator files unavailable");
  setText(".decision-reason", "The simulator files could not be loaded. Reload the page to try again. Bounder retained no command authority.");
  setText(".adapter-output", "No command authority");
  setText(".rule-stack strong", "UNAVAILABLE");
  setText("[data-receipt], [data-fleet]", "Unavailable");
  setText("[data-fleet-source]", "Fleet evidence unavailable · the simulator files could not be loaded");
  for (const control of root.querySelectorAll("[data-scenario], [data-action], [data-camera], [data-render-quality], [data-resilience-action], [data-resilience-scrubber]")) {
    control.disabled = true;
    if (control.hasAttribute("aria-pressed")) control.setAttribute("aria-pressed", "false");
  }
  const notice = stage.querySelector(".webgl-fallback:not(.noscript-fallback)");
  if (notice) {
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload the simulator";
    reload.addEventListener("click", () => window.location.reload());
    notice.replaceChildren("The simulator could not load. Reload the page to try again.", reload);
  }
};

const startAccessibleFallback = async () => {
  stage.classList.remove("is-ready");
  stage.classList.add("is-unavailable");
  stage.dataset.webgl = "unavailable";
  try {
    await import("./simulator-fallback.js");
  } catch (error) {
    console.error("Bounder accessible evidence view could not start", error);
    // simulator-fallback.js marks the stage as its first statement. When the mark is absent,
    // nothing from the view has run (its own fetch or a dependency failed), so one retry
    // under a fresh URL is safe: it re-fetches a dropped entry request without re-running any
    // side effects. A dependency failure stays cached by the module map and fails again,
    // which falls through to the self-contained unavailable state below. The WebGL entry is
    // never retried, because it may already have created a renderer.
    if (stage.dataset.fallbackStarted !== "true") {
      try {
        await import("./simulator-fallback.js?retry=1");
        return;
      } catch (retryError) {
        console.error("Bounder accessible evidence view could not start on retry", retryError);
      }
    }
    showBootstrapUnavailable();
  }
};

if (forceAccessibleFallback) {
  await startAccessibleFallback();
} else {
  try {
    await import("./simulator.js");
    if (stage.dataset.webgl !== "runtime-error") stage.dataset.webgl = "ready";
  } catch (error) {
    console.warn("Bounder simulator is using its accessible evidence view", error);
    await startAccessibleFallback();
  }
}

startEmbeddedHeightReporting();
