import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const collectErrors = (page) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

test("continuity transport and proof lease work with native browser timers", async ({ page }) => {
  await page.goto("/404.html");
  const result = await page.evaluate(async () => {
    const {
      createContinuityLeaseController,
      fetchContinuityEnvelope
    } = await import("/continuity-evidence.js");
    const envelope = await fetchContinuityEnvelope(
      "https://bounder-fleet-continuity-staging.onrender.com/evidence.json",
      {
        fetchImpl: async () => new Response('{"ok":true}', {
          headers: { "content-type": "application/json" }
        })
      }
    );
    const root = document.createElement("section");
    root.innerHTML = `
      <span data-continuity-state></span>
      <span data-continuity-devices></span>
      <span data-continuity-policies></span>
      <span data-continuity-checkpoints></span>
      <span data-continuity-decisions></span>
      <span data-continuity-updated></span>
      <span data-continuity-note></span>
    `;
    const now = Date.parse("2026-08-25T12:00:00Z");
    const controller = createContinuityLeaseController(root, { clock: () => now });
    const shown = controller.showVerified({
      generated_at: "2026-08-25T11:59:00Z",
      expires_at: "2026-08-25T12:15:00Z",
      device_count: 100,
      policies_verified: 100,
      checkpoints_verified: 100,
      allowed: 15,
      held: 85
    });
    controller.dispose();
    return {
      envelope,
      shown,
      state: root.dataset.state,
      devices: root.querySelector("[data-continuity-devices]").textContent
    };
  });

  expect(result).toEqual({ envelope: { ok: true }, shown: true, state: "verified", devices: "100" });
});

test("homepage is responsive and has no detectable accessibility violations", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.route("**/simulator.html?embed=1", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html lang='en'><title>Bounder simulator test placeholder</title><body></body></html>"
  }));
  await page.goto("/");
  await expect(page).toHaveTitle(/Bounder/);
  await expect(page.locator("h1")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("homepage reveal bootstrap keeps content visible across capability and construction failures", async ({ browser }) => {
  test.setTimeout(90_000);
  const cases = [
    // Audit 2026-09: the three failure variants below all reach visibility without a
    // constructed IntersectionObserver, so the production path — observer options,
    // the observe loop, and the "is-revealed" class name at index.html:59-64 — was
    // unpinned. "working observer" is the only variant a real visitor gets.
    {
      name: "working observer",
      context: await browser.newContext(),
      install: async () => {},
      expectsJSClass: true,
      scrollTargets: true
    },
    {
      name: "reduced motion",
      context: await browser.newContext({ reducedMotion: "reduce" }),
      install: async () => {},
      expectsJSClass: false
    },
    {
      name: "missing IntersectionObserver",
      context: await browser.newContext(),
      install: async (page) => page.addInitScript(() => { delete window.IntersectionObserver; }),
      expectsJSClass: false
    },
    {
      name: "observer construction failure",
      context: await browser.newContext(),
      install: async (page) => page.addInitScript(() => {
        Object.defineProperty(window, "IntersectionObserver", {
          configurable: true,
          value: class { constructor() { throw new Error("observer unavailable"); } }
        });
      }),
      expectsJSClass: true
    }
  ];

  try {
    for (const variant of cases) {
      const page = await variant.context.newPage();
      await variant.install(page);
      await page.goto("/");
      await expect(page.locator("html")).toHaveClass(variant.expectsJSClass ? /\bjs\b/ : /^(?!.*\bjs\b)/);
      const targets = page.locator("[data-reveal]");
      const targetCount = await targets.count();
      expect(targetCount, `${variant.name} has reveal targets`).toBeGreaterThan(0);
      if (variant.scrollTargets) {
        // One scroll per task, each awaited: the observer at index.html:62 uses
        // threshold 0.08 with a -10% bottom margin, so every section needs its own
        // rendering opportunity. Batching the scrolls into one evaluateAll would only
        // ever render the final position and leave earlier sections unobserved.
        for (let index = 0; index < targetCount; index += 1) {
          // The stylesheet opts into smooth scrolling, so an animated scroll would still be in
          // flight when the next one retargets it and the element would never be centred.
          await targets.nth(index).evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
          // Intersection observations are computed once per rendering update and delivered in a
          // later task, so give each scroll position a frame of its own before moving on.
          await page.evaluate(() => new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
          }));
        }
      }
      if (variant.expectsJSClass) await expect(page.locator("[data-reveal]:not(.is-revealed)")).toHaveCount(0);
      await expect.poll(
        () => targets.evaluateAll((elements) => elements.every((element) => getComputedStyle(element).opacity === "1")),
        { message: `${variant.name} leaves every target visible` }
      ).toBe(true);
    }
  } finally {
    await Promise.all(cases.map(({ context }) => context.close()));
  }
});

test("homepage accepts only bounded height messages from its simulator frame", async ({ page }) => {
  await page.route("**/simulator.html?embed=1", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html lang='en'><title>Bounder simulator test placeholder</title><body></body></html>"
  }));
  await page.goto("/");
  const frame = page.locator("[data-bounder-simulator]");
  await expect(frame).toHaveAttribute("src", "simulator.html?embed=1");

  const heights = await frame.evaluate((iframe) => {
    const send = (data, { origin = window.location.origin, source = iframe.contentWindow } = {}) => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
      return iframe.style.height;
    };
    const observed = [send({ type: "bounder-simulator-height", height: 701.2 })];
    const ignored = [
      [null, {}],
      [{ type: "other", height: 800 }, {}],
      [{ type: "bounder-simulator-height", height: "malformed" }, {}],
      [{ type: "bounder-simulator-height", height: "701.2" }, {}],
      [{ type: "bounder-simulator-height", height: Number.NaN }, {}],
      [{ type: "bounder-simulator-height", height: Number.POSITIVE_INFINITY }, {}],
      [{ type: "bounder-simulator-height", height: 900 }, { origin: "https://example.invalid" }],
      [{ type: "bounder-simulator-height", height: 900 }, { source: window }]
    ];
    for (const [data, options] of ignored) observed.push(send(data, options));
    // Out-of-range but trusted measurements are clamped, never discarded: a narrow viewport
    // legitimately reports several thousand pixels, and a fixed rejection left the frame clipped.
    observed.push(send({ type: "bounder-simulator-height", height: 499 }));
    observed.push(send({ type: "bounder-simulator-height", height: 2401 }));
    observed.push(send({ type: "bounder-simulator-height", height: 1_000_000 }));
    observed.push(send({ type: "bounder-simulator-height", height: 500 }));
    observed.push(send({ type: "bounder-simulator-height", height: 2400 }));
    return { observed, ceiling: `${Math.max(2400, Math.round(window.innerHeight * 8))}px` };
  });

  expect(heights.observed).toEqual([
    "702px",
    ...Array(8).fill("702px"),
    "500px",
    "2401px",
    heights.ceiling,
    "500px",
    "2400px"
  ]);
});

test("simulator loads recorded evidence and responds to keyboard navigation", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The route-clearance audit is opt-in instrumentation; ordinary visits never run it.
  await page.goto("/simulator.html?scenario=safe&audit=1");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(stage).toHaveAttribute("data-webgl", "ready");
  await expect(stage).toHaveAttribute("data-routes-clear", "true");

  const canvas = page.locator(".simulator-stage canvas");
  await canvas.focus();
  await page.keyboard.down("KeyW");
  await expect(stage).toHaveAttribute("data-last-navigation-key", "KeyW");
  await expect(stage).toHaveAttribute("data-navigation-active", "true");
  await page.getByRole("button", { name: "Play simulation" }).focus();
  await expect(stage).toHaveAttribute("data-navigation-active", "false");

  expect(errors).toEqual([]);
});

test("a vertical touch swipe over the scene scrolls the page without tilting the camera", async ({ browser }) => {
  // A 2x-density software-rendered frame can hold the main thread for over a minute on a loaded host.
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 412, height: 839 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/simulator.html?audit=1");
    const stage = page.locator(".simulator-stage");
    await expect(stage).toHaveAttribute("data-fleet-ready", "true", { timeout: 20_000 });
    await stage.evaluate((element) => element.scrollIntoView({ block: "start" }));
    // The first frame after the stage scrolls into view is a full software-rendered frame at
    // twice the device pixels, which can hold the main thread for several seconds under load.
    await expect(stage).toHaveAttribute("data-camera-polar", /\d/, { timeout: 120_000 });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 }))
    });
    const read = () => stage.evaluate((element) => ({ polar: Number(element.dataset.cameraPolar), azimuth: Number(element.dataset.cameraAzimuth), scrollY: window.scrollY }));
    const box = await page.locator(".simulator-stage canvas").boundingBox();
    const before = await read();
    // Steps of 5 px or less make the browser deliver pointermoves through its touch slop.
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    await touch("touchStart", [[x, y]]);
    for (let index = 1; index <= 30; index += 1) await touch("touchMove", [[x, y - index * 5]]);
    await touch("touchEnd", []);
    await expect.poll(async () => (await read()).scrollY).toBeGreaterThan(before.scrollY);
    await page.waitForTimeout(1000);
    const after = await read();
    expect(Math.abs(after.polar - before.polar)).toBeLessThan(1);
    // A deliberate horizontal one-finger drag still orbits. The swipe above scrolled the stage
    // partly out of view, so bring it back before touching its centre.
    // An instant scroll, repeated until any fling from the swipe has settled.
    await expect.poll(async () => {
      await stage.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.waitForTimeout(250);
      return Math.round((await page.locator(".simulator-stage canvas").boundingBox()).y);
    }).toBeGreaterThanOrEqual(-1);
    const box2 = await page.locator(".simulator-stage canvas").boundingBox();
    const hx = box2.x + box2.width * 0.3;
    const hy = box2.y + box2.height / 2;
    await touch("touchStart", [[hx, hy]]);
    for (let index = 1; index <= 20; index += 1) await touch("touchMove", [[hx + index * 5, hy]]);
    await touch("touchEnd", []);
    await expect.poll(async () => Math.abs((await read()).azimuth - after.azimuth)).toBeGreaterThan(5);
  } finally {
    await context.close();
  }
});

test("guided tour traverses all six proofs and restores focus when finished", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/simulator.html?scenario=safe");
  const root = page.locator(".simulator-workbench");
  const tour = page.locator("[data-operator-tour]");
  const tourButton = page.getByRole("button", { name: "Guided tour" });
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-fleet-ready", "true", { timeout: 20_000 });
  await tourButton.click();
  await expect(tour).toBeVisible();

  const steps = [
    ["signed-baseline", "Inspect the recorded baseline", "allowed"],
    ["fleet-projection", "Project one rule across the fleet", "allowed"],
    ["civilian-protection", "Protect civilians at the final boundary", "civilian_proximity"],
    ["friendly-separation", "Keep clear of the operator’s own teams", "friendly_force_proximity"],
    ["evidence-only-roe", "Keep high-consequence evidence non-authoritative", "surrender_protected"],
    ["rollback-proof", "Reject a coherent older snapshot", "ready"]
  ];

  for (const [index, [id, title, decision]] of steps.entries()) {
    await expect(root).toHaveAttribute("data-operator-tour-step", id);
    await expect(page.locator('[data-tour="position"]')).toHaveText(`Step ${index + 1} of 6`);
    await expect(page.locator('[data-tour="title"]')).toHaveText(title);
    await expect(page.locator(".decision-code")).toHaveText(decision);
    if (id === "friendly-separation") {
      await expect(page.locator('[data-tour="proof"]')).toContainText("changes to HOLD");
      await expect(page.locator('[data-tour="proof"]')).not.toContainText("DENY");
    }
    await expect.poll(() => new URL(page.url()).searchParams.get("step")).toBe(id);
    if (index < steps.length - 1) await page.getByRole("button", { name: "Next proof" }).click();
  }

  await expect(page.locator(".fleet-control-panel")).toHaveClass(/is-active/);
  await expect(page.getByRole("button", { name: "Finish tour" })).toBeFocused();
  await page.getByRole("button", { name: "Finish tour" }).click();
  await expect(tour).toBeHidden();
  await expect(page.getByRole("button", { name: "Guided tour" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Guided tour" })).toHaveAttribute("aria-expanded", "false");
  await expect(root).not.toHaveAttribute("data-operator-tour-step", /.+/);
  expect(new URL(page.url()).searchParams.has("tour")).toBe(false);
  expect(new URL(page.url()).searchParams.has("step")).toBe(false);
});

test("receipt failure pauses the simulator without granting authority", async ({ page }) => {
  await page.route("**/data/bounder-receipts.v1.json", (route) => route.abort("failed"));
  await page.goto("/simulator.html?webgl=off");
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-receipts-ready", "false");
  await expect(page.locator(".decision-code")).toHaveText("fixture_unavailable");
  await expect(page.locator(".adapter-output")).toHaveText("No command authority");
  await expect(page.getByRole("button", { name: "Play simulation" })).toBeDisabled();
  // Nothing was evaluated: no receipt cell keeps its loading text and no rule takes the pass style.
  await expect(page.locator("[data-receipt]").filter({ hasText: "Loading" })).toHaveCount(0);
  await expect(page.locator(".rule-stack li.is-pass")).toHaveCount(0);
});

test("receipt failure in the 3D view resolves every receipt cell and rule to unavailable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/data/bounder-receipts.v1.json", (route) => route.abort("failed"));
  await page.goto("/simulator.html");
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-receipts-ready", "false");
  await expect(page.locator(".decision-code")).toHaveText("fixture_unavailable");
  await expect(page.locator("[data-receipt]").filter({ hasText: "Loading" })).toHaveCount(0);
  await expect(page.locator(".rule-stack li.is-pass")).toHaveCount(0);
  await expect(page.locator(".rule-stack li.is-unavailable")).toHaveCount(14);
});

test("receipt readiness cannot be inferred from faster Fleet loading", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let releaseReceipt;
  const receiptGate = new Promise((resolve) => { releaseReceipt = resolve; });
  await page.route("**/data/bounder-receipts.v1.json", async (route) => {
    await receiptGate;
    await route.continue();
  });
  await page.goto("/simulator.html?scenario=safe");
  const stage = page.locator(".simulator-stage");
  try {
    await expect(stage).toHaveAttribute("data-fleet-ready", "true");
    await expect(stage).toHaveAttribute("data-receipts-ready", "false");
    // Isolate receipt readiness from software-GPU rendering while testing the real text view.
    await page.getByRole("button", { name: "Text view", exact: true }).click();
    await expect(page.getByRole("button", { name: "Play simulation" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Civilian buffer" })).toBeDisabled();
  } finally {
    releaseReceipt();
  }
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(page.getByRole("button", { name: "Civilian buffer" })).toBeEnabled();
});

test("malformed Fleet evidence is isolated from valid local receipt controls", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/data/bounder-fleet-evidence.v1.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ version: "malformed" })
  }));
  await page.goto("/simulator.html?scenario=safe");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-fleet-ready", "false");
  await expect(page.getByRole("button", { name: "Fleet view" })).toBeDisabled();
  await page.locator(".scenario-more > summary").click();
  await expect(page.getByRole("button", { name: "Team separation" })).toBeEnabled();
  await page.getByRole("button", { name: "Team separation" }).click();
  await expect(page.locator(".decision-code")).toHaveText("friendly_force_proximity");
  await expect(page.locator("[data-fleet-source]")).toContainText("Fleet evidence unavailable");
  await expect(page.locator(".fleet-metrics")).not.toContainText("Loading");
  await page.locator("#fault-replay > summary").click();
  await expect(page.locator("#fault-replay [data-resilience-unavailable]")).toBeVisible();
  // The note keeps its download link: the recorded file is the remaining route to the timelines.
  await expect(page.locator("#fault-replay [data-resilience-unavailable] a[href='data/bounder-fleet-evidence.v1.json']")).toBeVisible();
  expect(errors).toEqual([]);
});

test("fault replay re-renders the scene from the recorded timeline, including when scrubbed back", async ({ page }) => {
  // The receipt panel and the 3D envelope must never disagree: each timeline event schedules a
  // frame, the hold applies from the decision onward, and scrubbing back removes it again.
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Tall enough that the scene and the fault-replay controls are on screen together; an
  // offscreen stage correctly suspends rendering, which would hide the frames under test.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto("/simulator.html?resilience=network-partition");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-fleet-ready", "true", { timeout: 20_000 });
  await stage.scrollIntoViewIfNeeded();
  const outcome = page.locator(".decision-outcome");
  await expect(outcome).toHaveText("Ready");
  await expect(outcome).not.toHaveAttribute("data-outcome", /.+/);
  await expect(stage).toHaveAttribute("data-animation-state", "idle");
  const framesBefore = Number(await stage.getAttribute("data-render-frames"));
  const step = page.locator("[data-resilience-action='step']");
  for (let index = 0; index < 3; index += 1) await step.click();
  await expect(outcome).toHaveText("Held safely");
  await expect(outcome).toHaveAttribute("data-outcome", "held");
  await expect.poll(async () => Number(await stage.getAttribute("data-render-frames"))).toBeGreaterThan(framesBefore);
  await expect(page.locator(".legend-bounder").locator("..")).toContainText("Bounder hold");
  await page.locator("[data-resilience-scrubber]").evaluate((element) => {
    element.value = "700";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(outcome).toHaveText("Verifying");
  await expect(outcome).not.toHaveAttribute("data-outcome", /.+/);
  await expect(page.locator(".legend-bounder").locator("..")).toContainText("Bounder envelope");
  expect(errors).toEqual([]);
});

test("an import failure after renderer setup still starts the accessible evidence view", async ({ page }) => {
  const errors = collectErrors(page);
  await page.route("**/simulator.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `document.querySelector(".simulator-stage").classList.add("is-ready"); throw new Error("injected late startup failure");`
  }));
  await page.goto("/simulator.html");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-webgl", "unavailable");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  // The text view stands in for the missing scene and says why; camera controls are withdrawn.
  await expect(page.getByRole("button", { name: "Text view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".scene-renderer-note")).toHaveText("The 3D view is unavailable in this browser, so the text view is shown.");
  await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Civilian buffer" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("the accessible iframe fallback reports height evidence to its parent", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.__bounderHeightMessages = [];
    window.addEventListener("message", (event) => {
      if (event.data?.type !== "bounder-simulator-height") return;
      const iframe = document.querySelector("[data-bounder-simulator]");
      window.__bounderHeightMessages.push({
        height: event.data.height,
        origin: event.origin,
        sourceMatches: event.source === iframe?.contentWindow
      });
    });
  });
  await page.route("**/simulator.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `throw new Error("injected renderer startup failure");`
  }));
  await page.goto("/");
  const iframe = page.locator("[data-bounder-simulator]");
  await iframe.scrollIntoViewIfNeeded();
  const embedded = iframe.contentFrame();
  await expect(embedded.locator(".simulator-stage")).toHaveAttribute("data-webgl", "unavailable");
  await expect(embedded.locator(".simulator-stage")).toHaveAttribute("data-receipts-ready", "true");
  await expect.poll(() => page.evaluate(() => window.__bounderHeightMessages.some((message) => (
    message.origin === window.location.origin &&
    message.sourceMatches &&
    Number.isFinite(message.height) &&
    message.height >= 500
  )))).toBe(true);
});

test("the embedded simulator frame shrinks again after an evidence disclosure closes", async ({ page }) => {
  // The embedded frame builds the full 3D scene, consistent with the other simulator journeys.
  test.setTimeout(90_000);
  await page.goto("/");
  const iframe = page.locator("[data-bounder-simulator]");
  await iframe.scrollIntoViewIfNeeded();
  const embedded = iframe.contentFrame();
  await expect(embedded.locator(".simulator-stage")).toHaveAttribute("data-fleet-ready", /true|false/, { timeout: 20_000 });
  const frameHeight = async () => (await iframe.boundingBox()).height;
  await expect.poll(frameHeight).toBeGreaterThan(400);
  const closed = await frameHeight();
  await embedded.locator("#fleet-evidence > summary").click();
  await expect.poll(frameHeight).toBeGreaterThan(closed + 200);
  const opened = await frameHeight();
  await embedded.locator("#fleet-evidence > summary").click();
  await expect.poll(frameHeight).toBeLessThan(opened - 200);
  expect(Math.abs((await frameHeight()) - closed)).toBeLessThanOrEqual(4);
});

test("when no evidence view can load, the page fails closed and offers only a reload", async ({ page }) => {
  await page.route(/\/simulator(-fallback)?\.js(\?.*)?$/, (route) => route.abort("failed"));
  await page.goto("/simulator.html?scenario=safe");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-webgl", "fallback-error");
  await expect(stage).toHaveAttribute("data-fail-closed", "true");
  await expect(stage).toHaveAttribute("data-fleet-ready", "false");
  await expect(page.locator(".decision-code")).toHaveText("bootstrap_unavailable");
  await expect(page.locator(".adapter-output")).toHaveText("No command authority");
  await expect(page.locator(".webgl-fallback")).toContainText("The simulator could not load.");
  await expect(page.locator(".webgl-fallback")).not.toContainText("remains available");
  await expect(page.getByRole("button", { name: "Reload the simulator" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Civilian buffer" })).toBeDisabled();
  await expect(page.locator(".fleet-metrics")).not.toContainText("Loading");
  // The notice replaces the text view: nothing loaded that it could describe.
  await expect(page.locator(".scene-explanation")).toBeHidden();
  await expect(page.locator(".scene-toolbar")).toBeHidden();
});

test("if the simulator entry itself never loads, the page still fails closed once loaded", async ({ page }) => {
  await page.route("**/simulator-bootstrap.js", (route) => route.abort("failed"));
  await page.goto("/simulator.html");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-webgl", "fallback-error");
  await expect(stage).toHaveAttribute("data-fail-closed", "true");
  await expect(page.locator(".decision-code")).toHaveText("bootstrap_unavailable");
  await expect(page.locator(".adapter-output")).toHaveText("No command authority");
  await expect(page.getByRole("button", { name: "Reload the simulator" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Civilian buffer" })).toBeDisabled();
});

test("while the 3D module loads the stage claims no failure, and a long stall offers a reload", async ({ page }) => {
  await page.clock.install();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/simulator.js", async (route) => { await held; await route.continue(); });
  await page.goto("/simulator.html");
  const stage = page.locator(".simulator-stage");
  const notice = page.locator(".webgl-fallback").first();
  await expect(page.locator(".decision-outcome")).toHaveText("Pending");
  await expect(notice).toBeHidden();
  // The policy panel does not wait for the 3D graph: the bootstrap loads first.
  await expect(page.locator("[data-policy-status] span")).toHaveText("Ready");
  await page.clock.fastForward(21_000);
  await expect(stage).toHaveClass(/\bis-slow\b/);
  await expect(notice).toContainText("The 3D scene is still loading.");
  await expect(page.getByRole("button", { name: "Reload the simulator" })).toBeVisible();
  release();
  await expect(stage).toHaveAttribute("data-webgl", "ready", { timeout: 20_000 });
  await expect(stage).not.toHaveClass(/\bis-slow\b/);
  await expect(notice).toBeHidden();
});

test("a browser without import maps is told why the 3D scene cannot run", async ({ page }) => {
  await page.addInitScript(() => {
    const supports = HTMLScriptElement.supports?.bind(HTMLScriptElement);
    HTMLScriptElement.supports = (type) => (type === "importmap" ? false : Boolean(supports?.(type)));
  });
  await page.route("**/simulator.html", async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace('<script type="importmap">', '<script type="text/plain">')
      .replace(/<link rel="modulepreload"[^>]*>/g, "");
    await route.fulfill({ response, body });
  });
  await page.goto("/simulator.html");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-webgl", "unavailable");
  await expect(stage).toHaveAttribute("data-webgl-reason", "browser");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(page.locator(".scene-renderer-note")).toContainText("it needs Safari 16.4, Firefox 108, Chrome 89 or later");
});

test("a browser without Ed25519 sees a neutral 'cannot verify here', never a rejection", async ({ page }) => {
  await page.addInitScript(() => {
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = (format, key, algorithm, ...rest) => (algorithm?.name === "Ed25519"
      ? Promise.reject(new DOMException("Ed25519 is not supported", "NotSupportedError"))
      : importKey(format, key, algorithm, ...rest));
  });
  await page.goto("/simulator.html#contract-inspector");
  const status = page.locator("[data-policy-status]");
  await expect(status.locator("strong")).toContainText("Safari 17, Firefox 129, or Chrome or Edge 137");
  await page.getByRole("button", { name: "Verify published example" }).click();
  await expect(status).toHaveAttribute("data-state", "unsupported");
  await expect(status.locator("span")).toHaveText("Cannot verify here");
  await expect(page.locator('[data-policy-step="envelope"]')).toHaveAttribute("data-state", "verified");
  await expect(page.locator('[data-policy-step="signature"]')).toHaveAttribute("data-state", "unsupported");
});

test("the accessible evidence view renders recorded Fleet evidence and explains the absent fault replay", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/simulator.html?webgl=off");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-fleet-ready", "true");
  await page.locator("#fleet-evidence > summary").click();
  await expect(page.locator(".fleet-metrics")).not.toContainText("Loading");
  await expect(page.locator("[data-fleet-count]")).toHaveText("100 of 100 recorded Guardians");
  await page.getByLabel("Find a Guardian").fill("allowed");
  await expect(page.locator("[data-fleet-count]")).toHaveText("13 of 100 recorded Guardians");
  await page.locator("#fault-replay > summary").click();
  await expect(page.locator("[data-resilience-unavailable]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("malformed, late, out-of-order and partial resilience streams fall back while stale sources stay inert", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    class TestEventSource {
      constructor(url) {
        this.url = url;
        this.closed = false;
        this.listeners = new Map();
        window.__bounderTestSources ??= [];
        window.__bounderTestSources.push(this);
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }
      close() { this.closed = true; }
      emit(type, data) {
        for (const listener of this.listeners.get(type) ?? []) listener({ data });
      }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: TestEventSource });
  });
  await page.goto("/simulator.html");
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-fleet-ready", "true");
  const events = await page.evaluate(async () => {
    const evidence = await fetch("./data/bounder-fleet-evidence.v1.json").then((response) => response.json());
    return evidence.resilience.scenarios[0].events;
  });
  await page.locator('meta[name="bounder-resilience-stream"]').evaluate((meta) => { meta.content = "/api/resilience/events"; });
  if (await page.locator("#fault-replay").getAttribute("open") === null) await page.locator("#fault-replay > summary").click();
  await page.getByRole("button", { name: "Run fault" }).click();
  const sourceURL = await page.evaluate(() => window.__bounderTestSources[0].url);
  expect(sourceURL).toContain("scenario=network-partition");

  await page.evaluate((event) => {
    window.__bounderTestSources[0].emit("resilience", JSON.stringify(event));
  }, events[1]);
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-resilience-fallback", "true");
  expect(await page.evaluate(() => window.__bounderTestSources[0].closed)).toBe(true);
  await expect(page.locator('[data-resilience="transport"]')).toHaveText("Evidence recorded", { timeout: 20_000 });
  await expect(page.locator(".decision-code")).toHaveText("signed_receipt");

  await page.getByRole("button", { name: "Run fault" }).click();
  await page.evaluate((event) => {
    window.__bounderTestSources[1].emit("resilience", JSON.stringify(event));
    window.__bounderTestSources[1].emit("complete");
  }, events[0]);
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-resilience-fallback", "true");

  const thirdScenario = page.locator(".resilience-scenario").nth(2);
  await thirdScenario.click();
  await expect(page.locator('[data-receipt="subject"]')).toHaveText("bounder-ground-002 (recorded as bounder-bravo)");
  await page.evaluate((event) => {
    window.__bounderTestSources[1].emit("resilience", JSON.stringify(event));
  }, events[1]);
  await expect(page.locator('[data-receipt="subject"]')).toHaveText("bounder-ground-002 (recorded as bounder-bravo)");

  if (await page.locator("#fault-replay").getAttribute("open") === null) await page.locator("#fault-replay > summary").click();
  await page.locator(".resilience-scenario").first().click();
  await page.getByRole("button", { name: "Run fault" }).click();
  await expect(page.locator(".simulator-stage")).not.toHaveAttribute("data-resilience-fallback", /.+/);
  await page.evaluate((event) => {
    const duplicateMember = `{"at_ms":${JSON.stringify(event.at_ms)},${JSON.stringify(event).slice(1)}`;
    window.__bounderTestSources[2].emit("resilience", duplicateMember);
  }, events[0]);
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-resilience-fallback", "true", { timeout: 1_000 });
  expect(await page.evaluate(() => window.__bounderTestSources[2].closed)).toBe(true);

  await page.clock.install();
  if (await page.locator("#fault-replay").getAttribute("open") === null) await page.locator("#fault-replay > summary").click();
  await page.locator(".resilience-scenario").first().click();
  await page.getByRole("button", { name: "Run fault" }).click();
  await page.clock.fastForward(2_600);
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-resilience-fallback", "true", { timeout: 5_000 });
  expect(await page.evaluate(() => window.__bounderTestSources[3].closed)).toBe(true);
  expect(errors).toEqual([]);
});

test("resilience transport controls and the scrubber move the console through recorded evidence", async ({ page }) => {
  // Audit 2026-09: only "Run fault" was ever clicked. Pause, Step, Reset and the
  // scrubber were guarded by literal string matches on the markup, which cannot see a
  // dead handler or a control stuck disabled. The clock is installed before navigation
  // so the recorded replay advances only when this test says so.
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/simulator.html");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-fleet-ready", "true", { timeout: 20_000 });

  const action = (name) => page.locator(`[data-resilience-action="${name}"]`);
  const transport = page.locator('[data-resilience="transport"]');
  const scrubber = page.locator("[data-resilience-scrubber]");
  const currentCode = page.locator(".resilience-event.is-current code");
  const currentEvent = page.locator(".resilience-event.is-current");
  const eventTime = page.locator('[data-resilience="time"]');

  if (await page.locator("#fault-replay").getAttribute("open") === null) await page.locator("#fault-replay > summary").click();
  await page.locator(".resilience-scenario").first().click();
  await expect(transport).toHaveText("Ready");
  await expect(scrubber).toHaveValue("0");
  // The range is taken from the selected scenario's last event, not the markup literal.
  await expect(scrubber).toHaveAttribute("max", "2100");
  await expect(currentEvent).toHaveCount(0);
  for (const name of ["run", "step", "reset"]) await expect(action(name)).toBeEnabled();
  await expect(action("pause")).toBeDisabled();

  // Freeze the clock now: install() alone keeps real time flowing, so on a loaded host the
  // whole 2.1 s replay can fire before the first assertion polls. pauseAt jumps the page clock
  // forward to the given instant; a target the page clock has already passed leaves time
  // running, so aim well ahead of any drift between this process and the page.
  await page.clock.pauseAt(Date.now() + 60_000);
  await action("run").click();
  await expect(action("pause")).toBeEnabled();
  // The baseline event is armed at t+0. Whether the paused clock has already let that timer
  // fire is host-dependent, so fire it explicitly and assert the baseline rather than the
  // transient "Deterministic evidence replay" label that it replaces.
  await page.clock.runFor(0);
  await expect(currentCode).toHaveText("policy_active");
  await expect(scrubber).toHaveValue("0");
  await page.clock.fastForward(700);
  await expect(currentCode).toHaveText("fleet_unreachable");
  await expect(scrubber).toHaveValue("650");

  // Pause must clear the pending replay timers, not merely relabel the transport.
  await action("pause").click();
  await expect(transport).toHaveText("Paused");
  await expect(action("pause")).toBeDisabled();
  await page.clock.fastForward(3_000);
  await expect(transport).toHaveText("Paused");
  await expect(currentCode).toHaveText("fleet_unreachable");
  await expect(scrubber).toHaveValue("650");

  // Step advances by exactly one recorded event and clamps at the last one.
  await action("step").click();
  await expect(currentCode).toHaveText("civilian_proximity");
  await expect(scrubber).toHaveValue("1350");
  await expect(page.locator(".decision-code")).toHaveText("civilian_proximity");
  await action("step").click();
  await expect(currentCode).toHaveText("signed_receipt");
  await expect(scrubber).toHaveValue("2100");
  await action("step").click();
  await expect(currentCode).toHaveText("signed_receipt");
  await expect(scrubber).toHaveValue("2100");
  await expect(currentEvent).toHaveCount(1);
  await expect(scrubber).toHaveAttribute("aria-valuetext", "2.10 seconds, audit");
  await expect(currentEvent).toHaveAttribute("aria-current", "step");

  // Reset returns the console to its pre-run state without granting authority.
  await action("reset").click();
  await expect(scrubber).toHaveValue("0");
  // A screen reader hears the reset time, not the last event's.
  await expect(scrubber).toHaveAttribute("aria-valuetext", "0.00 seconds, ready");
  await expect(eventTime).toHaveText("0.00 s");
  await expect(transport).toHaveText("Ready");
  await expect(page.locator(".decision-code")).toHaveText("ready");
  await expect(currentEvent).toHaveCount(0);

  // The scrubber selects the last recorded event at or before its value. Every fixture
  // scenario starts at 0 ms and the control's min is 0, so the input handler's
  // "no event yet" fallback is unreachable through the UI; 0 selects the baseline.
  await scrubber.fill("1350");
  await expect(currentCode).toHaveText("civilian_proximity");
  await expect(eventTime).toHaveText("1.35 s");
  await scrubber.fill("700");
  await expect(currentCode).toHaveText("fleet_unreachable");
  await expect(eventTime).toHaveText("0.65 s");
  await scrubber.fill("0");
  await expect(currentCode).toHaveText("policy_active");
  await expect(eventTime).toHaveText("0.00 s");
  await expect(page.locator('[data-receipt="subject"]')).toHaveText("bounder-aerial-001 (recorded as bounder-alpha)");

  expect(errors).toEqual([]);
});

test("visibility, focus exceptions and WebGL context loss stop active state safely", async ({ page }) => {
  // The longest GPU/focus lifecycle journey: about twenty stages, each waiting on a software-rendered frame.
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  // Full motion: under reduced motion Play settles on the decision after about a second, which
  // would let the hidden-page assertions below pass without an active animation to stop.
  await page.goto("/simulator.html?scenario=safe");
  const stage = page.locator(".simulator-stage");
  const canvas = stage.locator("canvas");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(stage).toHaveAttribute("data-playing", "false");
  await page.getByRole("button", { name: "Play simulation" }).click();
  await expect(stage).toHaveAttribute("data-playing", "true");

  await canvas.evaluate((element) => { element.focus = () => { throw new Error("focus unavailable"); }; });
  await canvas.click({ force: true, position: { x: 12, y: 12 } });
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-playing", "false");
  await expect(stage).toHaveAttribute("data-animation-state", "hidden");
  // Play is an action button whose label names the next action, so it carries no aria-pressed.
  await expect(page.getByRole("button", { name: "Play simulation" })).not.toHaveAttribute("aria-pressed", /.*/);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-animation-state", /scheduled|idle/);

  const tourButton = page.locator("[data-action='tour']");
  const tour = page.locator("[data-operator-tour]");
  const root = page.locator(".simulator-workbench");
  await tourButton.click();
  await expect(tour).toBeVisible();
  await expect(tourButton).toHaveAttribute("aria-expanded", "true");
  await expect(root).toHaveAttribute("data-operator-tour-step", "signed-baseline");
  await page.getByRole("button", { name: "Next proof" }).focus();

  await canvas.dispatchEvent("webglcontextlost");
  await expect(stage).toHaveAttribute("data-webgl", "context-lost");
  await expect(stage).toHaveAttribute("data-fail-closed", "true");
  await expect(page.locator(".adapter-output")).toHaveText("No command authority");
  await expect(page.getByRole("button", { name: "Play simulation" })).toBeDisabled();
  await expect(tour).toBeHidden();
  await expect(tourButton).toHaveAttribute("aria-expanded", "false");
  await expect(tourButton).toHaveText("Guided tour");
  await expect(page.locator(".receipt-details summary")).toBeFocused();
  await expect(root).not.toHaveAttribute("data-operator-tour-step", /.+/);
  expect(new URL(page.url()).searchParams.has("tour")).toBe(false);
  expect(new URL(page.url()).searchParams.has("step")).toBe(false);
  await expect(page.locator(".webgl-fallback")).toContainText("The 3D view was interrupted");
  // Recorded receipts stay inspectable while the scene is paused; the scene stays hidden.
  await page.getByRole("button", { name: "Civilian buffer" }).click();
  await expect(page.locator(".decision-code")).toHaveText("civilian_proximity");
  await expect(stage).toHaveAttribute("data-fail-closed", "true");
  await expect(page.getByRole("button", { name: "Play simulation" })).toBeDisabled();
  // A restored context resumes the scene on the receipt that is on screen.
  await canvas.dispatchEvent("webglcontextrestored");
  await expect(stage).toHaveAttribute("data-webgl", "ready");
  await expect(stage).not.toHaveAttribute("data-fail-closed", /.+/);
  await expect(page.getByRole("button", { name: "Play simulation" })).toBeEnabled();
  await expect(page.locator(".decision-code")).toHaveText("civilian_proximity");
  expect(errors).toEqual([]);
});

test("reduced motion jumps to the recorded decision without a flight or a full-rate loop", async ({ browser }) => {
  // Behavioural counterpart to the source guard in tests/interface.test.js: Play shows the start
  // state and then the recorded decision within seconds, the loop never spins at full rate, and
  // user input still renders immediately.
  test.setTimeout(60_000);
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    window.__bounderAnimationFrames = 0;
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      window.__bounderAnimationFrames += 1;
      return requestFrame(callback);
    };
  });
  await page.goto("/simulator.html?scenario=civilian");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await stage.scrollIntoViewIfNeeded();
  await expect(page.locator(".decision-code")).toHaveText("civilian_proximity");
  const sample = () => page.evaluate(() => ({
    requested: window.__bounderAnimationFrames,
    rendered: Number(document.querySelector(".simulator-stage").dataset.renderFrames ?? 0)
  }));
  const before = await sample();
  // Record every decision code in the page: the start state is shown for about a second, which a
  // polling assertion can miss on a loaded machine.
  await page.evaluate(() => {
    const code = document.querySelector(".decision-code");
    window.__bounderDecisionCodes = [code.textContent];
    new MutationObserver(() => window.__bounderDecisionCodes.push(code.textContent))
      .observe(code, { childList: true, characterData: true, subtree: true });
  });
  await page.getByRole("button", { name: "Play simulation" }).click();
  await expect.poll(() => page.evaluate(() => window.__bounderDecisionCodes), { timeout: 5_000 })
    .toEqual(["civilian_proximity", "evaluating", "civilian_proximity"]);
  await expect(page.locator(".decision-code")).toHaveText("civilian_proximity");
  await expect(stage).toHaveAttribute("data-playing", "false");
  const after = await sample();
  expect(after.requested - before.requested, "reduced motion requested full-rate animation frames").toBeLessThanOrEqual(15);
  const canvas = stage.locator("canvas");
  await canvas.focus();
  const beforeZoom = (await sample()).rendered;
  await page.keyboard.press("Minus");
  await expect.poll(async () => (await sample()).rendered, { timeout: 5_000 }).toBeGreaterThan(beforeZoom);
  expect(errors).toEqual([]);
  await context.close();
});

test("accessible evidence honours scenario deep links and remains usable without WebGL", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/simulator.html?webgl=off&scenario=friendly");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-webgl", "unavailable");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(page.locator(".scene-explanation")).toBeVisible();
  await expect(page.locator(".scene-explanation")).toContainText("Hold outside the team-separation distance");
  await expect(page.locator("[data-receipt='evidence']")).toHaveText("gold · mettle.creed.space · 30s old");
  await expect(page.locator("body")).not.toContainText("undefined");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await expect(page.locator(".decision-code")).toHaveText("friendly_force_proximity");
  await expect(page.getByRole("button", { name: "Team separation" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Cleared route" }).click();
  await expect(page.locator(".decision-code")).toHaveText("allowed");
  expect(errors).toEqual([]);
});

test("published Creed Space vector verifies locally and remains held after expiry", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/simulator.html?webgl=off");
  await page.locator("#contract-inspector > summary").click();
  await page.getByRole("button", { name: "Verify published example" }).click();
  const status = page.locator("[data-policy-status]");
  await expect(status).toHaveAttribute("data-state", "held");
  await expect(status).toContainText("Signature verified");
  await expect(page.locator("[data-policy-step='signature']")).toHaveAttribute("data-state", "verified");
  await expect(page.locator("[data-policy-step='receipt']")).toHaveAttribute("data-state", "evidenced");
  await expect(page.locator("[data-policy-field='subject']")).toHaveText("bounder-alpha");
  expect(errors).toEqual([]);
});

test("contact success and simulator embed query states expose only their intended views", async ({ page }) => {
  await page.goto("/contact.html?success=true");
  await expect(page.locator("#form-success")).toBeHidden();
  await expect(page.locator("#contact-form")).toBeVisible();

  await page.goto("/simulator.html?embed=1&webgl=off");
  await expect(page.locator("html")).toHaveClass(/simulator-embed/);
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-receipts-ready", "true");
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".hero")).toBeHidden();
  await expect(page.locator(".rules-context")).toBeHidden();
  await expect(page.locator(".site-footer")).toBeHidden();
  await expect(page.locator(".simulator-workbench")).toBeVisible();
});

test("pages do not overflow and retain usable controls across every declared breakpoint band", async ({ page }) => {
  // The stylesheets declare max-width breakpoints at 1050, 1023, 960, 900, 760, 680, 560,
  // 420 and 360px (styles.css: 1023, 900, 680; simulator.css: 1050, 960, 760, 680, 560,
  // 420, 360). One width per band: 320 (<=360, and the WCAG 1.4.10 reflow width), 390
  // (361-420), 480 (421-560), 620 (561-680), 720 (681-760), 820 (761-900), 930 (901-960),
  // 1000 (961-1023) and 1040 (1024-1050); 1280 (>1050) is covered by every other test in
  // this file. Line numbers are deliberately not cited: they drift with every stylesheet
  // edit, and tests/site-quality.test.js fails when a new breakpoint has no width here.
  // 320 and 390 keep the full page sweep; the other widths run on the two pages that
  // carry every breakpoint between them, which keeps the serial suite affordable. The budget
  // allows about ten seconds per load across the 26 loads, above the old per-load allowance.
  test.setTimeout(300_000);
  const everyPath = ["/", "/simulator.html?webgl=off", "/contact.html", "/privacy.html", "/terms.html", "/404.html"];
  const complexPaths = ["/", "/simulator.html?webgl=off"];
  const passes = [
    { width: 320, height: 640, paths: everyPath },
    { width: 390, height: 844, paths: everyPath },
    { width: 480, height: 900, paths: complexPaths },
    { width: 620, height: 900, paths: complexPaths },
    { width: 720, height: 900, paths: complexPaths },
    { width: 820, height: 900, paths: complexPaths },
    { width: 930, height: 900, paths: complexPaths },
    { width: 1000, height: 900, paths: complexPaths },
    { width: 1040, height: 900, paths: complexPaths }
  ];
  for (const { width, height, paths } of passes) {
    await page.setViewportSize({ width, height });
    for (const path of paths) {
      await page.goto(path);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
      });
      if (path.includes("simulator.html")) {
        await expect(page.locator(".simulator-stage")).toHaveAttribute("data-receipts-ready", "true", { timeout: 20_000 });
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows at ${width}px`).toBeLessThanOrEqual(1);
      await expect(page.locator("h1")).toHaveCount(1);
      if (path.includes("simulator.html")) {
        await page.locator("#contract-inspector > summary").click();
        await expect(page.getByRole("button", { name: "Verify published example" })).toBeVisible();
      }
    }
  }
});

test("interior pages have no detectable accessibility violations", async ({ page }) => {
  // Audit 2026-07: axe previously ran only on the homepage and simulator, so
  // contrast/focus regressions on interior pages went unguarded.
  test.setTimeout(90_000);
  // One listener pair for the life of the test: collectErrors never detaches, so
  // calling it per iteration left four console and four pageerror listeners attached.
  const errors = collectErrors(page);
  for (const path of ["/contact.html", "/privacy.html", "/terms.html", "/404.html"]) {
    errors.length = 0;
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${path} has accessibility violations`).toEqual([]);
    expect(errors, `${path} logged console errors`).toEqual([]);
  }
});

test("primary and footer navigation are consistent across pages", async ({ page }) => {
  // Audit 2026-07: every page carried a different nav set. Interior headers and
  // all footers are now canonical; this pins them.
  const interior = ["/simulator.html?webgl=off", "/contact.html", "/privacy.html", "/terms.html"];
  // Compare lowercased: CSS text-transform is styling, not content.
  const expectedHeader = ["architecture", "applications", "simulator", "roadmap", "contact"];
  const expectedFooter = ["terms", "privacy", "contact", "github"];
  for (const path of interior) {
    await page.goto(path);
    const header = (await page.locator("nav.header-nav a").allInnerTexts()).map((s) => s.trim().toLowerCase());
    expect(header, `${path} header nav diverges`).toEqual(expectedHeader);
  }
  for (const path of ["/", ...interior]) {
    await page.goto(path);
    // The external-link glyph is decorative (aria-hidden); compare the link names only.
    const footer = (await page.locator("nav.secondary-nav a").allInnerTexts()).map((s) => s.replace("↗", "").trim().toLowerCase());
    expect(footer, `${path} footer nav diverges`).toEqual(expectedFooter);
  }
});

test("with no verified live proof, the home page shows the labelled recorded run instead of empty cells", async ({ page }) => {
  // The test server is not bounder.io, so the verifier reports the preview state.
  await page.goto("/");
  const continuity = page.locator("[data-continuity]");
  await expect(continuity).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator(".continuity-metrics-live")).toBeHidden();
  const recorded = page.locator(".continuity-recorded");
  await expect(recorded).toBeVisible();
  await expect(recorded).toContainText("Recorded run · not live");
  await expect(recorded).toContainText("13 allow / 87 hold");
  await expect(page.locator("[data-continuity-note]")).toHaveText(/^Live verification runs only on bounder\.io\./);
});

// The clear band of the stage between the status badge and the legend, as page coordinates.
const stageSceneBand = (frame) => frame.locator(".simulator-stage").evaluate((stage) => {
  const outer = stage.ownerDocument.defaultView.frameElement?.getBoundingClientRect() ?? { x: 0, y: 0 };
  const box = stage.getBoundingClientRect();
  const top = stage.querySelector(".stage-status").getBoundingClientRect().bottom + 4;
  const legend = stage.querySelector(".stage-legend");
  const bottom = legend.getClientRects().length ? legend.getBoundingClientRect().top - 4 : box.bottom - 4;
  return { x: outer.x + box.x + 8, y: outer.y + top, width: box.width - 16, height: Math.max(8, bottom - top) };
});

// Distinct colours in a 64x36 downsample of a screenshot region: a drawn town has hundreds, a
// cleared canvas showing only the stage background has one.
const distinctColours = async (page, clip) => {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, 64, 36);
    const data = context.getImageData(0, 0, 64, 36).data;
    const colours = new Set();
    for (let index = 0; index < data.length; index += 4) colours.add((data[index] << 16) | (data[index + 1] << 8) | data[index + 2]);
    return colours.size;
  }, png.toString("base64"));
};

test("the homepage embed shows a drawn scene once it scrolls into view at desktop widths", async ({ browser }) => {
  // Software-rendered frames can hold the main thread for many seconds on a loaded host.
  test.setTimeout(240_000);
  for (const width of [1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto("/");
      const embed = page.locator("iframe[data-bounder-simulator]");
      await embed.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      const frame = page.frameLocator("iframe[data-bounder-simulator]");
      const stage = frame.locator(".simulator-stage");
      await expect(stage).toHaveAttribute("data-receipts-ready", "true", { timeout: 120_000 });
      await expect(stage).toHaveAttribute("data-animation-state", "idle", { timeout: 120_000 });
      // A same-size layout pass after the first frame must not leave the canvas cleared.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1_500)));
      const inner = page.frames().find((candidate) => candidate.url().includes("simulator.html"));
      const band = await stageSceneBand(inner);
      expect(await distinctColours(page, band), `${width}px embed shows only the stage background`).toBeGreaterThan(200);
    } finally {
      await context.close();
    }
  }
});

test("a layout change never clears the scene: same-size passes keep the canvas, real resizes redraw at once", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    window.__stageCanvasResizes = 0;
    for (const property of ["width", "height"]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
      Object.defineProperty(HTMLCanvasElement.prototype, property, {
        configurable: true,
        get: descriptor.get,
        set(value) {
          if (this.closest?.(".simulator-stage")) window.__stageCanvasResizes += 1;
          descriptor.set.call(this, value);
        }
      });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/simulator.html");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true", { timeout: 120_000 });
  await expect(stage).toHaveAttribute("data-animation-state", "idle", { timeout: 120_000 });
  const resizes = () => page.evaluate(() => window.__stageCanvasResizes);
  const settled = await resizes();
  // The legend growing fires the stage ResizeObserver, whose callback runs before the next paint;
  // the stage itself keeps its size, so the canvas must keep its buffer.
  await page.locator(".stage-legend").evaluate((legend) => { legend.style.minHeight = "64px"; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await resizes(), "a same-size layout pass reassigned the canvas size").toBe(settled);
  // With animation frames withheld, only the synchronous redraw can refill a resized canvas.
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.setViewportSize({ width: 1300, height: 1000 });
  await expect.poll(resizes).toBeGreaterThan(settled);
  const band = await stageSceneBand(page.mainFrame());
  expect(await distinctColours(page, band), "the resized canvas was left cleared").toBeGreaterThan(200);
});

test("every guided-tour step leaves a drawn scene on the stage", async ({ page }) => {
  test.setTimeout(240_000);
  // Reduced motion lets each step settle to an idle frame instead of flying its route.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/simulator.html?tour=1");
  const stage = page.locator(".simulator-stage");
  const root = page.locator(".simulator-workbench");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true", { timeout: 120_000 });
  for (let step = 0; step < 6; step += 1) {
    await expect(root).toHaveAttribute("data-operator-tour-step", /.+/);
    await expect(stage).toHaveAttribute("data-animation-state", "idle", { timeout: 120_000 });
    await stage.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const band = await stageSceneBand(page.mainFrame());
    expect(await distinctColours(page, band), `tour step ${step + 1} shows only the stage background`).toBeGreaterThan(200);
    if (step < 5) await page.getByRole("button", { name: "Next proof" }).click();
  }
});
