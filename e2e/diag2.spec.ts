import { test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173/";

test("fetch_diag", async ({ page }) => {
  test.setTimeout(60000);
  const consoleLogs: string[] = [];
  page.on("console", (msg) => consoleLogs.push("[" + msg.type() + "] " + msg.text()));
  page.on("pageerror", (err) => consoleLogs.push("[PAGEERROR] " + err.message));
  page.on("requestfailed", (req) => consoleLogs.push("[REQFAIL] " + req.url() + " " + req.failure()?.errorText));

  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  const result = await page.evaluate(async () => {
    try {
      const cdnBase = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
      const url = cdnBase + "/ffmpeg-core.js";
      const res = await fetch(url);
      const text = await res.text();
      return {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries([...res.headers.entries()]),
        bodyLength: text.length,
      };
    } catch (err) {
      return { error: String(err) };
    }
  });
  console.log("Fetch result:", JSON.stringify(result, null, 2));
  console.log("Console logs:", consoleLogs.join("\n"));
});