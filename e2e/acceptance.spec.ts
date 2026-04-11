import { test, expect, Page } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173/";
const VIDEO_FILE = "c:/data/code/AIvideoShortTheminer/test_data/video.mp4";
const AUDIO_HEAVY = "c:/data/code/AIvideoShortTheminer/test_data/wet heavy.mp3";
const AUDIO_LIGHT = "c:/data/code/AIvideoShortTheminer/test_data/wet light.mp3";

async function uploadVideo(page: Page) {
  const input = page.locator("input[type=\"file\"][accept=\"video/*\"]");
  await input.setInputFiles(VIDEO_FILE);
  await page.waitForTimeout(1500);
}

async function uploadAudio(page: Page, files: string[]) {
  const input = page.locator("input[type=\"file\"][accept=\"audio/*\"]");
  await input.setInputFiles(files);
  await page.waitForTimeout(1000);
}

test("t01 page loads", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  const h1 = await page.locator("h1").first().textContent();
  console.log("H1:", h1);
  expect(h1).toBeTruthy();
});

test("t02 video upload shows clip", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await uploadVideo(page);
  const statusText = await page.locator(".status-text").first().textContent();
  console.log("Status:", statusText);
  const videoClips = await page.locator(".clip-block.video-clip").count();
  console.log("Video clip count:", videoClips);
  expect(videoClips).toBeGreaterThan(0);
});

test("t03 audio upload shows clips", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await uploadVideo(page);
  await uploadAudio(page, [AUDIO_HEAVY, AUDIO_LIGHT]);
  const audioClips = await page.locator(".clip-block.audio-clip").count();
  console.log("Audio clip count:", audioClips);
  expect(audioClips).toBeGreaterThanOrEqual(2);
});

test("t04 add second audio track", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  const allBtns = await page.locator("button").allTextContents();
  console.log("Buttons:", allBtns.join(", "));
  const options = await page.locator("select option").count();
  console.log("Select options before:", options);
  await page.getByRole("button", { name: "音声トラック追加" }).evaluate((el) => {
    (el as HTMLButtonElement).click();
  });
  await expect.poll(async () => page.locator("select option").count()).toBeGreaterThanOrEqual(2);
  const optionsAfter = await page.locator("select option").count();
  console.log("Select options after:", optionsAfter);
  expect(optionsAfter).toBeGreaterThanOrEqual(2);
});

test("t05 timecode visible and timeline lanes", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  const videoLane = await page.locator(".video-lane").count();
  const audioLane = await page.locator(".audio-lane").count();
  const timecodeText = await page.locator(".timecode").textContent();
  console.log("Video lanes:", videoLane);
  console.log("Audio lanes:", audioLane);
  console.log("Timecode:", timecodeText);
  expect(videoLane).toBe(1);
  expect(audioLane).toBeGreaterThan(0);
  expect(timecodeText).toContain("0:00");
});

test("t06 preview video element", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  const videoCount = await page.locator("video").count();
  console.log("Video element count:", videoCount);
  if (videoCount > 0) {
    const src = await page.locator("video").first().getAttribute("src");
    console.log("Video src:", src);
  }
});

test("t07 playback controls", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  const allBtns = await page.locator("button").allTextContents();
  console.log("All buttons:", JSON.stringify(allBtns));
  const allInputs = await page.locator("input[type]").evaluateAll((inputs) =>
    inputs.map((i) => ({ type: (i as HTMLInputElement).type, id: (i as HTMLInputElement).id }))
  );
  console.log("All inputs:", JSON.stringify(allInputs));
});

test("t08 playhead element", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  const playhead = await page.locator(".playhead, .play-head, [data-playhead]").count();
  console.log("Playhead count:", playhead);
  const seekRange = await page.locator("input[type=\"range\"]").count();
  console.log("Range inputs:", seekRange);
});

test("t09 clip draggable and handles", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await uploadVideo(page);
  const clipBlock = page.locator(".clip-block.video-clip").first();
  const exists = await clipBlock.count();
  console.log("Video clip exists:", exists);
  if (exists > 0) {
    const draggable = await clipBlock.getAttribute("draggable");
    console.log("draggable attr:", draggable);
    const listeners = await clipBlock.evaluate((el) => {
      const events = ["mousedown", "dragstart", "pointerdown"];
      return events.map((ev) => {
        try {
          const has = (el as any)[`on${ev}`] !== undefined;
          return `${ev}: ${has}`;
        } catch { return `${ev}: ?`; }
      });
    });
    console.log("Event handlers:", listeners);
    const classNames = await clipBlock.getAttribute("class");
    console.log("Classes:", classNames);
  }
});

test("t10 right click on clip", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await uploadVideo(page);
  const clip = page.locator(".clip-block.video-clip").first();
  await clip.click({ button: "right" });
  await page.waitForTimeout(500);
  const bodyHtml = await page.locator("body").innerHTML();
  const hasMenu = bodyHtml.includes("context") || bodyHtml.includes("menu") || bodyHtml.includes("popup");
  console.log("Has menu in DOM:", hasMenu);
  const visibleElements = await page.locator("*").filter({ hasText: /split|delete|merge|fade|\u5206\u5272|\u524a\u9664|\u7d50\u5408|\u30d5\u30a7\u30fc\u30c9/i }).count();
  console.log("Menu-like elements:", visibleElements);
});

test("t11 export button state", async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  const exportBtn = page.locator("button").filter({ hasText: "mp4" });
  const disabledBefore = await exportBtn.getAttribute("disabled");
  console.log("Export disabled before video:", disabledBefore !== null);
  await uploadVideo(page);
  const disabledAfter = await exportBtn.getAttribute("disabled");
  console.log("Export disabled after video:", disabledAfter !== null);
  expect(disabledAfter).toBeNull();
});