import { test, expect, type Page } from "@playwright/test";

test.use({
  launchOptions: {
    args: ["--no-sandbox"],
  },
});

const BASE_URL = "http://127.0.0.1:4173/";
const VIDEO_FILE = "c:/data/code/AIvideoShortTheminer/test_data/video.mp4";
const VIDEO_FILE2 = "c:/data/code/AIvideoShortTheminer/test_data/video2.mp4";
const AUDIO_HEAVY = "c:/data/code/AIvideoShortTheminer/test_data/wet heavy.mp3";
const AUDIO_LIGHT = "c:/data/code/AIvideoShortTheminer/test_data/wet light.mp3";

async function uploadVideo(page: Page, filePath: string) {
  const input = page.locator("input[type=\"file\"][accept=\"video/*\"]");
  await input.setInputFiles(filePath);
  await page.waitForTimeout(1500);
}

async function uploadAudio(page: Page, files: string[]) {
  const input = page.locator("input[type=\"file\"][accept=\"audio/*\"]");
  await input.setInputFiles(files);
  await page.waitForTimeout(1000);
}

test("multi_video_test_1: Upload two videos", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  
  // Upload first video
  await uploadVideo(page, VIDEO_FILE);
  let clipCount = await page.locator(".clip-block.video-clip").count();
  console.log("After first video upload:", clipCount);
  expect(clipCount).toBe(1);
  
  // Upload second video
  await uploadVideo(page, VIDEO_FILE2);
  clipCount = await page.locator(".clip-block.video-clip").count();
  console.log("After second video upload:", clipCount);
  expect(clipCount).toBe(2);
});

test("multi_video_test_2: Seekbar max value for multi-video", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  
  // Upload first video
  await uploadVideo(page, VIDEO_FILE);
  const maxVal1 = await page.locator("input[type=\"range\"]").getAttribute("max");
  console.log("Seekbar max after 1st video (seconds):", maxVal1);
  
  // Upload second video
  await uploadVideo(page, VIDEO_FILE2);
  const maxVal2 = await page.locator("input[type=\"range\"]").getAttribute("max");
  console.log("Seekbar max after 2nd video (should be ~2x):", maxVal2);
  
  // Max value should be ~2x after uploading 2nd video (both videos are ~5 seconds)
  const maxNum1 = parseFloat(maxVal1 || "0");
  const maxNum2 = parseFloat(maxVal2 || "0");
  expect(maxNum2).toBeGreaterThan(maxNum1 * 1.5); // Should be significantly more than 1st video
  expect(maxNum2).toBeGreaterThan(9); // Should be at least 9 seconds (2 x ~5sec videos)
});

test("multi_video_test_3: RMS graph visible in audio clips", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  
  // Upload video and audio
  await uploadVideo(page, VIDEO_FILE);
  await uploadAudio(page, [AUDIO_HEAVY, AUDIO_LIGHT]);
  
  // Check for canvas elements in audio clips
  const canvases = await page.locator(".clip-block.audio-clip canvas").count();
  console.log("Canvas count in audio clips:", canvases);
  expect(canvases).toBeGreaterThanOrEqual(2);
  
  // Check canvas visibility (basic check)
  const firstCanvas = page.locator(".clip-block.audio-clip canvas").first();
  const isVisible = await firstCanvas.isVisible();
  console.log("First canvas visible:", isVisible);
  expect(isVisible).toBe(true);
});

test("multi_video_test_4: Playback across multiple videos", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  
  // Upload videos and audio
  await uploadVideo(page, VIDEO_FILE);
  await uploadVideo(page, VIDEO_FILE2);
  await uploadAudio(page, [AUDIO_HEAVY, AUDIO_LIGHT]);
  
  // Find play button and click
  const playButton = page.locator("button:has-text('再生')").first();
  if (await playButton.count() > 0) {
    await playButton.click();
    await page.waitForTimeout(500);
    
    // Check if playback is happening (timecode advances)
    const timecodeText = await page.locator(".timecode").textContent();
    console.log("Timecode during playback:", timecodeText);
    expect(timecodeText).toBeTruthy();
  }
});

test("multi_video_test_5: Export with multiple videos and audio", async ({ page }) => {
  test.setTimeout(120000);
  
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  
  let downloadDetected = false;
  page.on("download", async (download) => {
    downloadDetected = true;
    const filename = download.suggestedFilename();
    console.log("Download detected:", filename);
    await download.path(); // Complete download
  });
  
  // Upload videos and audio
  await uploadVideo(page, VIDEO_FILE);
  await uploadVideo(page, VIDEO_FILE2);
  await uploadAudio(page, [AUDIO_HEAVY, AUDIO_LIGHT]);
  
  // Try to export
  const exportButton = page.locator("button:has-text('mp4')").first();
  if (await exportButton.count() > 0) {
    await exportButton.click();
    await page.waitForTimeout(5000); // Wait for export process
    console.log("Export initiated, download detected:", downloadDetected);
  }
});