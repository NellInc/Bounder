import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`explainer is accessible and plays with captions at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/simulator.html?embed=1", (route) => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html lang='en'><title>Simulator placeholder</title><body></body></html>"
    }));
    const requestedMedia = [];
    page.on("request", (request) => {
      if (request.url().endsWith(".mp4")) requestedMedia.push(request.url());
    });
    await page.goto("/#explainer");
    const video = page.locator("#bounder-explainer");
    await video.scrollIntoViewIfNeeded();
    await expect(video).toBeVisible();
    expect(requestedMedia).toEqual([]);
    expect(await video.evaluate((v) => ({ paused: v.paused, controls: v.controls, inline: v.playsInline })))
      .toEqual({ paused: true, controls: true, inline: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator("#explainer").screenshot({ path: testInfo.outputPath(`explainer-${width}-poster.png`) });
    const a11y = await new AxeBuilder({ page }).include("#explainer").analyze();
    expect(a11y.violations).toEqual([]);
    await video.scrollIntoViewIfNeeded();
    await video.evaluate(async (v) => { await v.play(); });
    await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
    expect(await video.evaluate((v) => [v.duration, v.videoWidth, v.videoHeight])).toEqual([120, 1920, 1080]);
    await expect.poll(() => video.evaluate((v) => v.textTracks[0]?.cues?.length)).toBe(41);
    expect(await video.evaluate((v) => v.textTracks[0].mode)).toBe("showing");
    await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(0.15);
    await video.evaluate((v) => new Promise((resolve) => {
      const observeFrame = (_now, metadata) => {
        if (metadata.mediaTime >= 19 && metadata.mediaTime < 20) { v.pause(); resolve(); }
        else v.requestVideoFrameCallback(observeFrame);
      };
      v.requestVideoFrameCallback(observeFrame);
      v.currentTime = 19.1333;
    }));
    await video.screenshot({ path: testInfo.outputPath(`explainer-${width}-authority.png`) });
    await video.evaluate((v) => { v.textTracks[0].mode = "disabled"; });
    expect(await video.evaluate((v) => v.textTracks[0].mode)).toBe("disabled");
    await page.getByText("Read the transcript", { exact: true }).click();
    await expect(page.locator(".explainer-transcript-copy")).toBeVisible();
    await expect(page.locator(".explainer-transcript-copy p")).toHaveCount(8);
  });
}
