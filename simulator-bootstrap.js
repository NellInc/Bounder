// Browser entry for the simulator page. It chooses the WebGL or the accessible evidence
// view and owns the embedded-height report; it never grants authority on any path.
const stage = document.querySelector(".simulator-stage");
// Proof for ui/workbench.js that this entry ran; without it the page load ends in the
// explicit unavailable state rather than waiting on "Evidence loading" for ever.
stage.dataset.bootstrap = "started";
const forceAccessibleFallback = new URLSearchParams(window.location.search).get("webgl") === "off";
// The stage notice is hidden until the scene is known to be slow or unavailable.
const stageNotice = stage.querySelector(".webgl-fallback:not(.noscript-fallback)");
const SLOW_START_MS = 20_000;
const BROWSER_TOO_OLD_MESSAGE = "This browser cannot run the 3D scene (it needs Safari 16.4, Firefox 108, Chrome 89 or later). Every recorded decision remains available.";

// True when the failure is this browser lacking import maps, which the 3D view needs. Chrome
// 89-95 support import maps without HTMLScriptElement.supports, so without that API only an
// unresolved bare "three" specifier counts; any other failure keeps the generic wording.
const importMapsUnsupported = (error, scriptElement = globalThis.HTMLScriptElement) => {
  if (typeof scriptElement?.supports === "function") return !scriptElement.supports("importmap");
  return error instanceof TypeError && /["“]three["”]/.test(String(error.message));
};
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
  // The parent may start listening after the first report, so it asks for one when it does.
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type === "bounder-simulator-height-request") reportEmbeddedHeight();
  });
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
  // The notice and its reload button replace the text view: nothing loaded that it could describe.
  const explanation = stage.querySelector(".scene-explanation");
  if (explanation) explanation.hidden = true;
  stage.classList.remove("is-explaining", "is-slow");
  const textView = root.querySelector("[data-explanation]");
  if (textView) {
    textView.disabled = true;
    textView.setAttribute("aria-pressed", "false");
  }
  if (stageNotice) {
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload the simulator";
    reload.addEventListener("click", () => window.location.reload());
    stageNotice.replaceChildren("The simulator could not load. Reload the page to try again.", reload);
  }
};

// A request that never completes never rejects, so after a long wait the stage says the scene
// is still loading and offers a reload. It starts nothing else: a late module may already own
// a renderer. The notice clears as soon as the import settles either way.
const withSlowStartNotice = async (load) => {
  const defaultNotice = stageNotice ? [...stageNotice.childNodes] : [];
  const timer = window.setTimeout(() => {
    if (!stageNotice) return;
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload the simulator";
    reload.addEventListener("click", () => window.location.reload());
    stageNotice.replaceChildren("The 3D scene is still loading. On a slow connection this can take a while.", reload);
    stage.classList.add("is-slow");
  }, SLOW_START_MS);
  try {
    return await load();
  } finally {
    window.clearTimeout(timer);
    if (stage.classList.contains("is-slow")) {
      stage.classList.remove("is-slow");
      stageNotice?.replaceChildren(...defaultNotice);
    }
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
    await withSlowStartNotice(() => import("./simulator.js"));
    if (stage.dataset.webgl !== "runtime-error") stage.dataset.webgl = "ready";
  } catch (error) {
    console.warn("Bounder simulator is using its accessible evidence view", error);
    // Set before the view changes, so the text view can say the browser is the cause.
    if (importMapsUnsupported(error)) {
      stage.dataset.webglReason = "browser";
      stageNotice?.replaceChildren(BROWSER_TOO_OLD_MESSAGE);
    }
    await startAccessibleFallback();
  }
}

startEmbeddedHeightReporting();
