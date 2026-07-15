const stage = document.querySelector(".simulator-stage");
const forceAccessibleFallback = new URLSearchParams(window.location.search).get("webgl") === "off";

const startAccessibleFallback = async () => {
  stage.classList.remove("is-ready");
  stage.classList.add("is-unavailable");
  stage.dataset.webgl = "unavailable";
  await import("./simulator-fallback.js");
};

if (forceAccessibleFallback) {
  await startAccessibleFallback();
} else {
  try {
    await import("./simulator.js");
    stage.dataset.webgl = "ready";
  } catch (error) {
    if (stage.classList.contains("is-ready")) {
      console.error("Bounder simulator stopped after WebGL initialization", error);
      stage.dataset.webgl = "runtime-error";
    } else {
      console.warn("Bounder simulator is using its accessible evidence view", error);
      await startAccessibleFallback();
    }
  }
}
