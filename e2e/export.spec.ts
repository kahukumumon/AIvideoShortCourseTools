import { test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173/";
const VIDEO_FILE = "c:/data/code/AIvideoShortTheminer/test_data/video.mp4";
const AUDIO_HEAVY = "c:/data/code/AIvideoShortTheminer/test_data/wet heavy.mp3";
const AUDIO_LIGHT = "c:/data/code/AIvideoShortTheminer/test_data/wet light.mp3";

test("export_full", async ({ page }) => {
  test.setTimeout(600000);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  // Upload video
  await page.locator("input[type=\"file\"][accept=\"video/*\"]").setInputFiles(VIDEO_FILE);
  await page.waitForTimeout(2000);
  console.log("Video uploaded");

  // Upload 2 audio to Audio 1
  await page.locator("input[type=\"file\"][accept=\"audio/*\"]").setInputFiles([AUDIO_HEAVY, AUDIO_LIGHT]);
  await page.waitForTimeout(2000);
  console.log("Audio 1 (heavy+light) uploaded");

  // Add Audio 2 track - use first button (not last which is export)
  const allBtns = await page.locator("button").allTextContents();
  console.log("Buttons:", allBtns);
  await page.locator("button").first().click();
  await page.waitForTimeout(800);

  const options = await page.locator("select option").allTextContents();
  console.log("Track options:", options);
  if (options.length >= 2) {
    await page.locator("select").selectOption({ index: options.length - 1 });
    console.log("Selected last track:", options[options.length - 1]);
  }
  await page.waitForTimeout(300);

  // Upload heavy to Audio 2
  await page.locator("input[type=\"file\"][accept=\"audio/*\"]").setInputFiles([AUDIO_HEAVY]);
  await page.waitForTimeout(2000);
  console.log("Audio 2 (heavy) uploaded");

  const audioClips = await page.locator(".clip-block.audio-clip").count();
  console.log("Total audio clips:", audioClips);

  // Export
  await page.locator("button").nth(1).click();
  console.log("Export clicked");

  let lastStatus = "";
  let lastLog = "";
  for (let i = 0; i < 600; i++) {
    await page.waitForTimeout(1000);
    const status = (await page.locator(".status-text").first().textContent()) ?? "";
    const logBox = (await page.locator(".log-box").textContent()) ?? "";
    if (status !== lastStatus) {
      console.log("[" + i + "s] Status: " + status);
      lastStatus = status;
    }
    if (logBox.length > lastLog.length) {
      const newPart = logBox.slice(lastLog.length).trim();
      if (newPart) console.log("LOG+" + newPart.slice(-300));
      lastLog = logBox;
    }
    if (status.includes("完了") || status.includes("失敗")) {
      break;
    }
  }
  const finalStatus = (await page.locator(".status-text").first().textContent()) ?? "";
  const finalLog = (await page.locator(".log-box").textContent()) ?? "";
  console.log("=== FINAL STATUS ===");
  console.log(finalStatus);
  console.log("=== FULL LOG ===");
  console.log(finalLog);
});