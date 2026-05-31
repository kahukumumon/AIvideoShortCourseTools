const state = {
  files: [],
  previewUrl: "",
  busy: false,
  cancel: null,
  ffmpeg: null,
  libraries: null,
  ffmpegModuleUrl: "",
  mklWorker: null,
  mklWorkerUrl: "",
  mklRequestId: 0,
  mklRequests: new Map(),
  logCapture: null,
  activeJob: null,
};

const els = {
  drop: document.getElementById("colorMatchDrop"),
  input: document.getElementById("colorMatchInput"),
  run: document.getElementById("colorMatchRun"),
  cancel: document.getElementById("colorMatchCancel"),
  clear: document.getElementById("colorMatchClear"),
  progress: document.getElementById("colorMatchProgress"),
  status: document.getElementById("colorMatchStatus"),
  log: document.getElementById("colorMatchLog"),
  fileList: document.getElementById("colorMatchFileList"),
  previewWrap: document.getElementById("colorMatchPreviewWrap"),
  preview: document.getElementById("colorMatchPreview"),
  protocolWarning: document.getElementById("protocolWarning"),
};

if (window.location.protocol === "file:") {
  els.protocolWarning.hidden = false;
}

function appendLog(message) {
  const stamp = new Date().toLocaleTimeString();
  els.log.textContent = `${els.log.textContent}\n[${stamp}] ${message}`.trim();
  els.log.scrollTop = els.log.scrollHeight;
}

function setStatus(message, type = "default") {
  els.status.className = `status-card${type === "success" ? " success" : type === "error" ? " error" : ""}`;
  els.status.querySelector(".status-text").textContent = message;
}

function setProgress(ratio) {
  els.progress.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function setJobProgress(jobIndex, jobTotal, ratio) {
  setProgress((jobIndex + Math.max(0, Math.min(1, ratio))) / Math.max(1, jobTotal));
}

function sanitizeBaseName(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base.replace(/[^a-zA-Z0-9_.-]/g, "_") || "video";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function downloadBlob(blob, fileName) {
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

function throwIfAborted(signal) {
  if (signal.aborted) throw new DOMException("処理をキャンセルしました。", "AbortError");
}

async function ensureLibraries() {
  if (state.libraries) return state.libraries;
  appendLog("CDN ライブラリを読み込んでいます。");
  const ffmpegModuleUrl = await ensureFFmpegModuleUrl();
  const [ffmpegModule, utilModule, matrixModule] = await Promise.all([
    import(ffmpegModuleUrl),
    import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js"),
    import("https://esm.sh/ml-matrix@6.12.1"),
  ]);
  state.libraries = {
    FFmpeg: ffmpegModule.FFmpeg,
    fetchFile: utilModule.fetchFile,
    toBlobURL: utilModule.toBlobURL,
    EigenvalueDecomposition: matrixModule.EigenvalueDecomposition,
    Matrix: matrixModule.Matrix,
  };
  return state.libraries;
}

async function ensureFFmpegModuleUrl() {
  if (state.ffmpegModuleUrl) return state.ffmpegModuleUrl;
  const wrapperBaseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm";
  const files = ["index.js", "classes.js", "const.js", "errors.js", "types.js", "utils.js", "worker.js"];
  const sources = {};

  await Promise.all(files.map(async (file) => {
    const response = await fetch(`${wrapperBaseURL}/${file}`);
    if (!response.ok) throw new Error(`ffmpeg ラッパーファイルの読み込みに失敗しました: ${file}`);
    sources[file] = await response.text();
  }));

  const blobModule = (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const constURL = blobModule(sources["const.js"]);
  const errorsURL = blobModule(sources["errors.js"]);
  const utilsURL = blobModule(sources["utils.js"]);
  const typesURL = blobModule(sources["types.js"]);
  const workerURL = blobModule(
    sources["worker.js"]
      .replace("./const.js", constURL)
      .replace("./errors.js", errorsURL)
  );
  const classesURL = blobModule(
    sources["classes.js"]
      .replace("./const.js", constURL)
      .replace("./utils.js", utilsURL)
      .replace("./errors.js", errorsURL)
      .replace("./worker.js", workerURL)
  );
  state.ffmpegModuleUrl = blobModule(
    sources["index.js"]
      .replace("./classes.js", classesURL)
      .replace("./types.js", typesURL)
  );
  return state.ffmpegModuleUrl;
}

function waitForVideoReady(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("動画メタデータの読み込みに失敗しました。"));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function waitForSeek(video) {
  return new Promise((resolve, reject) => {
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
      reject(new Error("動画フレームのシークに失敗しました。"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function seekVideo(video, time, signal) {
  throwIfAborted(signal);
  if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  video.currentTime = time;
  await waitForSeek(video);
  throwIfAborted(signal);
}

function toEvenSourceSize(width, height) {
  const fittedWidth = Math.max(2, Math.round(width));
  const fittedHeight = Math.max(2, Math.round(height));
  return {
    width: fittedWidth % 2 === 0 ? fittedWidth : fittedWidth - 1,
    height: fittedHeight % 2 === 0 ? fittedHeight : fittedHeight - 1,
  };
}

function chooseStatsSampleStep(width, height) {
  return Math.max(2, Math.min(16, Math.round(Math.sqrt((width * height) / 20_000))));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function computeStats(imageData, sampleStep) {
  const { data, width, height } = imageData;
  const mean = [0, 0, 0];
  let count = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const offset = (y * width + x) * 4;
      mean[0] += data[offset];
      mean[1] += data[offset + 1];
      mean[2] += data[offset + 2];
      count += 1;
    }
  }

  mean[0] /= count;
  mean[1] /= count;
  mean[2] /= count;

  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const offset = (y * width + x) * 4;
      const d0 = data[offset] - mean[0];
      const d1 = data[offset + 1] - mean[1];
      const d2 = data[offset + 2] - mean[2];
      cov[0][0] += d0 * d0;
      cov[0][1] += d0 * d1;
      cov[0][2] += d0 * d2;
      cov[1][1] += d1 * d1;
      cov[1][2] += d1 * d2;
      cov[2][2] += d2 * d2;
    }
  }

  const denom = Math.max(1, count - 1);
  cov[0][0] = cov[0][0] / denom + 1;
  cov[0][1] /= denom;
  cov[0][2] /= denom;
  cov[1][0] = cov[0][1];
  cov[1][1] = cov[1][1] / denom + 1;
  cov[1][2] /= denom;
  cov[2][0] = cov[0][2];
  cov[2][1] = cov[1][2];
  cov[2][2] = cov[2][2] / denom + 1;

  return { mean, cov };
}

function sqrtSymmetric(matrix, inverse = false) {
  const { EigenvalueDecomposition, Matrix } = state.libraries;
  const symmetric = [
    [matrix[0][0], (matrix[0][1] + matrix[1][0]) / 2, (matrix[0][2] + matrix[2][0]) / 2],
    [(matrix[1][0] + matrix[0][1]) / 2, matrix[1][1], (matrix[1][2] + matrix[2][1]) / 2],
    [(matrix[2][0] + matrix[0][2]) / 2, (matrix[2][1] + matrix[1][2]) / 2, matrix[2][2]],
  ];
  const decomposition = new EigenvalueDecomposition(new Matrix(symmetric), { assumeSymmetric: true });
  const values = decomposition.realEigenvalues.map((value) => {
    const safe = Math.max(value, 1e-6);
    return inverse ? 1 / Math.sqrt(safe) : Math.sqrt(safe);
  });
  const vectors = decomposition.eigenvectorMatrix;
  return vectors.mmul(Matrix.diag(values)).mmul(vectors.transpose());
}

function buildMklTransform(sourceStats, targetStats) {
  const { Matrix } = state.libraries;
  const targetCov = new Matrix(targetStats.cov);
  const sourceSqrt = sqrtSymmetric(sourceStats.cov);
  const sourceInvSqrt = sqrtSymmetric(sourceStats.cov, true);
  const middle = sourceSqrt.mmul(targetCov).mmul(sourceSqrt);
  const middleSqrt = sqrtSymmetric(middle.to2DArray());
  const transform = sourceInvSqrt.mmul(middleSqrt).mmul(sourceInvSqrt);
  return transform.to2DArray();
}

function applyMkl(imageData, sourceStats, targetStats) {
  const transform = buildMklTransform(sourceStats, targetStats);
  const { data } = imageData;
  const sm = sourceStats.mean;
  const tm = targetStats.mean;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] - sm[0];
    const g = data[i + 1] - sm[1];
    const b = data[i + 2] - sm[2];
    data[i] = clampByte(transform[0][0] * r + transform[0][1] * g + transform[0][2] * b + tm[0]);
    data[i + 1] = clampByte(transform[1][0] * r + transform[1][1] * g + transform[1][2] * b + tm[1]);
    data[i + 2] = clampByte(transform[2][0] * r + transform[2][1] * g + transform[2][2] * b + tm[2]);
  }
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("フレーム画像の生成に失敗しました。"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function captureFfmpegLogs(operation) {
  const previous = state.logCapture;
  const logs = [];
  state.logCapture = logs;
  return Promise.resolve()
    .then(operation)
    .catch(() => undefined)
    .then(() => logs.join("\n"))
    .finally(() => {
      state.logCapture = previous;
    });
}

function parseFpsFromText(text) {
  const patterns = [
    /,\s*([0-9]+(?:\.[0-9]+)?)\s*fps\b/i,
    /,\s*([0-9]+(?:\.[0-9]+)?)\s*tbr\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const fps = Number(match[1]);
    if (Number.isFinite(fps) && fps > 0) return fps;
  }
  return null;
}

function parseBitrateKbps(text) {
  const videoLine = text.split(/\r?\n/).find((line) => /Stream #.+Video:/i.test(line)) || "";
  const videoMatch = videoLine.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*kb\/s(?:,|\s)/i);
  if (videoMatch) {
    const kbps = Number(videoMatch[1]);
    if (Number.isFinite(kbps) && kbps > 0) return kbps;
  }

  const containerMatch = text.match(/Duration:.+?bitrate:\s*([0-9]+(?:\.[0-9]+)?)\s*kb\/s/i);
  if (containerMatch) {
    const kbps = Number(containerMatch[1]);
    if (Number.isFinite(kbps) && kbps > 0) return kbps;
  }

  return null;
}

function parseSourceMetadata(text) {
  return {
    fps: parseFpsFromText(text),
    videoBitrateKbps: parseBitrateKbps(text),
  };
}

async function detectSourceMetadata(ffmpeg, inputName) {
  const logs = await captureFfmpegLogs(async () => {
    await ffmpeg.exec(["-hide_banner", "-i", inputName]);
  });
  return parseSourceMetadata(logs);
}

function formatFps(fps) {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatBitrateKbps(kbps) {
  return `${Math.max(1, Math.round(kbps))}k`;
}

async function getFfmpeg() {
  if (state.ffmpeg) return state.ffmpeg;
  const { FFmpeg, toBlobURL } = await ensureLibraries();
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    if (state.logCapture && message) state.logCapture.push(message);
    if (message) appendLog(message);
  });
  ffmpeg.on("progress", ({ progress }) => {
    const job = state.activeJob;
    if (job) {
      setJobProgress(job.index, job.total, 0.8 + Math.max(0, Math.min(1, progress)) * 0.18);
    } else {
      setProgress(0.8 + Math.max(0, Math.min(1, progress)) * 0.18);
    }
  });
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  appendLog("ffmpeg.wasm を読み込んでいます。");
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  state.ffmpeg = ffmpeg;
  return ffmpeg;
}

async function getMklWorker() {
  if (state.mklWorker) return state.mklWorker;
  const response = await fetch("./mkl-worker.js");
  if (!response.ok) throw new Error("MKL Worker の読み込みに失敗しました。");
  const source = await response.text();
  state.mklWorkerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(state.mklWorkerUrl, { type: "module" });
  worker.addEventListener("message", (event) => {
    const { id, ok, result, error } = event.data || {};
    const request = state.mklRequests.get(id);
    if (!request) return;
    state.mklRequests.delete(id);
    if (ok) {
      request.resolve(result);
    } else {
      request.reject(new Error(error || "MKL Worker の処理に失敗しました。"));
    }
  });
  worker.addEventListener("error", (event) => {
    for (const request of state.mklRequests.values()) {
      request.reject(new Error(event.message || "MKL Worker でエラーが発生しました。"));
    }
    state.mklRequests.clear();
  });
  state.mklWorker = worker;
  return worker;
}

async function runMklWorker(payload, transfer = []) {
  const worker = await getMklWorker();
  const id = ++state.mklRequestId;
  return new Promise((resolve, reject) => {
    state.mklRequests.set(id, { resolve, reject });
    worker.postMessage({ id, ...payload }, transfer);
  });
}

function abortPendingMklRequests() {
  for (const request of state.mklRequests.values()) {
    request.reject(new DOMException("処理をキャンセルしました。", "AbortError"));
  }
  state.mklRequests.clear();
}

async function cleanupFfmpeg(ffmpeg, frameCount, inputName) {
  for (let i = 0; i < frameCount; i += 1) {
    try {
      await ffmpeg.deleteFile(`frames/frame_${String(i + 1).padStart(6, "0")}.png`);
    } catch (_) {
    }
  }
  for (const path of ["output.mp4", "processed.mp4", inputName]) {
    try {
      await ffmpeg.deleteFile(path);
    } catch (_) {
    }
  }
  try {
    await ffmpeg.deleteDir("frames");
  } catch (_) {
  }
}

async function processSingleVideo(file, jobIndex, jobTotal, signal) {
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl;

  const canvas = document.createElement("canvas");

  let frameCount = 0;
  let ffmpeg = null;
  let inputName = "";

  try {
    state.activeJob = { index: jobIndex, total: jobTotal };
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D コンテキストを作成できません。");

    await waitForVideoReady(video);
    throwIfAborted(signal);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration <= 0) throw new Error("動画の長さを取得できません。");

    const originalWidth = video.videoWidth || 1280;
    const originalHeight = video.videoHeight || 720;
    const size = toEvenSourceSize(originalWidth, originalHeight);
    canvas.width = size.width;
    canvas.height = size.height;

    ffmpeg = await getFfmpeg();
    try {
      await ffmpeg.deleteDir("frames");
    } catch (_) {
    }
    await ffmpeg.createDir("frames");
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".mp4";
    inputName = `input_${jobIndex + 1}${ext.replace(/[^a-zA-Z0-9.]/g, "") || ".mp4"}`;
    const { fetchFile } = await ensureLibraries();
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    appendLog("元動画の fps とビットレートを取得しています。");
    const sourceMetadata = await detectSourceMetadata(ffmpeg, inputName);
    const fps = sourceMetadata.fps || 30;
    if (!sourceMetadata.fps) appendLog("fps を取得できなかったため 30fps で処理します。");
    const fpsText = formatFps(fps);
    const bitrateText = sourceMetadata.videoBitrateKbps ? formatBitrateKbps(sourceMetadata.videoBitrateKbps) : "";
    if (!bitrateText) appendLog("映像ビットレートを取得できなかったため、エンコーダー既定品質で処理します。");
    const sampleStep = chooseStatsSampleStep(canvas.width, canvas.height);
    frameCount = Math.max(1, Math.ceil(duration * fps));
    appendLog(`入力: ${file.name} / ${originalWidth}x${originalHeight} / ${duration.toFixed(3)} 秒`);
    if (size.width !== originalWidth || size.height !== originalHeight) {
      appendLog(`mp4互換のため偶数サイズへ調整: ${size.width}x${size.height}`);
    }
    appendLog(`出力: ${size.width}x${size.height} / ${fpsText}fps${bitrateText ? ` / ${bitrateText}` : ""} / ${frameCount} フレーム`);

    await seekVideo(video, 0, signal);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const referenceImage = context.getImageData(0, 0, canvas.width, canvas.height);
    const { stats: reference } = await runMklWorker(
      { type: "reference", imageData: referenceImage, sampleStep },
      [referenceImage.data.buffer]
    );
    throwIfAborted(signal);
    appendLog(`基準色: mean RGB ${reference.mean.map((value) => value.toFixed(1)).join(", ")}`);

    for (let i = 0; i < frameCount; i += 1) {
      throwIfAborted(signal);
      const time = Math.min(duration - 0.001, i / fps);
      await seekVideo(video, Math.max(0, time), signal);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const { imageData: processed } = await runMklWorker(
        { type: "apply", imageData, sampleStep, reference },
        [imageData.data.buffer]
      );
      throwIfAborted(signal);
      context.putImageData(processed, 0, 0);
      const bytes = await canvasToPngBytes(canvas);
      await ffmpeg.writeFile(`frames/frame_${String(i + 1).padStart(6, "0")}.png`, bytes);

      if (i === 0 || (i + 1) % Math.max(1, Math.round(fps)) === 0 || i + 1 === frameCount) {
        appendLog(`フレーム処理: ${i + 1}/${frameCount}`);
      }
      setJobProgress(jobIndex, jobTotal, ((i + 1) / frameCount) * 0.78);
    }

    appendLog("元動画の音声を結合して mp4 を生成します。");
    const outputBlob = await encodeWrittenFrames(ffmpeg, fpsText, bitrateText, inputName, signal);
    const outputName = `${sanitizeBaseName(file.name)}-mkl-first-frame.mp4`;
    appendLog(`mp4 出力サイズ: ${formatBytes(outputBlob.size)}`);
    downloadBlob(outputBlob, outputName);
    setJobProgress(jobIndex, jobTotal, 1);
    appendLog(`完了: ${outputName}`);
    return outputName;
  } finally {
    if (ffmpeg && frameCount > 0) {
      await cleanupFfmpeg(ffmpeg, frameCount, inputName);
    }
    state.activeJob = null;
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function processVideos() {
  if (!state.files.length || state.busy) return;

  const controller = new AbortController();
  state.cancel = controller;
  state.busy = true;
  els.run.disabled = true;
  els.cancel.disabled = false;
  setProgress(0);
  setStatus(`${state.files.length} 本の動画を順番に処理します。`);
  appendLog("MKL 色合わせバッチを開始します。MKL 計算は Web Worker、mp4 生成は ffmpeg.wasm Worker で処理します。");

  const signal = controller.signal;
  const files = [...state.files];
  const completed = [];

  try {
    for (let i = 0; i < files.length; i += 1) {
      throwIfAborted(signal);
      setStatus(`${i + 1}/${files.length}: ${files[i].name} を処理しています。`);
      appendLog(`--- ${i + 1}/${files.length}: ${files[i].name} ---`);
      const outputName = await processSingleVideo(files[i], i, files.length, signal);
      completed.push(outputName);
    }
    setProgress(1);
    setStatus(`${completed.length} 本の mp4 をダウンロードしました。`, "success");
    appendLog(`バッチ完了: ${completed.length}/${files.length} 本`);
  } catch (error) {
    if (error?.name === "AbortError") {
      abortPendingMklRequests();
      setStatus("処理をキャンセルしました。", "default");
      appendLog("キャンセルしました。");
    } else {
      setStatus(`処理に失敗しました。${error?.message || error}`, "error");
      appendLog(`エラー: ${error?.message || error}`);
    }
  } finally {
    state.busy = false;
    state.cancel = null;
    state.activeJob = null;
    els.run.disabled = !state.files.length;
    els.cancel.disabled = true;
  }
}

async function encodeWrittenFrames(ffmpeg, fpsText, bitrateText, inputName, signal) {
  const sharedArgs = [
    "-framerate", fpsText,
    "-i", "frames/frame_%06d.png",
    "-i", inputName,
    "-map", "0:v:0",
    "-map", "1:a?",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
  ];
  const bitrateArgs = bitrateText ? ["-b:v", bitrateText] : [];
  const profiles = [
    { name: "libx264", args: ["-c:v", "libx264", "-preset", "veryfast", ...bitrateArgs, "-pix_fmt", "yuv420p", "output.mp4"] },
    { name: "mpeg4", args: ["-c:v", "mpeg4", ...bitrateArgs, ...(!bitrateText ? ["-q:v", "3"] : []), "-pix_fmt", "yuv420p", "output.mp4"] },
  ];

  let lastError = "";
  for (const profile of profiles) {
    throwIfAborted(signal);
    try {
      try {
        await ffmpeg.deleteFile("output.mp4");
      } catch (_) {
      }
      appendLog(`mp4 エンコード試行: ${profile.name}`);
      const code = await ffmpeg.exec([...sharedArgs, ...profile.args]);
      if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
      lastError = "";
      break;
    } catch (error) {
      lastError = error?.message || String(error);
      appendLog(`エンコード失敗(${profile.name}): ${lastError}`);
    }
  }

  if (lastError) throw new Error(`mp4 エンコードに失敗しました。${lastError}`);
  const data = await ffmpeg.readFile("output.mp4");
  return new Blob([data], { type: "video/mp4" });
}

function renderFileList() {
  if (!state.files.length) {
    els.fileList.hidden = true;
    els.fileList.textContent = "";
    return;
  }
  els.fileList.hidden = false;
  els.fileList.textContent = "";
  state.files.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "file-item";
    const name = document.createElement("span");
    name.textContent = `${index + 1}. ${file.name}`;
    const size = document.createElement("strong");
    size.textContent = formatBytes(file.size);
    item.append(name, size);
    els.fileList.append(item);
  });
}

function updatePreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = "";
  const first = state.files[0];
  if (!first) {
    els.preview.removeAttribute("src");
    els.preview.load();
    els.previewWrap.hidden = true;
    return;
  }
  state.previewUrl = URL.createObjectURL(first);
  els.preview.src = state.previewUrl;
  els.previewWrap.hidden = false;
}

function addFiles(files) {
  const videoFiles = Array.from(files).filter((file) => file.type.startsWith("video/"));
  if (!videoFiles.length) {
    setStatus("動画ファイルを選択してください。", "error");
    return;
  }
  const existingKeys = new Set(state.files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  for (const file of videoFiles) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!existingKeys.has(key)) {
      state.files.push(file);
      existingKeys.add(key);
    }
  }
  updatePreview();
  renderFileList();
  els.run.disabled = false;
  setProgress(0);
  setStatus(`${state.files.length} 本の動画を追加しました。`);
  els.log.textContent = `動画色合わせログ\n入力: ${state.files.length} 本\n${state.files.map((file) => `- ${file.name} / ${formatBytes(file.size)}`).join("\n")}`;
}

function clearFile() {
  if (state.busy) return;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.files = [];
  state.previewUrl = "";
  els.input.value = "";
  els.preview.removeAttribute("src");
  els.preview.load();
  els.previewWrap.hidden = true;
  renderFileList();
  els.run.disabled = true;
  setProgress(0);
  setStatus("動画を追加するとここに状態を表示します。");
  els.log.textContent = "動画色合わせログ待機中";
}

els.input.addEventListener("change", () => {
  if (els.input.files?.length) addFiles(els.input.files);
});

els.drop.addEventListener("click", () => {
  if (!state.busy) els.input.click();
});

els.drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.drop.classList.add("dragging");
});

els.drop.addEventListener("dragleave", () => {
  els.drop.classList.remove("dragging");
});

els.drop.addEventListener("drop", (event) => {
  event.preventDefault();
  els.drop.classList.remove("dragging");
  addFiles(event.dataTransfer.files);
});

els.run.addEventListener("click", () => {
  processVideos();
});

els.cancel.addEventListener("click", () => {
  state.cancel?.abort();
  abortPendingMklRequests();
});

els.clear.addEventListener("click", clearFile);
