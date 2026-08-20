const embeddedSimulator = document.querySelector("[data-bounder-simulator]");

if (embeddedSimulator) {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== embeddedSimulator.contentWindow) return;
    if (event.data?.type !== "bounder-simulator-height") return;
    const height = event.data.height;
    if (Number.isFinite(height) && height >= 500 && height <= 2400) {
      embeddedSimulator.style.height = `${Math.ceil(height)}px`;
    }
  });
}
