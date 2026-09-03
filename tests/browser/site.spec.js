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
  await page.goto("/simulator.html?scenario=safe");
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

test("guided tour traverses all six proofs and restores focus when finished", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/simulator.html?scenario=safe");
  const root = page.locator(".simulator-workbench");
  const tour = page.locator("[data-operator-tour]");
  const tourButton = page.getByRole("button", { name: "Guided tour" });
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-fleet-ready", "true");
  await tourButton.click();
  await expect(tour).toBeVisible();

  const steps = [
    ["signed-baseline", "Inspect the recorded baseline", "allowed"],
    ["fleet-projection", "Project one rule across the fleet", "allowed"],
    ["civilian-protection", "Protect civilians at the final boundary", "civilian_proximity"],
    ["friendly-separation", "Prevent blue-on-blue action", "friendly_force_proximity"],
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
  await expect(page.getByRole("button", { name: "Show fleet" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Friendly separation" })).toBeEnabled();
  await page.getByRole("button", { name: "Friendly separation" }).click();
  await expect(page.locator(".decision-code")).toHaveText("friendly_force_proximity");
  await expect(page.locator("[data-fleet-source]")).toContainText("Fleet evidence unavailable");
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
  await expect(page.locator(".webgl-fallback")).toBeVisible();
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
  await expect(page.locator('[data-receipt="subject"]')).toHaveText("bounder-bravo");
  await page.evaluate((event) => {
    window.__bounderTestSources[1].emit("resilience", JSON.stringify(event));
  }, events[1]);
  await expect(page.locator('[data-receipt="subject"]')).toHaveText("bounder-bravo");

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

  await page.locator(".resilience-scenario").first().click();
  await expect(transport).toHaveText("Ready");
  await expect(scrubber).toHaveValue("0");
  // The range is taken from the selected scenario's last event, not the markup literal.
  await expect(scrubber).toHaveAttribute("max", "2100");
  await expect(currentEvent).toHaveCount(0);
  for (const name of ["run", "step", "reset"]) await expect(action(name)).toBeEnabled();
  await expect(action("pause")).toBeDisabled();

  // Freeze the clock now: install() alone keeps real time flowing, so on a loaded host the
  // whole 2.1 s replay can fire before the first assertion polls.
  await page.clock.pauseAt(Date.now() + 1);
  await action("run").click();
  await expect(transport).toHaveText("Deterministic evidence replay");
  await expect(action("pause")).toBeEnabled();
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

  // Reset returns the console to its pre-run state without granting authority.
  await action("reset").click();
  await expect(scrubber).toHaveValue("0");
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
  await expect(page.locator('[data-receipt="subject"]')).toHaveText("bounder-alpha");

  expect(errors).toEqual([]);
});

test("visibility, focus exceptions and WebGL context loss stop active state safely", async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  await expect(page.getByRole("button", { name: "Play simulation" })).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-animation-state", "scheduled");

  const tourButton = page.locator("[data-action='tour']");
  const tour = page.locator("[data-operator-tour]");
  const root = page.locator(".simulator-workbench");
  await tourButton.click();
  await expect(tour).toBeVisible();
  await expect(tourButton).toHaveAttribute("aria-expanded", "true");
  await expect(root).toHaveAttribute("data-operator-tour-step", "signed-baseline");
  await page.getByRole("button", { name: "Next proof" }).focus();

  await canvas.dispatchEvent("webglcontextlost");
  await expect(stage).toHaveAttribute("data-webgl", "runtime-error");
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
  expect(errors).toEqual([]);
});

test("accessible evidence honours scenario deep links and remains usable without WebGL", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/simulator.html?webgl=off&scenario=friendly");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-webgl", "unavailable");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(page.locator(".webgl-fallback")).toBeVisible();
  await expect(page.locator("[data-receipt='evidence']")).toHaveText("30s old · gold evidence");
  await expect(page.locator("body")).not.toContainText("undefined");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await expect(page.locator(".decision-code")).toHaveText("friendly_force_proximity");
  await expect(page.getByRole("button", { name: "Friendly separation" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Cleared route" }).click();
  await expect(page.locator(".decision-code")).toHaveText("allowed");
  expect(errors).toEqual([]);
});

test("published Creed Space vector verifies locally and remains held after expiry", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/simulator.html?webgl=off");
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
  await expect(page.locator("#form-success")).toBeVisible();
  await expect(page.locator("#contact-form")).toBeHidden();

  await page.goto("/simulator.html?embed=1&webgl=off");
  await expect(page.locator("html")).toHaveClass(/simulator-embed/);
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-receipts-ready", "true");
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".simulator-intro")).toBeHidden();
  await expect(page.locator(".rules-context")).toBeHidden();
  await expect(page.locator(".site-footer")).toBeHidden();
  await expect(page.locator(".simulator-workbench")).toBeVisible();
});

test("pages do not overflow and retain usable controls across every declared breakpoint band", async ({ page }) => {
  // Audit 2026-09: 390px and Chromium's 1280px default were the only widths ever
  // rendered, so four of the six bands declared by the stylesheets were unguarded.
  // The declared max-width breakpoints are styles.css:1358 (900) and :1409 (680),
  // simulator.css:1141 (960), :1156 (560), :1381 (1050) and :1407 (680). One width
  // per band: 390 (<=560), 620 (561-680), 820 (681-900), 930 (901-960), 1000
  // (961-1050); 1280 (>1050) is covered by every other test in this file.
  // 390 keeps the full page sweep; the four added widths run on the two pages that
  // carry all six breakpoints between them, which keeps the serial suite affordable.
  test.setTimeout(120_000);
  const everyPath = ["/", "/simulator.html?webgl=off", "/contact.html", "/privacy.html", "/terms.html", "/404.html"];
  const complexPaths = ["/", "/simulator.html?webgl=off"];
  const passes = [
    { width: 390, height: 844, paths: everyPath },
    { width: 620, height: 900, paths: complexPaths },
    { width: 820, height: 900, paths: complexPaths },
    { width: 930, height: 900, paths: complexPaths },
    { width: 1000, height: 900, paths: complexPaths }
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
  const expectedHeader = ["architecture", "applications", "simulator", "safety", "contact"];
  const expectedFooter = ["terms", "privacy", "contact", "github"];
  for (const path of interior) {
    await page.goto(path);
    const header = (await page.locator("nav.header-nav a").allInnerTexts()).map((s) => s.trim().toLowerCase());
    expect(header, `${path} header nav diverges`).toEqual(expectedHeader);
  }
  for (const path of ["/", ...interior]) {
    await page.goto(path);
    const footer = (await page.locator("nav.secondary-nav a").allInnerTexts()).map((s) => s.trim().toLowerCase());
    expect(footer, `${path} footer nav diverges`).toEqual(expectedFooter);
  }
});
