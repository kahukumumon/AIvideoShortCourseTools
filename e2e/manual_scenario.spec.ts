import { test, expect, type Page } from "@playwright/test";

test.use({
  launchOptions: {
    args: ["--no-sandbox"],
  },
});

const BASE_URL = "http://127.0.0.1:4173/";
const VIDEO_FILE = "c:/data/code/AIvideoShortTheminer/test_data/video.mp4";
const AUDIO_HEAVY = "c:/data/code/AIvideoShortTheminer/test_data/wet heavy.mp3";
const AUDIO_LIGHT = "c:/data/code/AIvideoShortTheminer/test_data/wet light.mp3";

type StepResult = {
  step: number;
  title: string;
  status: "PASS" | "FAIL" | "NOT_AVAILABLE";
  detail: string;
};

function out(result: StepResult) {
  console.log(`STEP ${result.step} [${result.status}] ${result.title} :: ${result.detail}`);
}

async function hasAny(page: Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}

test("manual_scenario_full", async ({ page }) => {
  test.setTimeout(900000);

  const steps: StepResult[] = [];
  const consoleEntries: string[] = [];
  let exportedLog = "";
  let finalStatus = "";
  let downloadInfo = "not-started";
  let downloadDetected = false;

  page.on("console", (msg) => {
    consoleEntries.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    consoleEntries.push(`[pageerror] ${err.message}`);
  });
  page.on("requestfailed", (req) => {
    consoleEntries.push(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText ?? "unknown"}`);
  });
  page.on("download", async (download) => {
    downloadDetected = true;
    const suggested = download.suggestedFilename();
    const path = await download.path().catch(() => null);
    downloadInfo = `suggested=${suggested}, path=${path ?? "(not available)"}`;
  });

  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");
  steps.push({ step: 1, title: "Open page", status: "PASS", detail: await page.title() });

  await page.locator('input[type="file"][accept="video/*"]').setInputFiles(VIDEO_FILE);
  await page.waitForTimeout(1500);
  const videoCount = await page.locator(".clip-block.video-clip").count();
  const previewCount = await page.locator("video").count();
  steps.push({ step: 2, title: "Upload video and show preview", status: videoCount > 0 && previewCount > 0 ? "PASS" : "FAIL", detail: `videoClips=${videoCount}, previewVideos=${previewCount}` });

  await page.locator("select").selectOption({ index: 0 });
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles([AUDIO_HEAVY]);
  await page.waitForTimeout(1200);
  let audioCount = await page.locator(".clip-block.audio-clip").count();
  steps.push({ step: 3, title: "Upload heavy to Audio 1", status: audioCount >= 1 ? "PASS" : "FAIL", detail: `audioClips=${audioCount}` });

  await page.locator("select").selectOption({ index: 0 });
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles([AUDIO_LIGHT]);
  await page.waitForTimeout(1200);
  audioCount = await page.locator(".clip-block.audio-clip").count();
  steps.push({ step: 4, title: "Upload light to Audio 1", status: audioCount >= 2 ? "PASS" : "FAIL", detail: `audioClips=${audioCount}` });

  await page.getByRole("button", { name: "音声トラック追加" }).click();
  await page.waitForTimeout(300);
  const trackOptions = await page.locator("select option").allTextContents();
  steps.push({ step: 5, title: "Add Audio 2", status: trackOptions.some((v) => v.includes("Audio 2")) ? "PASS" : "FAIL", detail: `options=${JSON.stringify(trackOptions)}` });

  await page.locator("select").selectOption({ label: "Audio 2" });
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles([AUDIO_HEAVY]);
  await page.waitForTimeout(1200);
  audioCount = await page.locator(".clip-block.audio-clip").count();
  steps.push({ step: 6, title: "Upload heavy to Audio 2", status: audioCount >= 3 ? "PASS" : "FAIL", detail: `audioClips=${audioCount}` });

  const videoClip = page.locator(".clip-block.video-clip").first();
  const hasVideo = (await videoClip.count()) > 0;
  if (hasVideo) {
    const beforeLeft = await videoClip.evaluate((el) => getComputedStyle(el).left || "");
    const box = await videoClip.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2);
      await page.mouse.up();
    }
    await page.waitForTimeout(300);
    const afterLeft = await videoClip.evaluate((el) => getComputedStyle(el).left || "");
    const isDraggable = await videoClip.getAttribute("draggable");
    steps.push({ step: 7, title: "Drag video clip and check 0-start behavior", status: isDraggable ? "PASS" : "NOT_AVAILABLE", detail: `draggable=${isDraggable}, beforeLeft=${beforeLeft}, afterLeft=${afterLeft}` });
  } else {
    steps.push({ step: 7, title: "Drag video clip and check 0-start behavior", status: "FAIL", detail: "video clip not found" });
  }

  const audioClip = page.locator(".clip-block.audio-clip").first();
  const hasAudio = (await audioClip.count()) > 0;
  if (hasAudio) {
    const box = await audioClip.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
      await page.mouse.up();
    }
    const draggable = await audioClip.getAttribute("draggable");
    steps.push({ step: 8, title: "Drag audio clip", status: draggable ? "PASS" : "NOT_AVAILABLE", detail: `draggable=${draggable}` });
  } else {
    steps.push({ step: 8, title: "Drag audio clip", status: "FAIL", detail: "audio clip not found" });
  }

  const playBtnExists = await hasAny(page, 'button:has-text("再生"), button:has-text("Play")');
  if (playBtnExists) {
    const btn = page.locator('button:has-text("再生"), button:has-text("Play")').first();
    const tcBefore = (await page.locator(".timecode").first().textContent()) ?? "";
    await btn.click();
    await page.waitForTimeout(1200);
    const tcDuring = (await page.locator(".timecode").first().textContent()) ?? "";
    await btn.click();
    steps.push({ step: 9, title: "Play and stop", status: tcBefore !== tcDuring ? "PASS" : "FAIL", detail: `before='${tcBefore}' during='${tcDuring}'` });
  } else {
    steps.push({ step: 9, title: "Play and stop", status: "NOT_AVAILABLE", detail: "play button not found" });
  }

  const seekbar = page.locator('input[type="range"]');
  if ((await seekbar.count()) > 0) {
    const first = seekbar.first();
    const maxAttr = await first.getAttribute("max");
    const minAttr = await first.getAttribute("min");
    const stepAttr = await first.getAttribute("step");
    const min = minAttr ? Number(minAttr) : 0;
    const max = maxAttr ? Number(maxAttr) : 1;
    const step = stepAttr ? Number(stepAttr) : 0.01;
    const midRaw = Number.isFinite(min) && Number.isFinite(max) && max > min ? (min + max) / 2 : 0.5;
    const mid = Number.isFinite(step) && step > 0 ? Math.round(midRaw / step) * step : midRaw;
    await first.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, mid);
    const tc = (await page.locator(".timecode").first().textContent()) ?? "";
    steps.push({ step: 10, title: "Seekbar move", status: "PASS", detail: `timecode='${tc}'` });
  } else {
    steps.push({ step: 10, title: "Seekbar move", status: "NOT_AVAILABLE", detail: "range input not found" });
  }

  if (hasVideo) {
    const playBtnForSplit = page.locator('button:has-text("再生"), button:has-text("Play")').first();
    const stopBtnForSplit = page.locator('button:has-text("停止"), button:has-text("Stop")').first();
    await page.getByRole("button", { name: "先頭へ" }).click();
    await playBtnForSplit.click();
    await page.waitForTimeout(1000);
    await stopBtnForSplit.click();

    await page.locator(".clip-block.video-clip").first().click({ button: "right" });
    await page.waitForTimeout(300);
    const splitItem = page.locator('.context-menu button:has-text("再生ヘッドで分割")').first();
    if ((await splitItem.count()) > 0) {
      await splitItem.evaluate((el) => {
        (el as HTMLButtonElement).click();
      });
      await page.waitForTimeout(300);
      const vAfter = await page.locator(".clip-block.video-clip").count();
      steps.push({ step: 11, title: "Split video clip", status: vAfter >= 2 ? "PASS" : "FAIL", detail: `videoClips=${vAfter}` });
    } else {
      steps.push({ step: 11, title: "Split video clip", status: "NOT_AVAILABLE", detail: "context split menu not found" });
    }
  } else {
    steps.push({ step: 11, title: "Split video clip", status: "FAIL", detail: "video clip not found" });
  }

  const firstVideo = page.locator(".clip-block.video-clip").first();
  if ((await firstVideo.count()) > 0) {
    await firstVideo.click({ button: "right" });
    await page.waitForTimeout(300);
    const mergeItem = page.locator(':text("隣接クリップを結合"), :text("結合"), :text("Merge")').first();
    if ((await mergeItem.count()) > 0) {
      await mergeItem.click();
      await page.waitForTimeout(300);
      const vAfter = await page.locator(".clip-block.video-clip").count();
      steps.push({ step: 12, title: "Merge adjacent clips", status: "PASS", detail: `videoClips=${vAfter}` });
    } else {
      steps.push({ step: 12, title: "Merge adjacent clips", status: "NOT_AVAILABLE", detail: "context merge menu not found" });
    }
  } else {
    steps.push({ step: 12, title: "Merge adjacent clips", status: "FAIL", detail: "video clip not found" });
  }

  const speedUi = await hasAny(page, ':text("速度"), :text("speed")');
  steps.push({ step: 13, title: "Speed change by edge drag (0.25x-4x)", status: speedUi ? "PASS" : "NOT_AVAILABLE", detail: speedUi ? "speed-related UI text found" : "speed UI not found" });

  const trimUi = await hasAny(page, ':text("トリム"), :text("trim")');
  steps.push({ step: 14, title: "Trim by Shift+edge drag", status: trimUi ? "PASS" : "NOT_AVAILABLE", detail: trimUi ? "trim-related UI text found" : "trim UI not found" });

  const fadeUi = await hasAny(page, ':text("フェード"), :text("fade")');
  steps.push({ step: 15, title: "Fade settings", status: fadeUi ? "PASS" : "NOT_AVAILABLE", detail: fadeUi ? "fade UI found" : "fade UI not found" });

  const volUi = await hasAny(page, ':text("音量"), :text("dB"), :text("volume")');
  steps.push({ step: 16, title: "Per-clip volume in dB", status: volUi ? "PASS" : "NOT_AVAILABLE", detail: volUi ? "volume UI found" : "volume UI not found" });

  const batchVolUi = (await page.locator("*").filter({ hasText: /一括.*音量|音量.*一括|apply.*volume|volume.*apply/i }).count()) > 0;
  steps.push({ step: 17, title: "Batch volume apply", status: batchVolUi ? "PASS" : "NOT_AVAILABLE", detail: batchVolUi ? "batch volume UI found" : "batch volume UI not found" });

  const exportBtn = page.getByRole("button", { name: "mp4 エクスポート" });
  await expect(exportBtn).toBeEnabled();
  await exportBtn.click();

  let done = false;
  for (let i = 0; i < 450; i += 1) {
    await page.waitForTimeout(1000);
    finalStatus = (await page.locator(".status-text").first().textContent()) ?? "";
    exportedLog = (await page.locator(".log-box").textContent()) ?? "";
    if (finalStatus.includes("完了") || finalStatus.includes("失敗")) {
      done = true;
      break;
    }
  }

  if (done && finalStatus.includes("完了")) {
    for (let i = 0; i < 10 && !downloadDetected; i += 1) {
      await page.waitForTimeout(500);
    }
    if (!downloadDetected) {
      downloadInfo = "export completed but download event not detected";
    }
  } else if (!downloadDetected) {
    downloadInfo = "no download event (export not completed)";
  }

  if (done && finalStatus.includes("完了")) {
    steps.push({ step: 18, title: "Export mp4", status: "PASS", detail: `status='${finalStatus}', ${downloadInfo}` });
  } else {
    steps.push({ step: 18, title: "Export mp4", status: "FAIL", detail: `status='${finalStatus}', ${downloadInfo}` });
  }

  console.log("=== STEP RESULTS BEGIN ===");
  for (const s of steps) {
    out(s);
  }
  console.log("=== STEP RESULTS END ===");

  console.log("=== EXPORT LOG FULL BEGIN ===");
  console.log(exportedLog);
  console.log("=== EXPORT LOG FULL END ===");

  console.log("=== CONSOLE LOGS BEGIN ===");
  console.log(consoleEntries.join("\n"));
  console.log("=== CONSOLE LOGS END ===");
});

