import { test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173/";
const VIDEO_FILE = "c:/data/code/AIvideoShortTheminer/test_data/video.mp4";
const AUDIO_HEAVY = "c:/data/code/AIvideoShortTheminer/test_data/wet heavy.mp3";

test("export_diag", async ({ page }) => {
  test.setTimeout(120000);
  const consoleLogs: string[] = [];
  page.on("console", (msg) => consoleLogs.push(msg.type() + ": " + msg.text()));
  page.on("pageerror", (err) => consoleLogs.push("PAGEERROR: " + err.message));

  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  // Check CORS headers
  const headers = await page.evaluate(async () => {
    const res = await fetch(window.location.href);
    return Object.fromEntries([...res.headers.entries()]);
  });
  console.log("Page headers:", JSON.stringify(headers, null, 2));

  // Check SharedArrayBuffer availability
  const sabAvail = await page.evaluate(() => typeof SharedArrayBuffer !== "undefined");
  console.log("SharedArrayBuffer available:", sabAvail);

  // Upload video
  await page.locator("input[type=\"file\"][accept=\"video/*\"]").setInputFiles(VIDEO_FILE);
  await page.waitForTimeout(1500);

  // Upload audio
  await page.locator("input[type=\"file\"][accept=\"audio/*\"]").setInputFiles([AUDIO_HEAVY]);
  await page.waitForTimeout(1500);

  // Export
  await page.locator("button").nth(1).click();
  console.log("Export clicked");

  await page.waitForTimeout(15000);

  const status = (await page.locator(".status-text").first().textContent()) ?? "";
  const logBox = (await page.locator(".log-box").textContent()) ?? "";
  console.log("Status:", status);
  console.log("LogBox:", logBox);
  console.log("Console logs:", consoleLogs.join("\n"));
});