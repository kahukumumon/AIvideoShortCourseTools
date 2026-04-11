import { test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173/";
const VIDEO_FILE = "c:/data/code/AIvideoShortTheminer/test_data/video.mp4";
const AUDIO_HEAVY = "c:/data/code/AIvideoShortTheminer/test_data/wet heavy.mp3";

test("export_full_wait", async ({ page }) => {
  test.setTimeout(300000);
  const consoleLogs: string[] = [];
  page.on("console", (msg) => consoleLogs.push("[" + msg.type() + "] " + msg.text()));
  page.on("pageerror", (err) => consoleLogs.push("[PAGEERROR] " + err.message));
  page.on("requestfailed", (req) => consoleLogs.push("[REQFAIL] " + req.url() + " " + (req.failure()?.errorText ?? "")));

  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  await page.locator("input[type=\"file\"][accept=\"video/*\"]").setInputFiles(VIDEO_FILE);
  await page.waitForTimeout(2000);
  await page.locator("input[type=\"file\"][accept=\"audio/*\"]").setInputFiles([AUDIO_HEAVY]);
  await page.waitForTimeout(2000);

  // Click export button (index 1 = mp4 export)
  await page.locator("button").nth(1).click();
  console.log("Export clicked");

  // Wait with detailed monitoring
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const status = (await page.locator(".status-text").first().textContent()) ?? "";
    const logBox = (await page.locator(".log-box").textContent()) ?? "";
    if (i % 5 === 0) {
      console.log("[" + i + "s] Status:", status);
      console.log("[" + i + "s] LogBox:", logBox.slice(-200));
      console.log("[" + i + "s] Console:", consoleLogs.slice(-5).join("; "));
    }
    if (status.includes("完了") || status.includes("失敗")) {
      console.log("Done at " + i + "s");
      break;
    }
  }

  console.log("=== FINAL ===");
  console.log("Status:", await page.locator(".status-text").first().textContent());
  console.log("Log:", await page.locator(".log-box").textContent());
  console.log("All console logs:", consoleLogs.join("\n"));
});