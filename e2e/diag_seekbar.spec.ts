import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173/";
const VIDEO_FILE = "c:/data/code/AIvideoShortTheminer/test_data/video.mp4";
const VIDEO_FILE2 = "c:/data/code/AIvideoShortTheminer/test_data/video2.mp4";

async function uploadVideo(page: Page, filePath: string) {
  const input = page.locator("input[type=\"file\"][accept=\"video/*\"]");
  await input.setInputFiles(filePath);
  await page.waitForTimeout(1500);
}

test("diagnose: seekbar max after multi-video upload", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  
  // Upload first video
  await uploadVideo(page, VIDEO_FILE);
  let seekbar = page.locator("input[type=\"range\"]");
  let maxVal1 = await seekbar.getAttribute("max");
  let durationText1 = await page.locator(".timecode").textContent();
  console.log("After 1st video - max:", maxVal1, "duration:", durationText1);
  
  // Upload second video
  await uploadVideo(page, VIDEO_FILE2);
  maxVal1 = await seekbar.getAttribute("max");
  durationText1 = await page.locator(".timecode").textContent();
  console.log("After 2nd video - max:", maxVal1, "duration:", durationText1);
  
  // Check if there are 2 video clips
  const clipCount = await page.locator(".clip-block.video-clip").count();
  console.log("Video clip count:", clipCount);
  
  expect(clipCount).toBe(2);
});