const stage = document.querySelector(".simulator-stage");
const forceAccessibleFallback = new URLSearchParams(window.location.search).get("webgl") === "off";
let embeddedHeightObserver;

const reportEmbeddedHeight = () => {
  if (window.parent !== window) {
    window.parent.postMessage({
      type: "bounder-simulator-height",
      height: document.documentElement.scrollHeight
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

const startAccessibleFallback = async () => {
  stage.classList.remove("is-ready");
  stage.classList.add("is-unavailable");
  stage.dataset.webgl = "unavailable";
  try {
    await import("./simulator-fallback.js");
  } catch (error) {
    stage.dataset.webgl = "fallback-error";
    stage.dataset.receiptsReady = "false";
    console.error("Bounder accessible evidence view could not start", error);
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
