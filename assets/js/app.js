const ffmpegModules = {
  ready: null,
  FFmpeg: null,
  fetchFile: null,
  toBlobURL: null,
  vendorModuleURL: null,
};

const ffmpegState = {
  instance: null,
  loading: null,
  ready: false,
  busy: false,
  activeTool: null,
  cancelCurrent: null,
};

const concatState = {
  items: [],
  nameCounts: new Map(),
};

const ugoiraState = {
  file: null,
  objectUrl: "",
  metadata: null,
};

const pixivState = {
  file: null,
  objectUrl: "",
  image: null,
  displayWidth: 900,
  displayHeight: 900,
  crop: null,
  drag: null,
};

const characterDefaults = {
  hairStyle: "medium hair",
  hairExtra: "",
  hairColor: "black",
  eyeColor: "green eyes",
  headAccent: "",
  bust: "large breasts",
  skinColor: "",
  videoMode: false,
};

const characterNegativeBase = [
  "(multi color hair,Inner color:1.2)",
  "score_6",
  "score_5",
  "score_4",
  "score_furry",
  "source_pony",
  "source_cartoon",
  "ugly face",
  "ugly eyes",
  "red pupils",
  "(deformity, out door)",
  "username",
  "manicure",
  "earring",
  "bag",
  "shoes",
  "text",
  "letters",
  "symbols",
  "question mark",
  "watermark",
  "logo",
  "(sword:1.2)",
];

const characterNegativeVideo = [
  "wet water",
  "action lines",
  "impact lines",
  "speed lines",
  "collision effect",
  "comic burst",
  "comic effect lines",
  "manga effect",
  "stylized explosion",
  "motion blur lines",
  "cartoon impact",
  "dynamic lines",
  "swoosh lines",
  "onomatopoeia",
  "steam",
  "hot steam",
  "vapor",
  "mist",
  "fog",
  "condensation",
  "visible breath",
  "breath vapor",
  "breath mist",
  "white breath",
  "puff of air",
  "breath puff",
  "breath cloud",
  "anime breath",
  "smoke puff",
  "sweat",
  "perspiration",
  "sweat drops",
  "sweatdrop",
  "dripping sweat",
  "sweat beads",
  "water droplets",
  "droplets",
  "wet skin",
  "wet spot",
  "damp skin",
  "moist skin",
  "oily sheen",
  "glistening skin",
  "sweaty shine",
  "dripping liquid",
  "trickle",
  "sticky skin",
];

const characterSettingsText = "Steps: 25, Sampler: Euler a, Schedule type: Automatic, CFG scale: 7, Seed: -1, Size: 768x1088, Model hash: bdb59bac77, Model: waiNSFWIllustrious_v140, Denoising strength: 0.37, ADetailer model: face_yolov8n.pt, ADetailer confidence: 0.3, ADetailer dilate erode: 4, ADetailer mask blur: 4, ADetailer denoising strength: 0.4, ADetailer inpaint only masked: True, ADetailer inpaint padding: 32, ADetailer version: 25.3.0, Hires Module 1: Use same choices, Hires CFG Scale: 5, Hires upscale: 1.5, Hires upscaler: R-ESRGAN 4x+, Version: f2.0.1v1.10.1-previous-669-gdfdcbab6, Module 1: sdxl_vae";

let concatEls = null;
let ugoiraEls = null;
let pixivEls = null;
let pixivCtx = null;
let characterEls = null;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return `${seconds.toFixed(2)} 秒`;
}

function formatTimestamp() {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

function setStatus(element, message, tone = "default") {
  if (!element) return;
  element.className = `status-card${tone === "default" ? "" : ` ${tone}`}`;
  element.innerHTML = `<div class="status-text">${message}</div>`;
}

function appendLog(element, message) {
  if (!element) return;
  const prefix = element.textContent === "" ? "" : `${element.textContent}\n`;
  const next = `${prefix}[${formatTimestamp()}] ${message}`;
  element.textContent = next.split("\n").slice(-160).join("\n");
  element.scrollTop = element.scrollHeight;
}

function setProgress(element, value) {
  if (!element) return;
  const bounded = Math.max(0, Math.min(1, Number(value) || 0));
  element.style.width = `${(bounded * 100).toFixed(1)}%`;
}

function disableButtons(disabled, ...elements) {
  elements.forEach((element) => {
    if (element) element.disabled = disabled;
  });
}

function sanitizeBaseName(name) {
  return name.replace(/\.[^.]+$/, "");
}

function joinPromptParts(parts) {
  return parts.filter(Boolean).join(",");
}

function splitName(name) {
  const match = name.match(/^(.*?)(\.[^.]+)?$/);
  return {
    base: match?.[1] || name,
    ext: match?.[2] || "",
  };
}

function toEven(value) {
  const rounded = Math.max(2, Math.round(Number(value) || 0));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function getUgoiraSafeSize(metadata, frameCount, budgetScale = 1) {
  const width = Number(metadata?.width) || 0;
  const height = Number(metadata?.height) || 0;
  if (!width || !height) {
    return { width, height, downscaled: false, frameCount, budgetScale };
  }

  const longestEdgeCap = 1600;
  const pixelFrameBudget = 72_000_000 * Math.max(0.1, Number(budgetScale) || 1);
  const totalPixels = Math.max(1, width * height * Math.max(1, frameCount));
  const scaleByPixels = Math.min(1, Math.sqrt(pixelFrameBudget / totalPixels));
  const scaleByEdge = Math.min(1, longestEdgeCap / Math.max(width, height));
  const scale = Math.min(scaleByPixels, scaleByEdge);
  const safeWidth = toEven(width * scale);
  const safeHeight = toEven(height * scale);

  return {
    width: safeWidth,
    height: safeHeight,
    downscaled: safeWidth !== width || safeHeight !== height,
    frameCount,
    budgetScale,
  };
}

function makeAbortError() {
  const error = new Error("AbortError");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw makeAbortError();
  }
}

async function waitForVideoReady(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("動画データの読み込みに失敗しました。"));
    };
    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function seekVideo(video, time, signal) {
  throwIfAborted(signal);
  if (Math.abs(video.currentTime - time) < 0.001) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("動画シークに失敗しました。"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
  throwIfAborted(signal);
}

async function canvasToJpegBytes(canvas, quality = 0.92) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("JPG 変換に失敗しました。"));
      }
    }, "image/jpeg", quality);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function uniqueConcatLabel(name) {
  const count = (concatState.nameCounts.get(name) || 0) + 1;
  concatState.nameCounts.set(name, count);
  if (count === 1) return name;
  const { base, ext } = splitName(name);
  return `${base} (${count})${ext}`;
}

function refreshConcatNameCounts() {
  concatState.nameCounts = new Map();
  concatState.items.forEach((item) => {
    const current = concatState.nameCounts.get(item.originalName) || 0;
    concatState.nameCounts.set(item.originalName, current + 1);
  });
}

async function deleteDirIfExists(ffmpeg, path) {
  try {
    await ffmpeg.deleteDir(path);
  } catch (_) {
  }
}

async function prepareConcatInputs(ffmpeg) {
  const mountPoint = `concat_inputs_${crypto.randomUUID()}`;
  const mountedFiles = [];
  const listLines = [];

  for (let i = 0; i < concatState.items.length; i += 1) {
    const item = concatState.items[i];
    const ext = splitName(item.file.name).ext || ".mp4";
    const inputName = `concat_input_${String(i + 1).padStart(3, "0")}${ext}`;
    mountedFiles.push(new File([item.file], inputName, {
      type: item.file.type || "application/octet-stream",
      lastModified: item.file.lastModified || Date.now(),
    }));
    listLines.push(`file '${mountPoint}/${inputName}'`);
    appendLog(concatEls?.log, `入力追加: ${item.label}`);
  }

  appendLog(concatEls?.log, "入力動画を WORKERFS としてマウントします。");
  await ffmpeg.createDir(mountPoint);
  await ffmpeg.mount("WORKERFS", { files: mountedFiles }, mountPoint);

  return {
    listLines,
    async cleanup() {
      try {
        await ffmpeg.unmount(mountPoint);
      } catch (_) {
      }
      await deleteDirIfExists(ffmpeg, mountPoint);
    },
  };
}

function downloadBlob(blobLike, fileName, logElement = null) {
  const blob = blobLike instanceof Blob ? blobLike : new Blob([blobLike]);
  if (logElement) {
    appendLog(logElement, `ダウンロード準備: ${fileName} / ${formatBytes(blob.size)}`);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

function setupDropzone(root, input, onFiles) {
  if (!root || !input) return;
  if (!window.__dropzoneRegistry) {
    window.__dropzoneRegistry = new Map();
  }
  if (!window.__dropzoneListenersInstalled) {
    window.__dropzoneListenersInstalled = true;
    document.addEventListener(
      "dragover",
      (event) => {
        event.preventDefault();
      },
      true
    );
    document.addEventListener(
      "drop",
      (event) => {
        const zone = event.target instanceof Element ? event.target.closest(".dropzone") : null;
        if (!zone) return;
        const entry = window.__dropzoneRegistry.get(zone);
        if (!entry) return;
        if (event.__dropzoneHandled) return;
        event.__dropzoneHandled = true;
        event.preventDefault();
        event.stopPropagation();
        const files = [...event.dataTransfer.files];
        entry.onFiles(files);
      },
      true
    );
  }
  window.__dropzoneRegistry.set(root, { input, onFiles });
  const activate = () => root.classList.add("dragging");
  const deactivate = () => root.classList.remove("dragging");

  ["dragenter", "dragover"].forEach((eventName) => {
    root.addEventListener(eventName, (event) => {
      event.preventDefault();
      activate();
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    root.addEventListener(eventName, (event) => {
      event.preventDefault();
      deactivate();
    });
  });

  root.addEventListener("drop", (event) => {
    if (event.__dropzoneHandled) return;
    event.__dropzoneHandled = true;
    const files = [...event.dataTransfer.files];
    onFiles(files);
  });

  input.addEventListener("change", () => {
    const files = [...input.files];
    onFiles(files);
    input.value = "";
  });
}

function buildCharacterPrompt() {
  const promptParts = [
    characterEls.lora.value,
    `${characterEls.hairColor.value} hair`,
    characterEls.hairStyle.value,
    characterEls.hairExtra.value,
    characterEls.headAccent.value,
    characterEls.eyeColor.value,
    characterEls.bust.value,
    characterEls.skinColor.value,
    "school uniform",
    "classroom",
    "Wave hand",
    "standing",
    "cowboy shot",
    "smile",
  ];

  const negativeParts = [
    ...characterNegativeBase,
    ...(characterEls.videoMode.checked ? characterNegativeVideo : []),
  ];

  return {
    pngInfo: [
      `${joinPromptParts(promptParts)}`,
      `Negative prompt: ${negativeParts.join(",")}`,
      characterSettingsText,
    ].join("\n"),
  };
}

function updateCharacterTool() {
  if (!characterEls) return;
  const prompt = buildCharacterPrompt();
  characterEls.pngInfo.value = prompt.pngInfo;
  setStatus(
    characterEls.status,
    `pnginfo 更新済み: LoRA ${characterEls.lora.value ? "ON" : "OFF"} / 動画用 ${characterEls.videoMode.checked ? "ON" : "OFF"}`,
    "default"
  );
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.setAttribute("readonly", "readonly");
  temp.style.position = "fixed";
  temp.style.opacity = "0";
  document.body.append(temp);
  temp.select();
  document.execCommand("copy");
  temp.remove();
}

function resetCharacterTool() {
  if (!characterEls) return;
  characterEls.hairStyle.value = characterDefaults.hairStyle;
  characterEls.hairExtra.value = characterDefaults.hairExtra;
  characterEls.hairColor.value = characterDefaults.hairColor;
  characterEls.eyeColor.value = characterDefaults.eyeColor;
  characterEls.headAccent.value = characterDefaults.headAccent;
  characterEls.bust.value = characterDefaults.bust;
  characterEls.skinColor.value = characterDefaults.skinColor;
  characterEls.lora.value = "";
  characterEls.videoMode.checked = characterDefaults.videoMode;
  updateCharacterTool();
}

async function ensureVendorFFmpegModuleURL() {
  if (ffmpegModules.vendorModuleURL) return ffmpegModules.vendorModuleURL;
  const wrapperBaseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm";
  const files = ["index.js", "classes.js", "const.js", "errors.js", "types.js", "utils.js", "worker.js"];
  const sources = {};

  await Promise.all(files.map(async (file) => {
    const response = await fetch(`${wrapperBaseURL}/${file}`);
    if (!response.ok) {
      throw new Error(`ffmpeg ラッパーファイルの読み込みに失敗しました: ${file}`);
    }
    sources[file] = await response.text();
  }));

  const blobModule = (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const constURL = blobModule(sources["const.js"]);
  const errorsURL = blobModule(sources["errors.js"]);
  const utilsURL = blobModule(sources["utils.js"]);
  const typesURL = blobModule(sources["types.js"]);
  const workerSource = sources["worker.js"]
    .replace("./const.js", constURL)
    .replace("./errors.js", errorsURL);
  const workerURL = blobModule(workerSource);
  const classesSource = sources["classes.js"]
    .replace("./const.js", constURL)
    .replace("./utils.js", utilsURL)
    .replace("./errors.js", errorsURL)
    .replace("./worker.js", workerURL);
  const classesURL = blobModule(classesSource);
  const indexSource = sources["index.js"]
    .replace("./classes.js", classesURL)
    .replace("./types.js", typesURL);

  ffmpegModules.vendorModuleURL = blobModule(indexSource);
  return ffmpegModules.vendorModuleURL;
}

async function ensureFFmpegModules() {
  if (!ffmpegModules.ready) {
    ffmpegModules.ready = (async () => {
      const vendorModuleURL = await ensureVendorFFmpegModuleURL();
      const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import(vendorModuleURL),
        import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js"),
      ]);
      ffmpegModules.FFmpeg = FFmpeg;
      ffmpegModules.fetchFile = fetchFile;
      ffmpegModules.toBlobURL = toBlobURL;
    })();
  }
  return ffmpegModules.ready;
}

function routeLog(message) {
  if (ffmpegState.activeTool === "concat") {
    appendLog(concatEls?.log, message);
  } else if (ffmpegState.activeTool === "ugoira") {
    appendLog(ugoiraEls?.log, message);
  }
}

function routeProgress(progress) {
  if (ffmpegState.activeTool === "concat") {
    setProgress(concatEls?.progress, progress);
  } else if (ffmpegState.activeTool === "ugoira") {
    setProgress(ugoiraEls?.progress, progress);
  }
}

async function ensureFFmpeg(tool) {
  ffmpegState.activeTool = tool;
  await ensureFFmpegModules();
  if (ffmpegState.ready && ffmpegState.instance) return ffmpegState.instance;
  if (!ffmpegState.loading) {
    ffmpegState.loading = (async () => {
      routeLog("ffmpeg.wasm を初期化します。初回は 30MB 前後を読み込みます。");
      const ffmpeg = new ffmpegModules.FFmpeg();
      ffmpeg.on("log", ({ message }) => routeLog(message));
      ffmpeg.on("progress", ({ progress }) => routeProgress(progress));
      const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
      routeLog("ffmpeg-core を CDN から取得しています。");
      await ffmpeg.load({
        coreURL: await ffmpegModules.toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await ffmpegModules.toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegState.instance = ffmpeg;
      ffmpegState.ready = true;
      routeLog("ffmpeg.wasm の準備が完了しました。");
      return ffmpeg;
    })().finally(() => {
      ffmpegState.loading = null;
    });
  }
  return ffmpegState.loading;
}

function resetFFmpegState() {
  ffmpegState.instance = null;
  ffmpegState.ready = false;
  ffmpegState.loading = null;
  ffmpegState.busy = false;
  ffmpegState.activeTool = null;
  ffmpegState.cancelCurrent = null;
}

function cancelCurrentTask(message) {
  if (!ffmpegState.busy) return;
  routeLog(message);
  if (ffmpegState.cancelCurrent) {
    try {
      ffmpegState.cancelCurrent();
    } catch (_) {
    }
  }
  if (ffmpegState.instance) {
    ffmpegState.instance.terminate();
  }
  resetFFmpegState();
  disableButtons(true, concatEls?.cancel, ugoiraEls?.cancel);
  disableButtons(false, concatEls?.run, ugoiraEls?.run);
  setStatus(concatEls?.status, "現在の処理をキャンセルしました。必要ならそのまま再実行できます。", "default");
  setStatus(ugoiraEls?.status, "現在の処理をキャンセルしました。必要ならそのまま再実行できます。", "default");
  setProgress(concatEls?.progress, 0);
  setProgress(ugoiraEls?.progress, 0);
}

async function withFFmpegTask(tool, runner) {
  if (ffmpegState.busy) {
    throw new Error("別の動画処理が進行中です。完了またはキャンセル後に再実行してください。");
  }
  ffmpegState.busy = true;
  ffmpegState.activeTool = tool;
  ffmpegState.cancelCurrent = null;

  if (tool === "concat") {
    disableButtons(true, concatEls?.run);
    disableButtons(false, concatEls?.cancel);
    setProgress(concatEls?.progress, 0);
  }
  if (tool === "ugoira") {
    disableButtons(true, ugoiraEls?.run);
    disableButtons(false, ugoiraEls?.cancel);
    setProgress(ugoiraEls?.progress, 0);
  }

  try {
    const ffmpeg = await ensureFFmpeg(tool);
    const result = await runner(ffmpeg);
    routeProgress(1);
    return result;
  } catch (error) {
    if (!/terminated|abort/i.test(String(error?.message || ""))) {
      routeLog(`エラー: ${error.message || error}`);
    }
    throw error;
  } finally {
    ffmpegState.busy = false;
    if (tool === "concat") {
      disableButtons(false, concatEls?.run);
      disableButtons(true, concatEls?.cancel);
    }
    if (tool === "ugoira") {
      disableButtons(false, ugoiraEls?.run);
      disableButtons(true, ugoiraEls?.cancel);
    }
    ffmpegState.activeTool = null;
    ffmpegState.cancelCurrent = null;
  }
}

async function withCancelableTask(tool, runner) {
  if (ffmpegState.busy) {
    throw new Error("別の動画処理が進行中です。完了またはキャンセル後に再実行してください。");
  }

  const controller = new AbortController();
  ffmpegState.busy = true;
  ffmpegState.activeTool = tool;
  ffmpegState.cancelCurrent = () => controller.abort();

  if (tool === "ugoira") {
    disableButtons(true, ugoiraEls?.run);
    disableButtons(false, ugoiraEls?.cancel);
    setProgress(ugoiraEls?.progress, 0);
  }

  try {
    const result = await runner(controller.signal);
    routeProgress(1);
    return result;
  } catch (error) {
    if (!/terminated|abort/i.test(String(error?.message || error))) {
      routeLog(`エラー: ${error.message || error}`);
    }
    throw error;
  } finally {
    ffmpegState.busy = false;
    if (tool === "ugoira") {
      disableButtons(false, ugoiraEls?.run);
      disableButtons(true, ugoiraEls?.cancel);
    }
    ffmpegState.activeTool = null;
    ffmpegState.cancelCurrent = null;
  }
}

async function removeFiles(ffmpeg, files) {
  for (const file of files) {
    try {
      await ffmpeg.deleteFile(file);
    } catch (_) {
    }
  }
}

function renderConcatList() {
  if (!concatEls?.list) return;
  concatEls.list.innerHTML = "";
  if (concatState.items.length === 0) {
    concatEls.list.innerHTML = '<div class="empty">まだ動画が追加されていません。</div>';
    setStatus(concatEls.status, "動画を 2 本以上入れると連結できます。", "default");
    return;
  }

  const total = concatState.items.reduce((sum, item) => sum + item.file.size, 0);
  setStatus(
    concatEls.status,
    `${concatState.items.length} 本 / 合計 ${formatBytes(total)}。上から順に連結します。`,
    "default"
  );

  concatState.items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div>
        <div class="list-title">${index + 1}. ${item.label}</div>
        <div class="list-sub">${formatBytes(item.file.size)} / ${item.file.type || "video/*"}</div>
      </div>
      <div class="item-actions">
        <button class="secondary" data-action="up" data-id="${item.id}">上へ</button>
        <button class="secondary" data-action="down" data-id="${item.id}">下へ</button>
        <button class="danger" data-action="remove" data-id="${item.id}">削除</button>
      </div>
    `;
    concatEls.list.append(row);
  });
}

function addConcatFiles(files) {
  const videoFiles = files.filter((file) => file instanceof File);
  if (videoFiles.length === 0) return;
  videoFiles.forEach((file) => {
    concatState.items.push({
      id: crypto.randomUUID(),
      file,
      originalName: file.name,
      label: uniqueConcatLabel(file.name),
    });
  });
  renderConcatList();
  appendLog(concatEls?.log, `${videoFiles.length} 本の動画を追加しました。`);
}

async function getVideoMetadata(file) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = objectUrl;
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      const metadata = {
        duration: Number(video.duration) || 0,
        width: Number(video.videoWidth) || 0,
        height: Number(video.videoHeight) || 0,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(metadata);
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("動画メタデータを読み取れませんでした。"));
    };
  });
}

function updateUgoiraSummary() {
  if (!ugoiraEls?.status) return;
  if (!ugoiraState.file || !ugoiraState.metadata) {
    setStatus(ugoiraEls.status, "動画を追加すると、長さと想定フレーム数を表示します。", "default");
    return;
  }

  const start = Math.max(0, Number(ugoiraEls.start.value) || 0);
  const end = Math.max(0, Number(ugoiraEls.end.value) || 0);
  const fps = Math.max(1, Math.round(Number(ugoiraEls.fps.value) || 8));
  const span = Math.max(0, end - start);
  const frames = Math.floor(span * fps);
  const safeSize = getUgoiraSafeSize(ugoiraState.metadata, frames);
  const resizeNote = safeSize.downscaled ? ` / 出力 ${safeSize.width}×${safeSize.height} に自動縮小` : "";

  setStatus(
    ugoiraEls.status,
    `${ugoiraState.file.name} / ${ugoiraState.metadata.width}×${ugoiraState.metadata.height} / ${formatSeconds(ugoiraState.metadata.duration)} / 想定 ${frames} 枚${resizeNote}`,
    "default"
  );
}

async function setUgoiraFile(file) {
  if (!(file instanceof File) || !ugoiraEls) return;
  if (ugoiraState.objectUrl) URL.revokeObjectURL(ugoiraState.objectUrl);
  ugoiraState.file = file;
  ugoiraState.metadata = await getVideoMetadata(file);
  ugoiraState.objectUrl = URL.createObjectURL(file);
  ugoiraEls.preview.src = ugoiraState.objectUrl;
  ugoiraEls.previewWrap.hidden = false;
  ugoiraEls.start.value = "0";
  ugoiraEls.end.value = ugoiraState.metadata.duration.toFixed(2);
  updateUgoiraSummary();
  appendLog(ugoiraEls.log, `動画を読み込みました: ${file.name}`);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function initializePixivCrop() {
  if (!pixivState.image) return;
  const size = Math.floor(Math.min(pixivState.displayWidth, pixivState.displayHeight) * 0.72);
  pixivState.crop = {
    x: Math.round((pixivState.displayWidth - size) / 2),
    y: Math.round((pixivState.displayHeight - size) / 2),
    size,
  };
  drawPixivCanvas();
}

function drawPixivCanvas() {
  if (!pixivEls?.canvas || !pixivCtx) return;
  const { image, displayWidth, displayHeight, crop } = pixivState;
  pixivCtx.clearRect(0, 0, pixivEls.canvas.width, pixivEls.canvas.height);
  pixivEls.canvas.width = displayWidth;
  pixivEls.canvas.height = displayHeight;

  if (!image) {
    pixivCtx.fillStyle = "#f1e7d8";
    pixivCtx.fillRect(0, 0, pixivEls.canvas.width, pixivEls.canvas.height);
    pixivCtx.fillStyle = "#7b6e61";
    pixivCtx.font = "18px Avenir Next, Hiragino Sans, Yu Gothic UI, sans-serif";
    pixivCtx.textAlign = "center";
    pixivCtx.fillText("画像を追加するとここにプレビューを表示します。", pixivEls.canvas.width / 2, pixivEls.canvas.height / 2);
    return;
  }

  pixivCtx.drawImage(image, 0, 0, displayWidth, displayHeight);
  if (!crop) return;

  const cropAccent = "#ffe45c";

  pixivCtx.save();
  pixivCtx.strokeStyle = cropAccent;
  pixivCtx.lineWidth = 3;
  pixivCtx.shadowColor = "rgba(18, 20, 25, 0.9)";
  pixivCtx.shadowBlur = 12;
  pixivCtx.strokeRect(crop.x, crop.y, crop.size, crop.size);
  pixivCtx.restore();

  pixivCtx.save();
  pixivCtx.setLineDash([8, 6]);
  pixivCtx.strokeStyle = "rgba(255, 228, 92, 0.78)";
  pixivCtx.lineWidth = 1.5;
  pixivCtx.beginPath();
  pixivCtx.moveTo(crop.x, crop.y + crop.size / 2);
  pixivCtx.lineTo(crop.x + crop.size, crop.y + crop.size / 2);
  pixivCtx.moveTo(crop.x + crop.size / 2, crop.y);
  pixivCtx.lineTo(crop.x + crop.size / 2, crop.y + crop.size);
  pixivCtx.stroke();
  pixivCtx.restore();

  const handles = getPixivHandles();
  pixivCtx.fillStyle = cropAccent;
  pixivCtx.strokeStyle = "#1f2631";
  pixivCtx.lineWidth = 1.5;
  handles.forEach(({ x, y }) => {
    pixivCtx.fillRect(x - 6, y - 6, 12, 12);
    pixivCtx.strokeRect(x - 6, y - 6, 12, 12);
  });

  const scale = pixivState.image.naturalWidth / displayWidth;
  pixivEls.caption.textContent = `選択範囲: ${Math.round(crop.size * scale)} × ${Math.round(crop.size * scale)} px / 出力: 900 × 900 px`;
}

function getPixivHandles() {
  const { crop } = pixivState;
  if (!crop) return [];
  return [
    { key: "nw", x: crop.x, y: crop.y },
    { key: "ne", x: crop.x + crop.size, y: crop.y },
    { key: "sw", x: crop.x, y: crop.y + crop.size },
    { key: "se", x: crop.x + crop.size, y: crop.y + crop.size },
  ];
}

function getPixivPoint(event) {
  const rect = pixivEls.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (pixivEls.canvas.width / rect.width),
    y: (event.clientY - rect.top) * (pixivEls.canvas.height / rect.height),
  };
}

function hitPixivCrop(point) {
  const { crop } = pixivState;
  if (!crop) return null;
  for (const handle of getPixivHandles()) {
    if (Math.abs(point.x - handle.x) <= 14 && Math.abs(point.y - handle.y) <= 14) {
      return { type: "resize", handle: handle.key };
    }
  }
  if (
    point.x >= crop.x &&
    point.x <= crop.x + crop.size &&
    point.y >= crop.y &&
    point.y <= crop.y + crop.size
  ) {
    return { type: "move" };
  }
  return null;
}

function resizeSquare(handle, point, origin) {
  const minSize = 48;
  const maxW = pixivState.displayWidth;
  const maxH = pixivState.displayHeight;

  if (handle === "nw") {
    const anchorX = origin.x + origin.size;
    const anchorY = origin.y + origin.size;
    const limit = Math.min(anchorX, anchorY);
    const size = clamp(Math.max(anchorX - point.x, anchorY - point.y), minSize, limit);
    return { x: anchorX - size, y: anchorY - size, size };
  }
  if (handle === "ne") {
    const anchorX = origin.x;
    const anchorY = origin.y + origin.size;
    const limit = Math.min(maxW - anchorX, anchorY);
    const size = clamp(Math.max(point.x - anchorX, anchorY - point.y), minSize, limit);
    return { x: anchorX, y: anchorY - size, size };
  }
  if (handle === "sw") {
    const anchorX = origin.x + origin.size;
    const anchorY = origin.y;
    const limit = Math.min(anchorX, maxH - anchorY);
    const size = clamp(Math.max(anchorX - point.x, point.y - anchorY), minSize, limit);
    return { x: anchorX - size, y: anchorY, size };
  }

  const anchorX = origin.x;
  const anchorY = origin.y;
  const limit = Math.min(maxW - anchorX, maxH - anchorY);
  const size = clamp(Math.max(point.x - anchorX, point.y - anchorY), minSize, limit);
  return { x: anchorX, y: anchorY, size };
}

async function setPixivFile(file) {
  if (!(file instanceof File) || !pixivEls) return;
  if (pixivState.objectUrl) URL.revokeObjectURL(pixivState.objectUrl);
  pixivState.file = file;
  pixivState.objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = pixivState.objectUrl;
  await image.decode();
  pixivState.image = image;
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > 0 ? 900 / longest : 1;
  pixivState.displayWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  pixivState.displayHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  initializePixivCrop();
  setStatus(
    pixivEls.status,
    `${file.name} / 元画像 ${image.naturalWidth}×${image.naturalHeight} / プレビュー ${pixivState.displayWidth}×${pixivState.displayHeight}`,
    "default"
  );
}

function initConcatTool() {
  const input = document.getElementById("concatInput");
  if (!input) return;

  concatEls = {
    input,
    drop: document.getElementById("concatDrop"),
    list: document.getElementById("concatList"),
    run: document.getElementById("concatRun"),
    clear: document.getElementById("concatClear"),
    cancel: document.getElementById("concatCancel"),
    progress: document.getElementById("concatProgress"),
    status: document.getElementById("concatStatus"),
    log: document.getElementById("concatLog"),
  };

  concatEls.list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const targetId = button.dataset.id;
    const action = button.dataset.action;
    const index = concatState.items.findIndex((item) => item.id === targetId);
    if (index < 0) return;
    if (action === "remove") concatState.items.splice(index, 1);
    if (action === "up" && index > 0) {
      [concatState.items[index - 1], concatState.items[index]] = [concatState.items[index], concatState.items[index - 1]];
    }
    if (action === "down" && index < concatState.items.length - 1) {
      [concatState.items[index + 1], concatState.items[index]] = [concatState.items[index], concatState.items[index + 1]];
    }
    refreshConcatNameCounts();
    renderConcatList();
  });

  concatEls.clear.addEventListener("click", () => {
    concatState.items = [];
    concatState.nameCounts = new Map();
    renderConcatList();
    appendLog(concatEls.log, "動画リストをクリアしました。");
    setProgress(concatEls.progress, 0);
  });

  concatEls.cancel.addEventListener("click", () => {
    cancelCurrentTask("ユーザー操作で動画連結をキャンセルしました。");
  });

  concatEls.run.addEventListener("click", async () => {
    if (concatState.items.length < 2) {
      setStatus(concatEls.status, "動画は 2 本以上必要です。", "error");
      return;
    }
    appendLog(concatEls.log, "動画連結を開始します。");
    setStatus(concatEls.status, "ffmpeg で連結中です。ブラウザを閉じずに待ってください。", "default");
    try {
      await withFFmpegTask("concat", async (ffmpeg) => {
        const createdFiles = [];
        let preparedInputs = null;
        try {
          preparedInputs = await prepareConcatInputs(ffmpeg);
          await ffmpeg.writeFile("concat_list.txt", preparedInputs.listLines.join("\n"));
          createdFiles.push("concat_list.txt");
          const firstExt = splitName(concatState.items[0].file.name).ext || ".mp4";
          const outputName = `${sanitizeBaseName(concatState.items[0].file.name)}-concat${firstExt}`;
          createdFiles.push(outputName);
          const exitCode = await ffmpeg.exec([
            "-f", "concat",
            "-safe", "0",
            "-i", "concat_list.txt",
            "-c", "copy",
            outputName,
          ]);
          if (exitCode !== 0) {
            throw new Error("ffmpeg が 0 以外の終了コードを返しました。素材条件が揃っているか確認してください。");
          }
          const data = await ffmpeg.readFile(outputName);
          const mimeType = concatState.items[0].file.type || "video/mp4";
          const outputBlob = new Blob([data], { type: mimeType });
          appendLog(concatEls.log, `ffmpeg 出力サイズ: ${formatBytes(outputBlob.size)}`);
          downloadBlob(outputBlob, outputName, concatEls.log);
          setStatus(concatEls.status, `連結が完了しました。${outputName} をダウンロードしました。`, "success");
          appendLog(concatEls.log, `出力完了: ${outputName}`);
        } finally {
          await removeFiles(ffmpeg, createdFiles);
          if (preparedInputs) {
            await preparedInputs.cleanup();
          }
        }
      });
    } catch (error) {
      if (/terminated|abort/i.test(String(error?.message || ""))) return;
      setStatus(
        concatEls.status,
        `連結に失敗しました。${error.message || error} 同一パラメータの動画だけで再試行してください。`,
        "error"
      );
    }
  });

  setupDropzone(concatEls.drop, concatEls.input, addConcatFiles);
  renderConcatList();
}

function initUgoiraTool() {
  const input = document.getElementById("ugoiraInput");
  if (!input) return;

  ugoiraEls = {
    input,
    drop: document.getElementById("ugoiraDrop"),
    previewWrap: document.getElementById("ugoiraPreviewWrap"),
    preview: document.getElementById("ugoiraPreview"),
    start: document.getElementById("ugoiraStart"),
    end: document.getElementById("ugoiraEnd"),
    fps: document.getElementById("ugoiraFps"),
    markStart: document.getElementById("ugoiraMarkStart"),
    markEnd: document.getElementById("ugoiraMarkEnd"),
    run: document.getElementById("ugoiraRun"),
    cancel: document.getElementById("ugoiraCancel"),
    progress: document.getElementById("ugoiraProgress"),
    status: document.getElementById("ugoiraStatus"),
    log: document.getElementById("ugoiraLog"),
  };

  ugoiraEls.cancel.addEventListener("click", () => {
    cancelCurrentTask("ユーザー操作でうごイラ変換をキャンセルしました。");
  });

  ugoiraEls.markStart.addEventListener("click", () => {
    ugoiraEls.start.value = ugoiraEls.preview.currentTime.toFixed(2);
    updateUgoiraSummary();
  });

  ugoiraEls.markEnd.addEventListener("click", () => {
    ugoiraEls.end.value = ugoiraEls.preview.currentTime.toFixed(2);
    updateUgoiraSummary();
  });

  [ugoiraEls.start, ugoiraEls.end, ugoiraEls.fps].forEach((element) => {
    element.addEventListener("input", updateUgoiraSummary);
  });

  ugoiraEls.run.addEventListener("click", async () => {
    if (!ugoiraState.file || !ugoiraState.metadata) {
      setStatus(ugoiraEls.status, "先に動画を 1 本追加してください。", "error");
      return;
    }
    const start = Math.max(0, Number(ugoiraEls.start.value) || 0);
    const end = Math.max(0, Number(ugoiraEls.end.value) || 0);
    const fps = Math.max(1, Math.round(Number(ugoiraEls.fps.value) || 8));
    if (end <= start) {
      setStatus(ugoiraEls.status, "終了秒は開始秒より大きくしてください。", "error");
      return;
    }
    if (start >= ugoiraState.metadata.duration) {
      setStatus(ugoiraEls.status, "開始秒が動画時間を超えています。", "error");
      return;
    }
    const span = Math.min(end, ugoiraState.metadata.duration) - start;
    if (span <= 0) {
      setStatus(ugoiraEls.status, "切り出し範囲が 0 秒以下です。", "error");
      return;
    }

    appendLog(ugoiraEls.log, "うごイラ書き出しを開始します。");
    setStatus(ugoiraEls.status, "動画を 1 枚ずつ JPG 化しています。完了後に zip を保存します。", "default");

    try {
      await withCancelableTask("ugoira", async (signal) => {
        const expectedFrames = Math.max(1, Math.floor(span * fps));
        const safeSize = getUgoiraSafeSize(ugoiraState.metadata, expectedFrames);
        if (safeSize.downscaled) {
          appendLog(
            ugoiraEls.log,
            `ブラウザ負荷を抑えるため ${ugoiraState.metadata.width}×${ugoiraState.metadata.height} → ${safeSize.width}×${safeSize.height} に縮小します。`
          );
        }
        appendLog(ugoiraEls.log, `うごイラ変換: ${safeSize.width}×${safeSize.height} / 想定 ${expectedFrames} 枚`);

        const extractor = document.createElement("video");
        extractor.preload = "auto";
        extractor.muted = true;
        extractor.playsInline = true;
        extractor.src = ugoiraState.objectUrl;
        await waitForVideoReady(extractor);
        throwIfAborted(signal);

        const canvas = document.createElement("canvas");
        canvas.width = safeSize.width;
        canvas.height = safeSize.height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          throw new Error("Canvas の初期化に失敗しました。");
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        const zip = new JSZip();
        const frameTimes = [];
        for (let i = 0; ; i += 1) {
          const time = start + i / fps;
          if (time >= end || time > ugoiraState.metadata.duration) break;
          frameTimes.push(time);
        }
        if (frameTimes.length === 0) frameTimes.push(start);

        for (let i = 0; i < frameTimes.length; i += 1) {
          throwIfAborted(signal);
          const time = Math.min(frameTimes[i], Math.max(0, ugoiraState.metadata.duration - 0.001));
          await seekVideo(extractor, time, signal);
          context.drawImage(extractor, 0, 0, safeSize.width, safeSize.height);
          const jpgBytes = await canvasToJpegBytes(canvas, 0.92);
          const frameName = `frame_${String(i + 1).padStart(5, "0")}.jpg`;
          zip.file(frameName, jpgBytes, { binary: true });
          appendLog(ugoiraEls.log, `フレーム ${i + 1}/${frameTimes.length}: ${frameName}`);
          setProgress(ugoiraEls.progress, (i + 1) / frameTimes.length);
        }

        appendLog(ugoiraEls.log, `${frameTimes.length} 枚の JPG を zip にまとめます。`);
        const zipBlob = await zip.generateAsync({
          type: "blob",
          compression: "STORE",
          streamFiles: true,
        });
        const outputName = `${sanitizeBaseName(ugoiraState.file.name)}-${fps}fps.zip`;
        appendLog(ugoiraEls.log, `zip 出力サイズ: ${formatBytes(zipBlob.size)}`);
        downloadBlob(zipBlob, outputName, ugoiraEls.log);
        setStatus(ugoiraEls.status, `${frameTimes.length} 枚を書き出し、${outputName} をダウンロードしました。`, "success");
        appendLog(ugoiraEls.log, `zip 出力完了: ${outputName}`);
      });
    } catch (error) {
      if (/terminated|abort/i.test(String(error?.message || ""))) return;
      setStatus(ugoiraEls.status, `うごイラ書き出しに失敗しました。${String(error?.message || error)}`, "error");
    }
  });

  setupDropzone(ugoiraEls.drop, ugoiraEls.input, (files) => {
    if (files[0]) {
      setUgoiraFile(files[0]).catch((error) => {
        setStatus(ugoiraEls.status, error.message || String(error), "error");
      });
    }
  });
}

function initPixivTool() {
  const canvas = document.getElementById("pixivCanvas");
  if (!canvas) return;

  pixivEls = {
    input: document.getElementById("pixivInput"),
    drop: document.getElementById("pixivDrop"),
    canvas,
    status: document.getElementById("pixivStatus"),
    caption: document.getElementById("pixivCaption"),
    download: document.getElementById("pixivDownload"),
    reset: document.getElementById("pixivReset"),
  };
  pixivCtx = pixivEls.canvas.getContext("2d");

  pixivEls.canvas.addEventListener("pointerdown", (event) => {
    if (!pixivState.crop) return;
    const point = getPixivPoint(event);
    const hit = hitPixivCrop(point);
    if (!hit) return;
    pixivState.drag = {
      type: hit.type,
      handle: hit.handle || "",
      startPoint: point,
      origin: { ...pixivState.crop },
    };
    pixivEls.canvas.setPointerCapture(event.pointerId);
  });

  pixivEls.canvas.addEventListener("pointermove", (event) => {
    if (!pixivState.drag || !pixivState.crop) return;
    const point = getPixivPoint(event);
    const { origin } = pixivState.drag;
    if (pixivState.drag.type === "move") {
      const dx = point.x - pixivState.drag.startPoint.x;
      const dy = point.y - pixivState.drag.startPoint.y;
      pixivState.crop = {
        ...pixivState.crop,
        x: clamp(origin.x + dx, 0, pixivState.displayWidth - origin.size),
        y: clamp(origin.y + dy, 0, pixivState.displayHeight - origin.size),
      };
    } else {
      pixivState.crop = resizeSquare(pixivState.drag.handle, point, origin);
    }
    drawPixivCanvas();
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    pixivEls.canvas.addEventListener(eventName, () => {
      pixivState.drag = null;
    });
  });

  pixivEls.reset.addEventListener("click", () => {
    initializePixivCrop();
  });

  pixivEls.download.addEventListener("click", async () => {
    if (!pixivState.image || !pixivState.crop || !pixivState.file) {
      setStatus(pixivEls.status, "先に画像を追加してください。", "error");
      return;
    }

    const scale = pixivState.image.naturalWidth / pixivState.displayWidth;
    const sourceX = Math.round(pixivState.crop.x * scale);
    const sourceY = Math.round(pixivState.crop.y * scale);
    const sourceSize = Math.round(pixivState.crop.size * scale);
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = 900;
    outputCanvas.height = 900;
    const outputCtx = outputCanvas.getContext("2d");
    outputCtx.drawImage(
      pixivState.image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      900,
      900
    );
    const fileType = ["image/jpeg", "image/png", "image/webp"].includes(pixivState.file.type)
      ? pixivState.file.type
      : "image/png";
    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, fileType, 0.95));
    const ext = fileType === "image/png" ? "png" : fileType === "image/webp" ? "webp" : "jpg";
    const outputName = `${sanitizeBaseName(pixivState.file.name)}-pixiv-900.${ext}`;
    downloadBlob(blob, outputName);
    setStatus(pixivEls.status, `${outputName} をダウンロードしました。`, "success");
  });

  setupDropzone(pixivEls.drop, pixivEls.input, (files) => {
    if (files[0]) {
      setPixivFile(files[0]).catch((error) => {
        setStatus(pixivEls.status, error.message || String(error), "error");
      });
    }
  });

  drawPixivCanvas();
}

function initCharacterTool() {
  const hairStyle = document.getElementById("characterHairStyle");
  if (!hairStyle) return;

  characterEls = {
    hairStyle,
    hairExtra: document.getElementById("characterHairExtra"),
    hairColor: document.getElementById("characterHairColor"),
    eyeColor: document.getElementById("characterEyeColor"),
    headAccent: document.getElementById("characterHeadAccent"),
    bust: document.getElementById("characterBust"),
    skinColor: document.getElementById("characterSkinColor"),
    lora: document.getElementById("characterLora"),
    videoMode: document.getElementById("characterVideoMode"),
    reset: document.getElementById("characterReset"),
    copyPrompt: document.getElementById("characterCopyPrompt"),
    pngInfo: document.getElementById("characterPngInfo"),
    status: document.getElementById("characterStatus"),
  };

  [
    characterEls.hairStyle,
    characterEls.hairExtra,
    characterEls.hairColor,
    characterEls.eyeColor,
    characterEls.headAccent,
    characterEls.bust,
    characterEls.skinColor,
    characterEls.lora,
    characterEls.videoMode,
  ].forEach((element) => {
    element.addEventListener("input", updateCharacterTool);
    element.addEventListener("change", updateCharacterTool);
  });

  characterEls.reset.addEventListener("click", () => {
    resetCharacterTool();
    setStatus(characterEls.status, "初期値に戻しました。", "success");
  });

  characterEls.copyPrompt.addEventListener("click", async () => {
    try {
      await copyText(characterEls.pngInfo.value);
      setStatus(characterEls.status, "pnginfo をコピーしました。", "success");
    } catch (error) {
      setStatus(characterEls.status, `コピーに失敗しました。${error.message || error}`, "error");
    }
  });

  resetCharacterTool();
}

function initProtocolWarning() {
  const protocolWarning = document.getElementById("protocolWarning");
  if (protocolWarning && location.protocol === "file:") {
    protocolWarning.hidden = false;
  }
}

initProtocolWarning();
initConcatTool();
initUgoiraTool();
initPixivTool();
initCharacterTool();
