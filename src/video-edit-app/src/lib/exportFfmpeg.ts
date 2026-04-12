import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import type { AudioTrack, BaseClip, ClipSegment, ExportProgress, MediaSourceItem, MosaicTrack, VideoClip } from '../types';
import { calcMosaicPixelSize, clipDuration, dbToGain, getVisibleSegments, totalTimelineDuration } from './timeline';

let ffmpegPromise: Promise<FFmpeg> | null = null;

// コールバックをモジュール変数で保持し、再利用時に最新 UI に転送できるようにする
let currentOnProgress: ((progress: ExportProgress) => void) | null = null;
let currentOnLog: ((message: string) => void) | undefined;

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function isIgnorableFfmpegLog(message: string) {
  return message === 'Aborted()' || message.startsWith('Aborted(native code called abort())');
}

async function getFfmpeg(onProgress: (progress: ExportProgress) => void, onLog?: (message: string) => void) {
  // 毎回コールバックを最新に更新する
  currentOnProgress = onProgress;
  currentOnLog = onLog;

  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => {
        if (message && !isIgnorableFfmpegLog(message)) currentOnLog?.(message);
      });
      ffmpeg.on('progress', ({ progress }) => {
        currentOnProgress?.({ phase: 'encode', ratio: Math.max(0, Math.min(1, progress)), message: 'mp4 を生成しています。' });
      });
      await ffmpeg.load({
        coreURL,
        wasmURL,
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

function buildAtempoChain(speed: number) {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining *= 2;
  }
  filters.push(`atempo=${remaining.toFixed(5)}`);
  return filters;
}

function getSourcePath(sourceId: string, sourceMap: Map<string, MediaSourceItem>): string {
  const source = sourceMap.get(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  const ext = source.file.name.includes('.')
    ? source.file.name.slice(source.file.name.lastIndexOf('.'))
    : source.kind === 'video' ? '.mp4' : '.wav';
  return `inputs/${source.id}_${sanitizeFileName(source.name.replace(ext, ''))}${ext}`;
}

function clipToSegments(clip: BaseClip): ClipSegment[] {
  return getVisibleSegments(clip).map((seg) => ({
    ...seg,
    speed: seg.speed * clip.speed,
  }));
}

function unknownErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function collectExportSources(videoSources: MediaSourceItem[], audioSources: MediaSourceItem[]) {
  return [...videoSources, ...audioSources];
}

/**
 * モザイクトラックから ffmpeg の geq フィルタチェーンを生成する。
 * 各モザイククリップを対象時間帯に楕円ピクセルモザイクとして合成する。
 * @param mosaicTracks モザイクトラック一覧
 * @param videoWidth  出力動画の幅
 * @param videoHeight 出力動画の高さ
 * @param inputLabel  適用前の映像ラベル
 * @returns フィルタ文字列の配列と最終ラベル
 */
export function buildMosaicFilters(
  mosaicTracks: MosaicTrack[],
  videoWidth: number,
  videoHeight: number,
  inputLabel: string,
): { filters: string[]; outputLabel: string } {
  const allClips = mosaicTracks.flatMap((track) => track.clips);
  if (allClips.length === 0) {
    return { filters: [], outputLabel: inputLabel };
  }

  const longerSide = Math.max(videoWidth, videoHeight);
  const ps = Math.max(1, Math.floor(calcMosaicPixelSize(longerSide)));
  const filters: string[] = [];
  let currentLabel = inputLabel;

  allClips.forEach((clip, i) => {
    const { cx, cy, rx, ry, angle } = clip.mask;
    const startSec = clip.timelineStart.toFixed(6);
    const endSec = (clip.timelineStart + clip.duration).toFixed(6);
    const outLabel = `mosaicout${i}`;

    // geq フィルタで楕円マスク内をピクセルモザイク化
    // 楕円判定: ((X/W - cx)/rx)^2 + ((Y/H - cy)/ry)^2 <= 1
    // 楕円内はブロック中心の画素値を使用
    const cosA = Math.cos(angle || 0).toFixed(6);
    const sinA = Math.sin(angle || 0).toFixed(6);
    const dxExpr = `(X/W-${cx.toFixed(6)})`;
    const dyExpr = `(Y/H-${cy.toFixed(6)})`;
    const localXExpr = `((${dxExpr})*${cosA}+(${dyExpr})*${sinA})`;
    const localYExpr = `(-(${dxExpr})*${sinA}+(${dyExpr})*${cosA})`;
    const ellipseExpr = `pow(${localXExpr}/${rx > 0 ? rx.toFixed(6) : '0.001'},2)+pow(${localYExpr}/${ry > 0 ? ry.toFixed(6) : '0.001'},2)`;
    const blockX = `(floor(X/${ps})*${ps}+${ps}/2)`;
    const blockY = `(floor(Y/${ps})*${ps}+${ps}/2)`;

    const lumExpr = `if(lte(${ellipseExpr},1),lum(${blockX},${blockY}),lum(X,Y))`;
    const cbExpr  = `if(lte(${ellipseExpr},1),cb(${blockX},${blockY}),cb(X,Y))`;
    const crExpr  = `if(lte(${ellipseExpr},1),cr(${blockX},${blockY}),cr(X,Y))`;

    filters.push(
      `[${currentLabel}]geq=lum='${lumExpr}':cb='${cbExpr}':cr='${crExpr}':enable='between(t,${startSec},${endSec})'[${outLabel}]`,
    );
    currentLabel = outLabel;
  });

  return { filters, outputLabel: currentLabel };
}

export async function exportTimelineToMp4(options: {
  videoClips: VideoClip[];
  audioTracks: AudioTrack[];
  mosaicTracks?: MosaicTrack[];
  videoSources: MediaSourceItem[];
  audioSources: MediaSourceItem[];
  onProgress: (progress: ExportProgress) => void;
  onLog?: (message: string) => void;
}) {
  const { videoClips, audioTracks, mosaicTracks = [], videoSources, audioSources, onProgress, onLog } = options;
  const ffmpeg = await getFfmpeg(onProgress, onLog);
  const allAudioClips = audioTracks.flatMap((track) => track.clips);
  const duration = totalTimelineDuration(videoClips, allAudioClips);
  const exportSources = collectExportSources(videoSources, audioSources);
  const sourceMap = new Map<string, MediaSourceItem>(exportSources.map((source) => [source.id, source] as [string, MediaSourceItem]));

  onProgress({ phase: 'prepare', ratio: 0.05, message: '入力素材を準備しています。' });
  try { await ffmpeg.deleteDir('inputs'); } catch {}
  try { await ffmpeg.deleteFile('output.mp4'); } catch {}
  await ffmpeg.createDir('inputs');

  for (const source of exportSources) {
    const ext = source.file.name.includes('.') ? source.file.name.slice(source.file.name.lastIndexOf('.')) : source.kind === 'video' ? '.mp4' : '.wav';
    const fsName = `inputs/${source.id}_${sanitizeFileName(source.name.replace(ext, ''))}${ext}`;
    await ffmpeg.writeFile(fsName, await fetchFile(source.file));
    onLog?.(`素材読込: ${source.name}`);
  }

  // 各クリップをセグメントリストに展開して入力パスを構築する
  const videoSegRefs = videoClips.map((clip) =>
    clipToSegments(clip).map((seg) => ({ path: getSourcePath(seg.sourceId, sourceMap), seg }))
  );
  const audioSegRefs = allAudioClips.map((clip) =>
    clipToSegments(clip).map((seg) => ({ path: getSourcePath(seg.sourceId, sourceMap), seg }))
  );

  const inputPaths: string[] = [
    ...videoSegRefs.flatMap((refs) => refs.map((r) => r.path)),
    ...audioSegRefs.flatMap((refs) => refs.map((r) => r.path)),
  ];

  const command = inputPaths.flatMap((path) => ['-i', path]);
  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  let inputIndex = 0;

  // 動画クリップのフィルタ構築（セグメント対応）
  videoClips.forEach((clip, ci) => {
    const refs = videoSegRefs[ci];
    const outputDuration = clipDuration(clip);
    const segLabels: string[] = [];

    refs.forEach((ref, si) => {
      const { seg } = ref;
      const segLabel = `vseg${ci}_${si}`;
      const parts = [
        `[${inputIndex}:v]trim=start=${seg.sourceStart}:end=${seg.sourceStart + seg.sourceDuration}`,
        'setpts=PTS-STARTPTS',
        `setpts=${(1 / seg.speed).toFixed(6)}*PTS`,
        'format=yuv420p',
      ];
      filters.push(`${parts.join(',')}[${segLabel}]`);
      segLabels.push(`[${segLabel}]`);
      inputIndex += 1;
    });

    // 複数セグメントを連結
    let prevLabel: string;
    if (segLabels.length > 1) {
      prevLabel = `vmerge${ci}`;
      filters.push(`${segLabels.join('')}concat=n=${segLabels.length}:v=1:a=0[${prevLabel}]`);
    } else {
      prevLabel = `vseg${ci}_0`;
    }

    // フェード適用
    const fadeParts: string[] = [];
    if (clip.fadeIn > 0) fadeParts.push(`fade=t=in:st=0:d=${clip.fadeIn}`);
    if (clip.fadeOut > 0) fadeParts.push(`fade=t=out:st=${Math.max(0, outputDuration - clip.fadeOut)}:d=${clip.fadeOut}`);

    let clipLabel: string;
    if (fadeParts.length > 0) {
      clipLabel = `v${ci}`;
      filters.push(`[${prevLabel}]${fadeParts.join(',')}[${clipLabel}]`);
    } else {
      clipLabel = prevLabel;
    }
    videoLabels.push(`[${clipLabel}]`);
  });

  // 音声クリップのフィルタ構築（セグメント対応）
  allAudioClips.forEach((clip, ci) => {
    const refs = audioSegRefs[ci];
    const outputDuration = clipDuration(clip);
    const delayMs = Math.max(0, Math.round(clip.timelineStart * 1000));
    const volume = dbToGain(clip.volumeDb).toFixed(5);
    const segLabels: string[] = [];

    refs.forEach((ref, si) => {
      const { seg } = ref;
      const segLabel = `aseg${ci}_${si}`;
      const parts = [
        `[${inputIndex}:a]atrim=start=${seg.sourceStart}:end=${seg.sourceStart + seg.sourceDuration}`,
        'asetpts=PTS-STARTPTS',
        'aformat=sample_rates=48000:channel_layouts=stereo',
        ...buildAtempoChain(seg.speed),
      ];
      filters.push(`${parts.join(',')}[${segLabel}]`);
      segLabels.push(`[${segLabel}]`);
      inputIndex += 1;
    });

    // 複数セグメントを連結
    let prevLabel: string;
    if (segLabels.length > 1) {
      prevLabel = `amerge${ci}`;
      filters.push(`${segLabels.join('')}concat=n=${segLabels.length}:v=0:a=1[${prevLabel}]`);
    } else {
      prevLabel = `aseg${ci}_0`;
    }

    // volume・fade・delay 適用
    const postParts: string[] = [`volume=${volume}`];
    if (clip.fadeIn > 0) postParts.push(`afade=t=in:st=0:d=${clip.fadeIn}`);
    if (clip.fadeOut > 0) postParts.push(`afade=t=out:st=${Math.max(0, outputDuration - clip.fadeOut)}:d=${clip.fadeOut}`);
    postParts.push(`adelay=${delayMs}|${delayMs}`);

    const clipLabel = `a${ci}`;
    filters.push(`[${prevLabel}]${postParts.join(',')}[${clipLabel}]`);
    audioLabels.push(`[${clipLabel}]`);
  });

  if (videoLabels.length === 0) {
    throw new Error('動画クリップがありません。');
  }

  filters.push(`${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[vconcat]`);

  // モザイクフィルタを合成する（video の幅・高さは最初のクリップのソースから取得）
  const firstVideoSource = videoClips.length > 0 ? sourceMap.get(videoClips[0].sourceId) : undefined;
  const videoWidth = firstVideoSource?.width ?? 1280;
  const videoHeight = firstVideoSource?.height ?? 720;
  const { filters: mosaicFilters, outputLabel: vFinalLabel } = buildMosaicFilters(
    mosaicTracks,
    videoWidth,
    videoHeight,
    'vconcat',
  );
  for (const f of mosaicFilters) filters.push(f);
  filters.push(`[${vFinalLabel}]null[vout]`);

  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,atrim=duration=${duration}[aout]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[aout]`);
  }

  onProgress({ phase: 'encode', ratio: 0.1, message: 'ffmpeg フィルタグラフを組み立てています。' });

  const sharedArgs = [
    ...command,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
  ];

  const encodeProfiles: Array<{ name: string; args: string[] }> = [
    {
      name: 'libx264+aac',
      args: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', 'output.mp4'],
    },
    {
      name: 'mpeg4+aac',
      args: ['-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', 'output.mp4'],
    },
  ];

  let lastError = '';
  for (const profile of encodeProfiles) {
    onLog?.(`エンコードプロファイル試行: ${profile.name}`);
    try {
      try { await ffmpeg.deleteFile('output.mp4'); } catch {}
      const exitCode = await ffmpeg.exec([...sharedArgs, ...profile.args]);
      if (exitCode !== 0) {
        throw new Error(`ffmpeg が終了コード ${exitCode} を返しました。`);
      }
      lastError = '';
      onLog?.(`エンコード成功: ${profile.name}`);
      break;
    } catch (error) {
      lastError = unknownErrorMessage(error);
      onLog?.(`エンコード失敗(${profile.name}): ${lastError}`);
    }
  }

  if (lastError) {
    throw new Error(`エンコード処理に失敗しました。${lastError}`);
  }

  onProgress({ phase: 'finalize', ratio: 0.97, message: 'ファイルを組み立てています。' });
  const data = await ffmpeg.readFile('output.mp4');
  return new Blob([data], { type: 'video/mp4' });
}
