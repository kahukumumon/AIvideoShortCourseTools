import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type {
  AudioClip,
  AudioTrack,
  ContextMenuState,
  EllipseMask,
  ExportProgress,
  MediaSourceItem,
  MosaicClip,
  MosaicTrack,
  VideoClip,
} from './types';
import { loadAudioSource, loadVideoSource } from './lib/media';
import { exportTimelineToMp4 } from './lib/exportFfmpeg';
import { computeRmsGraph } from './lib/rms';
import { RmsGraph } from './components/RmsGraph';
import {
  addMosaicClipToTrack,
  addMosaicTrack,
  applyTrackVolume,
  calcMosaicPixelSize,
  canJoinPair,
  changeClipSpeed,
  clampFade,
  clampVolumeDb,
  clipDuration,
  clipEnd,
  dbToGain,
  deleteMosaicClip,
  deriveClipRmsGraph,
  deleteClip,
  formatTime,
  getActiveMosaicClips,
  joinClipWithNext,
  joinMosaicClipWithNext,
  moveClip,
  moveMosaicClip,
  normalizeClips,
  resolveSegmentAtPlaytime,
  splitClip,
  splitMosaicClip,
  totalTimelineDuration,
  trimClip,
  trimMosaicClip,
  updateMosaicEllipse,
} from './lib/timeline';

const MAX_PIXELS_PER_SECOND = 88;
const MIN_PIXELS_PER_SECOND = 24;

type DragMode = 'move' | 'trim-start' | 'trim-end' | 'speed-start' | 'speed-end';
type FlattenedAudioClip = AudioClip & { trackId: string };
type DropTarget = 'video' | `audio:${string}` | null;
type DragSessionState = {
  kind: 'video' | 'audio';
  trackId?: string;
  clipId: string;
  mode: DragMode;
};
type DragPreviewState = {
  kind: 'video' | 'audio';
  trackId?: string;
  clipId: string;
  timelineStart: number;
  duration: number;
};

function isVideoFile(file: File) {
  return file.type.startsWith('video/');
}

function isAudioFile(file: File) {
  return file.type.startsWith('audio/');
}

function hasDraggedFiles(dataTransfer: DataTransfer | null) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes('Files'));
}

function isTimelineInteractiveElement(target: HTMLElement) {
  return Boolean(
    target.closest(
      'button, input, select, textarea, label, a, [role="button"], [data-no-timeline-seek], .audio-track-bar, .context-menu',
    ),
  );
}

function createAudioTrack(index: number): AudioTrack {
  return { id: crypto.randomUUID(), name: `Audio ${index}`, clips: [] };
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function fadeGain(clip: VideoClip | AudioClip, currentTime: number) {
  const duration = clipDuration(clip);
  const localTime = Math.max(0, Math.min(duration, currentTime - clip.timelineStart));
  let gain = 1;

  if (clip.fadeIn > 0 && localTime < clip.fadeIn) {
    gain = Math.min(gain, localTime / clip.fadeIn);
  }
  if (clip.fadeOut > 0 && localTime > duration - clip.fadeOut) {
    gain = Math.min(gain, (duration - localTime) / clip.fadeOut);
  }

  return Math.max(0, Math.min(1, Number.isFinite(gain) ? gain : 1));
}

function App() {
  const contextMenuMargin = 12;
  const initialTrack = useMemo(() => createAudioTrack(1), []);

  const [videoSources, setVideoSources] = useState<MediaSourceItem[]>([]);
  const [audioSources, setAudioSources] = useState<MediaSourceItem[]>([]);
  const [videoClips, setVideoClips] = useState<VideoClip[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([initialTrack]);
  const [mosaicTracks, setMosaicTracks] = useState<MosaicTrack[]>([]);
  const [selectedMosaicClipId, setSelectedMosaicClipId] = useState<string | null>(null);
  const [selectedMosaicTrackId, setSelectedMosaicTrackId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string>(initialTrack.id);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState('無音動画 1 本と音声を追加して編集を開始します。');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [bulkValues, setBulkValues] = useState<Record<string, string>>({ [initialTrack.id]: '0' });
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [dragSession, setDragSession] = useState<DragSessionState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const mosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioPickerTrackIdRef = useRef<string>(initialTrack.id);
  const playbackFrameRef = useRef<number | null>(null);
  const playbackStateRef = useRef({ startedAt: 0, startedFrom: 0 });
  const dragRef = useRef<{
    kind: 'video' | 'audio';
    trackId?: string;
    clipId: string;
    mode: DragMode;
    originX: number;
    initialStart: number;
    initialEnd: number;
    previewStart?: number;
    videoClipsSnapshot?: VideoClip[];
    audioClipsSnapshot?: AudioClip[];
  } | null>(null);
  const mosaicDragRef = useRef<{
    trackId: string;
    clipId: string;
    mode: 'move' | 'trim-start' | 'trim-end';
    originX: number;
    initialStart: number;
    initialEnd: number;
  } | null>(null);

  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const seekDragActiveRef = useRef(false);
  const seekDragPointerIdRef = useRef<number | null>(null);

  const flattenedAudioClips = useMemo<FlattenedAudioClip[]>(() => {
    return audioTracks.flatMap((track) => track.clips.map((clip) => ({ ...clip, trackId: track.id })));
  }, [audioTracks]);

  const sourceMap = useMemo(() => {
    return new Map<string, MediaSourceItem>([
      ...videoSources.map((source) => [source.id, source] as [string, MediaSourceItem]),
      ...audioSources.map((source) => [source.id, source] as [string, MediaSourceItem]),
    ]);
  }, [audioSources, videoSources]);

  const audioSourceRmsMap = useMemo(() => {
    return new Map(audioSources.map((source) => [source.id, source.rmsGraph] as const));
  }, [audioSources]);

  const timelineDuration = useMemo(() => {
    return totalTimelineDuration(videoClips, flattenedAudioClips);
  }, [flattenedAudioClips, videoClips]);

  const activeVideoClip = useMemo(() => {
    return videoClips.find((clip) => playhead >= clip.timelineStart && playhead < clipEnd(clip)) ?? null;
  }, [playhead, videoClips]);

  const contextMenuClip = useMemo(() => {
    if (!contextMenu) return null;
    if (contextMenu.kind === 'mosaic') return null;
    if (contextMenu.kind === 'video') {
      return videoClips.find((clip) => clip.id === contextMenu.clipId) ?? null;
    }
    const track = audioTracks.find((item) => item.id === contextMenu.trackId);
    return track?.clips.find((clip) => clip.id === contextMenu.clipId) ?? null;
  }, [audioTracks, contextMenu, videoClips]);

  const contextMenuMosaicClip = useMemo(() => {
    if (!contextMenu || contextMenu.kind !== 'mosaic') return null;
    const track = mosaicTracks.find((t) => t.id === contextMenu.trackId);
    return track?.clips.find((c) => c.id === contextMenu.clipId) ?? null;
  }, [contextMenu, mosaicTracks]);

  const contextMenuMaxFade = contextMenuClip ? clipDuration(contextMenuClip) / 2 : 0;

  useEffect(() => {
    if (!contextMenu || (!contextMenuClip && !contextMenuMosaicClip)) {
      setContextMenuPosition(null);
      return;
    }

    const updateContextMenuPosition = () => {
      const width = contextMenuRef.current?.offsetWidth ?? 280;
      const height = contextMenuRef.current?.offsetHeight ?? 320;
      setContextMenuPosition({
        left: Math.max(contextMenuMargin, Math.min(contextMenu.x, window.innerWidth - width - contextMenuMargin)),
        top: Math.max(contextMenuMargin, Math.min(contextMenu.y, window.innerHeight - height - contextMenuMargin)),
      });
    };

    updateContextMenuPosition();
    window.addEventListener('resize', updateContextMenuPosition);
    return () => window.removeEventListener('resize', updateContextMenuPosition);
  }, [contextMenu, contextMenuClip, contextMenuMosaicClip]);
  const timelineSeconds = Math.max(1, Math.ceil(timelineDuration) + 1);
  const dragPreviewEnd = dragPreview ? dragPreview.timelineStart + dragPreview.duration : 0;
  const renderedTimelineSeconds = Math.max(timelineSeconds, Math.max(1, Math.ceil(dragPreviewEnd) + 1));
  const pixelsPerSecond = useMemo(() => {
    if (timelineViewportWidth <= 0) return MAX_PIXELS_PER_SECOND;
    const fitted = timelineViewportWidth / timelineSeconds;
    return Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, fitted));
  }, [timelineSeconds, timelineViewportWidth]);
  const timelineWidth = Math.max(timelineViewportWidth, renderedTimelineSeconds * pixelsPerSecond);
  const previewFade = activeVideoClip ? 1 - fadeGain(activeVideoClip, playhead) : 1;
  const previewAspectRatio = videoSources.length > 0 && videoSources[0]?.width && videoSources[0]?.height
    ? `${videoSources[0].width} / ${videoSources[0].height}`
    : '16 / 9';

  useEffect(() => {
    if (!audioTracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(audioTracks[0]?.id ?? '');
    }
  }, [audioTracks, selectedTrackId]);

  useEffect(() => {
    const element = timelineScrollRef.current;
    if (!element) return;

    const updateWidth = () => {
      setTimelineViewportWidth(element.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current);
      }
      previewVideoRef.current?.pause();
      Object.values(audioRefs.current).forEach((element) => element?.pause());
    };
  }, []);

  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
    };

    const clearDropTarget = () => {
      setDropTarget(null);
    };

    window.addEventListener('dragover', preventWindowDrop);
    window.addEventListener('drop', preventWindowDrop);
    window.addEventListener('drop', clearDropTarget);

    return () => {
      window.removeEventListener('dragover', preventWindowDrop);
      window.removeEventListener('drop', preventWindowDrop);
      window.removeEventListener('drop', clearDropTarget);
    };
  }, []);

  function syncMedia(time: number, shouldPlay: boolean) {
    const videoElement = previewVideoRef.current;
    const effectiveTime = Math.max(0, time);
    const keepPlaying = shouldPlay || playbackFrameRef.current !== null;

    if (videoElement) {
      const activeClip = videoClips.find((clip) => effectiveTime >= clip.timelineStart && effectiveTime < clipEnd(clip));
      if (activeClip) {
        const localTime = effectiveTime - activeClip.timelineStart;
        const resolution = resolveSegmentAtPlaytime(activeClip, localTime);
        const source = sourceMap.get(resolution.seg.sourceId);
        if (!source) {
          videoElement.pause();
          return;
        }
        if (videoElement.src !== source.objectUrl) {
          videoElement.src = source.objectUrl;
        }
        const mediaElement = videoElement as HTMLVideoElement & {
          preservesPitch?: boolean;
          mozPreservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        mediaElement.playbackRate = resolution.effectiveSpeed;
        mediaElement.preservesPitch = true;
        mediaElement.mozPreservesPitch = true;
        mediaElement.webkitPreservesPitch = true;
        const desiredTime = resolution.seg.sourceStart + resolution.segLocalTime * resolution.seg.speed;
        if (Number.isFinite(desiredTime) && Math.abs(videoElement.currentTime - desiredTime) > 0.08) {
          videoElement.currentTime = desiredTime;
        }
        if (keepPlaying) {
          void videoElement.play().catch(() => undefined);
        } else {
          videoElement.pause();
        }
      } else {
        videoElement.pause();
      }
    }

    flattenedAudioClips.forEach((clip) => {
      const element = audioRefs.current[clip.id];
      if (!element) return;

      const inRange = effectiveTime >= clip.timelineStart && effectiveTime < clipEnd(clip);
      if (!inRange) {
        element.pause();
        return;
      }

      const localTime = effectiveTime - clip.timelineStart;
      const resolution = resolveSegmentAtPlaytime(clip, localTime);
      const source = sourceMap.get(resolution.seg.sourceId);
      if (!source) {
        element.pause();
        return;
      }

      if (element.src !== source.objectUrl) {
        element.src = source.objectUrl;
      }

      const mediaElement = element as HTMLAudioElement & {
        preservesPitch?: boolean;
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      mediaElement.playbackRate = resolution.effectiveSpeed;
      mediaElement.preservesPitch = true;
      mediaElement.mozPreservesPitch = true;
      mediaElement.webkitPreservesPitch = true;

      const desiredTime = resolution.seg.sourceStart + resolution.segLocalTime * resolution.seg.speed;
      if (Number.isFinite(desiredTime) && Math.abs(element.currentTime - desiredTime) > 0.08) {
        element.currentTime = desiredTime;
      }

      element.volume = Math.max(0, Math.min(1, dbToGain(clip.volumeDb) * fadeGain(clip, effectiveTime)));
      if (keepPlaying) {
        void element.play().catch(() => undefined);
      } else {
        element.pause();
      }
    });
  }

  function stopPlayback(reset = false) {
    if (playbackFrameRef.current !== null) {
      cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }

    const derivedPlayhead = reset
      ? 0
      : isPlaying
        ? Math.max(
            0,
            Math.min(
              timelineDuration,
              playbackStateRef.current.startedFrom + (performance.now() - playbackStateRef.current.startedAt) / 1000,
            ),
          )
        : playhead;

    setIsPlaying(false);
    setPlayhead(derivedPlayhead);
    syncMedia(derivedPlayhead, false);
  }

  function startPlayback() {
    if (timelineDuration <= 0) return;
    if (playbackFrameRef.current !== null) return;

    const startedFrom = playhead >= timelineDuration ? 0 : playhead;
    playbackStateRef.current = { startedAt: performance.now(), startedFrom };
    setPlayhead(startedFrom);
    setIsPlaying(true);
    syncMedia(startedFrom, true);

    const tick = () => {
      const next = playbackStateRef.current.startedFrom + (performance.now() - playbackStateRef.current.startedAt) / 1000;
      if (next >= timelineDuration) {
        setPlayhead(timelineDuration);
        if (playbackFrameRef.current !== null) {
          cancelAnimationFrame(playbackFrameRef.current);
          playbackFrameRef.current = null;
        }
        setIsPlaying(false);
        syncMedia(timelineDuration, false);
        return;
      }

      setPlayhead(next);
      syncMedia(next, true);
      playbackFrameRef.current = requestAnimationFrame(tick);
    };

    playbackFrameRef.current = requestAnimationFrame(tick);
  }

  async function handleVideoFile(file: File) {
    try {
      stopPlayback(true);
      setContextMenu(null);
      setStatus('動画メタデータを解析しています。');
      const source = await loadVideoSource(file);
      setVideoSources((current) => [...current, source]);
      setVideoClips((clips) => {
        const existingDuration = clips.length > 0 ? Math.max(...clips.map((clip) => clipEnd(clip))) : 0;
        return [
          ...clips,
          {
            id: crypto.randomUUID(),
            sourceId: source.id,
            kind: 'video',
            timelineStart: existingDuration,
            sourceStart: 0,
            sourceDuration: source.duration,
            sourceMaxDuration: source.duration,
            speed: 1,
            fadeIn: 0,
            fadeOut: 0,
          },
        ];
      });
      setStatus(`動画を追加しました: ${source.name}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(`動画の読み込みに失敗しました: ${detail}`);
    }
  }

  async function handleAudioFiles(files: FileList | File[], explicitTrackId?: string) {
    const list = Array.from(files);
    const targetTrackId = explicitTrackId || selectedTrackId || audioTracks[0]?.id;
    if (!targetTrackId || list.length === 0) return;

    try {
      setStatus('音声メタデータを解析しています。');
      
      // AudioContext を生成（RMS グラフ計算用）
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const loadedSources = await Promise.all(list.map((file) => loadAudioSource(file)));

      // 各音声ファイルの RMS グラフを計算
      const rmsGraphs = await Promise.all(
        list.map((file) => computeRmsGraph(file, audioContext))
      );

      setAudioSources((current) => [
        ...current,
        ...loadedSources.map((source, index) => ({ ...source, rmsGraph: rmsGraphs[index] })),
      ]);

      setAudioTracks((tracks) => tracks.map((track) => {
        if (track.id !== targetTrackId) return track;
        let cursor = track.clips.length > 0 ? Math.max(...track.clips.map((clip) => clipEnd(clip))) : 0;
        const appended = [...track.clips];
        loadedSources.forEach((source, index) => {
          appended.push({
            id: crypto.randomUUID(),
            sourceId: source.id,
            kind: 'audio',
            timelineStart: cursor,
            sourceStart: 0,
            sourceDuration: source.duration,
            sourceMaxDuration: source.duration,
            speed: 1,
            fadeIn: 0,
            fadeOut: 0,
            volumeDb: 0,
            rmsGraph: rmsGraphs[index],
          });
          cursor += source.duration;
        });
        return { ...track, clips: normalizeClips(appended) };
      }));
      setStatus(`${list.length} 本の音声を追加しました。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(`音声の読み込みに失敗しました: ${detail}`);
    }
  }

  function openVideoPicker() {
    videoInputRef.current?.click();
  }

  function openAudioPicker(trackId: string) {
    audioPickerTrackIdRef.current = trackId;
    setSelectedTrackId(trackId);
    audioInputRef.current?.click();
  }

  function addAudioTrack() {
    const next = createAudioTrack(audioTracks.length + 1);
    setAudioTracks((tracks) => [...tracks, next]);
    setSelectedTrackId(next.id);
    setBulkValues((current) => ({ ...current, [next.id]: '0' }));
  }

  function deleteAudioTrack(trackId: string) {
    const track = audioTracks.find((item) => item.id === trackId);
    if (!track) return;

    setAudioTracks((tracks) => tracks.filter((item) => item.id !== trackId));
    setBulkValues((current) => {
      const next = { ...current };
      delete next[trackId];
      return next;
    });
    if (audioPickerTrackIdRef.current === trackId) {
      const fallback = audioTracks.find((item) => item.id !== trackId)?.id ?? '';
      audioPickerTrackIdRef.current = fallback;
    }
    setStatus(`${track.name} を削除しました。`);
  }

  function collectFiles(fileList: FileList | null) {
    return fileList ? Array.from(fileList) : [];
  }

  function handleVideoDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget('video');
  }

  function handleVideoDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDropTarget('video');
  }

  function handleAudioDragOver(event: ReactDragEvent<HTMLElement>, trackId: string) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget(`audio:${trackId}`);
  }

  function handleAudioDragEnter(event: ReactDragEvent<HTMLElement>, trackId: string) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDropTarget(`audio:${trackId}`);
  }

  function handleDragLeave(event: ReactDragEvent<HTMLElement>, target: Exclude<DropTarget, null>) {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    if (dropTarget === target) {
      setDropTarget(null);
    }
  }

  function handleVideoDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setDropTarget(null);
    const file = collectFiles(event.dataTransfer.files).find(isVideoFile);
    if (!file) {
      setStatus('動画ファイルをドロップしてください。');
      return;
    }
    void handleVideoFile(file);
  }

  function handleAudioDrop(event: ReactDragEvent<HTMLElement>, trackId: string) {
    event.preventDefault();
    setDropTarget(null);
    const files = collectFiles(event.dataTransfer.files).filter(isAudioFile);
    if (files.length === 0) {
      setStatus('音声ファイルをドロップしてください。');
      return;
    }
    setSelectedTrackId(trackId);
    void handleAudioFiles(files, trackId);
  }

  function beginDrag(
    kind: 'video' | 'audio',
    clipId: string,
    mode: DragMode,
    event: ReactPointerEvent<HTMLDivElement>,
    trackId?: string,
  ) {
    const clip = kind === 'video'
      ? videoClips.find((item) => item.id === clipId)
      : audioTracks.find((track) => track.id === trackId)?.clips.find((item) => item.id === clipId);
    if (!clip) return;

    dragRef.current = {
      kind,
      trackId,
      clipId,
      mode,
      originX: event.clientX,
      initialStart: clip.timelineStart,
      initialEnd: clipEnd(clip),
      videoClipsSnapshot: kind === 'video' ? videoClips : undefined,
      audioClipsSnapshot: kind === 'audio' && trackId ? audioTracks.find((track) => track.id === trackId)?.clips : undefined,
    };
    setDragSession({ kind, trackId, clipId, mode });
    setDragPreview(null);
  }

  function handleClipPointerDown(
    kind: 'video' | 'audio',
    clipId: string,
    event: ReactPointerEvent<HTMLDivElement>,
    trackId?: string,
  ) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    let mode: DragMode = 'move';
    if (handle === 'start') {
      mode = event.shiftKey ? 'trim-start' : 'speed-start';
    } else if (handle === 'end') {
      mode = event.shiftKey ? 'trim-end' : 'speed-end';
    }

    setContextMenu(null);
    event.preventDefault();
    beginDrag(kind, clipId, mode, event, trackId);
  }

  function stopPlaybackForSeek() {
    if (playbackFrameRef.current !== null) {
      stopPlayback(false);
    }
  }

  function seekFromClientX(clientX: number, container: HTMLElement) {
    const rect = container.getBoundingClientRect();
    const relativeX = clientX - rect.left + container.scrollLeft;
    const maxTime = Math.max(timelineDuration, 0);
    const next = Math.max(0, Math.min(maxTime, relativeX / pixelsPerSecond));
    stopPlaybackForSeek();
    setPlayhead(next);
  }

  function handleTimelinePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.clip-block')) return;
    if (isTimelineInteractiveElement(target)) return;

    setContextMenu(null);
    seekDragActiveRef.current = true;
    seekDragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleTimelinePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!seekDragActiveRef.current) return;
    if (seekDragPointerIdRef.current !== event.pointerId) return;
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleTimelinePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (seekDragPointerIdRef.current === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    seekDragActiveRef.current = false;
    seekDragPointerIdRef.current = null;
  }

  function updateMenuClip(partial: Partial<AudioClip & VideoClip>) {
    if (!contextMenu) return;

    if (contextMenu.kind === 'video') {
      setVideoClips((clips) => clips.map((clip) => {
        if (clip.id !== contextMenu.clipId) return clip;
        return {
          ...clip,
          ...partial,
          fadeIn: clampFade(partial.fadeIn ?? clip.fadeIn, { ...clip, ...partial }),
          fadeOut: clampFade(partial.fadeOut ?? clip.fadeOut, { ...clip, ...partial }),
        };
      }));
      return;
    }

    setAudioTracks((tracks) => tracks.map((track) => {
      if (track.id !== contextMenu.trackId) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== contextMenu.clipId) return clip;
          return {
            ...clip,
            ...partial,
            fadeIn: clampFade(partial.fadeIn ?? clip.fadeIn, { ...clip, ...partial }),
            fadeOut: clampFade(partial.fadeOut ?? clip.fadeOut, { ...clip, ...partial }),
            volumeDb: clampVolumeDb(partial.volumeDb ?? clip.volumeDb),
          };
        }),
      };
    }));
  }

  function removeActiveClip() {
    if (!contextMenu) return;

    if (contextMenu.kind === 'mosaic') {
      setMosaicTracks((tracks) => deleteMosaicClip(tracks, contextMenu.trackId ?? '', contextMenu.clipId));
      if (selectedMosaicClipId === contextMenu.clipId) setSelectedMosaicClipId(null);
      setContextMenu(null);
      return;
    }

    if (contextMenu.kind === 'video') {
      setVideoClips((clips) => deleteClip(clips, contextMenu.clipId));
    } else {
      setAudioTracks((tracks) => tracks.map((track) => {
        if (track.id !== contextMenu.trackId) return track;
        return { ...track, clips: deleteClip(track.clips, contextMenu.clipId) };
      }));
    }
    setContextMenu(null);
  }

  function splitActiveClip() {
    if (!contextMenu) return;

    if (contextMenu.kind === 'mosaic') {
      setMosaicTracks((tracks) => splitMosaicClip(tracks, contextMenu.trackId ?? '', contextMenu.clipId, playhead));
      setContextMenu(null);
      return;
    }

    if (contextMenu.kind === 'video') {
      setVideoClips((clips) => splitClip(clips, contextMenu.clipId, playhead));
    } else {
      setAudioTracks((tracks) => tracks.map((track) => {
        if (track.id !== contextMenu.trackId) return track;
        return { ...track, clips: splitClip(track.clips, contextMenu.clipId, playhead) };
      }));
    }
    setContextMenu(null);
  }

  function canJoinMenuClip() {
    if (!contextMenu) return false;

    if (contextMenu.kind === 'mosaic') {
      const track = mosaicTracks.find((t) => t.id === contextMenu.trackId);
      if (!track) return false;
      const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
      const index = sorted.findIndex((c) => c.id === contextMenu.clipId);
      if (index < 0 || index >= sorted.length - 1) return false;
      const left = sorted[index];
      const right = sorted[index + 1];
      return Math.abs(left.timelineStart + left.duration - right.timelineStart) <= 0.02;
    }

    if (contextMenu.kind === 'video') {
      const sorted = normalizeClips(videoClips);
      const index = sorted.findIndex((clip) => clip.id === contextMenu.clipId);
      return index >= 0 && index < sorted.length - 1 && canJoinPair(sorted[index], sorted[index + 1]);
    }

    const track = audioTracks.find((item) => item.id === contextMenu.trackId);
    if (!track) return false;
    const sorted = normalizeClips(track.clips);
    const index = sorted.findIndex((clip) => clip.id === contextMenu.clipId);
    return index >= 0 && index < sorted.length - 1 && canJoinPair(sorted[index], sorted[index + 1]);
  }

  function joinActiveClip() {
    if (!contextMenu || !canJoinMenuClip()) return;

    if (contextMenu.kind === 'mosaic') {
      setMosaicTracks((tracks) => joinMosaicClipWithNext(tracks, contextMenu.trackId ?? '', contextMenu.clipId));
      setContextMenu(null);
      return;
    }

    if (contextMenu.kind === 'video') {
      setVideoClips((clips) => joinClipWithNext(clips, contextMenu.clipId));
    } else {
      setAudioTracks((tracks) => tracks.map((track) => {
        if (track.id !== contextMenu.trackId) return track;
        return { ...track, clips: joinClipWithNext(track.clips, contextMenu.clipId) };
      }));
    }
    setContextMenu(null);
  }

  // ─── モザイク操作ハンドラー ──────────────────────────────────────────────

  function handleAddMosaicTrack() {
    setMosaicTracks((tracks) => addMosaicTrack(tracks));
  }

  function handleDeleteMosaicTrack(trackId: string) {
    const deletingTrack = mosaicTracks.find((track) => track.id === trackId);
    setMosaicTracks((tracks) => tracks.filter((track) => track.id !== trackId));
    setSelectedMosaicTrackId((current) => (current === trackId ? null : current));
    setSelectedMosaicClipId((current) => {
      if (!current) return current;
      if (!deletingTrack) return current;
      return deletingTrack.clips.some((clip) => clip.id === current) ? null : current;
    });
  }

  function handleAddMosaicClip(trackId: string) {
    const newClip: MosaicClip = {
      id: crypto.randomUUID(),
      timelineStart: playhead,
      duration: 2,
      mask: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1, angle: 0 },
    };
    setMosaicTracks((tracks) => addMosaicClipToTrack(tracks, trackId, newClip));
    setSelectedMosaicClipId(newClip.id);
    setSelectedMosaicTrackId(trackId);
  }

  function handleMosaicClipPointerDown(
    trackId: string,
    clipId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const track = mosaicTracks.find((t) => t.id === trackId);
    const clip = track?.clips.find((c) => c.id === clipId);
    if (!clip) return;

    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const mode = handle === 'start' ? 'trim-start' : handle === 'end' ? 'trim-end' : 'move';

    setContextMenu(null);
    setSelectedMosaicClipId(clipId);
    setSelectedMosaicTrackId(trackId);
    mosaicDragRef.current = {
      trackId,
      clipId,
      mode,
      originX: event.clientX,
      initialStart: clip.timelineStart,
      initialEnd: clip.timelineStart + clip.duration,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleMosaicClipPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = mosaicDragRef.current;
    if (!drag) return;
    const deltaSeconds = (event.clientX - drag.originX) / pixelsPerSecond;

    if (drag.mode === 'move') {
      setMosaicTracks((tracks) => moveMosaicClip(tracks, drag.trackId, drag.clipId, drag.initialStart + deltaSeconds));
      return;
    }

    if (drag.mode === 'trim-start') {
      setMosaicTracks((tracks) => trimMosaicClip(tracks, drag.trackId, drag.clipId, 'start', drag.initialStart + deltaSeconds));
      return;
    }

    setMosaicTracks((tracks) => trimMosaicClip(tracks, drag.trackId, drag.clipId, 'end', drag.initialEnd + deltaSeconds));
  }

  function handleMosaicClipPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    mosaicDragRef.current = null;
  }

  // ─── モザイク楕円オーバーレイ描画 ─────────────────────────────────────────

  useEffect(() => {
    const canvas = mosaicCanvasRef.current;
    if (!canvas) return;
    const video = previewVideoRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const activeClips = getActiveMosaicClips(mosaicTracks, playhead);
    if (activeClips.length === 0) return;

    // ピクセルモザイクを描画する（OffscreenCanvas 非対応環境は通常 canvas でフォールバック）
    if (video && video.readyState >= 2) {
      const videoWidth = video.videoWidth || w;
      const videoHeight = video.videoHeight || h;
      const longerSide = Math.max(videoWidth, videoHeight);
      const ps = Math.max(2, Math.floor(calcMosaicPixelSize(longerSide)));

      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = w;
      fallbackCanvas.height = h;
      const offscreen: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : fallbackCanvas;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.drawImage(video, 0, 0, w, h);
        const imageData = offCtx.getImageData(0, 0, w, h);
        const { data } = imageData;

        for (const { clip } of activeClips) {
          const { cx, cy, rx, ry, angle } = clip.mask;
          const cosA = Math.cos(angle || 0);
          const sinA = Math.sin(angle || 0);
          for (let blockY = 0; blockY < h; blockY += ps) {
            for (let blockX = 0; blockX < w; blockX += ps) {
              // ブロック中心の正規化座標
              const nx = (blockX + ps / 2) / w;
              const ny = (blockY + ps / 2) / h;
              const dx = nx - cx;
              const dy = ny - cy;
              // 楕円ローカル座標へ逆回転して判定
              const localX = dx * cosA + dy * sinA;
              const localY = -dx * sinA + dy * cosA;
              const ex = rx > 0 ? localX / rx : 9999;
              const ey = ry > 0 ? localY / ry : 9999;
              if (ex * ex + ey * ey > 1) continue;

              // ブロック内の平均色を計算
              let rSum = 0;
              let gSum = 0;
              let bSum = 0;
              let count = 0;
              for (let dyPix = 0; dyPix < ps && blockY + dyPix < h; dyPix += 1) {
                for (let dxPix = 0; dxPix < ps && blockX + dxPix < w; dxPix += 1) {
                  const idx = ((blockY + dyPix) * w + (blockX + dxPix)) * 4;
                  rSum += data[idx];
                  gSum += data[idx + 1];
                  bSum += data[idx + 2];
                  count += 1;
                }
              }
              if (count === 0) continue;
              const rAvg = rSum / count;
              const gAvg = gSum / count;
              const bAvg = bSum / count;

              // 平均色でブロックを塗りつぶす
              for (let dyPix = 0; dyPix < ps && blockY + dyPix < h; dyPix += 1) {
                for (let dxPix = 0; dxPix < ps && blockX + dxPix < w; dxPix += 1) {
                  const idx = ((blockY + dyPix) * w + (blockX + dxPix)) * 4;
                  data[idx] = rAvg;
                  data[idx + 1] = gAvg;
                  data[idx + 2] = bAvg;
                }
              }
            }
          }
        }

        offCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(offscreen as CanvasImageSource, 0, 0, w, h);
      }
    }

    // 楕円のアウトライン（選択中はハンドル付き）を描画
    for (const { clip } of activeClips) {
      const { cx, cy, rx, ry, angle } = clip.mask;
      const px = cx * w;
      const py = cy * h;
      const prx = rx * w;
      const pry = ry * h;
      const cosA = Math.cos(angle || 0);
      const sinA = Math.sin(angle || 0);

      ctx.beginPath();
      ctx.ellipse(px, py, prx, pry, angle || 0, 0, Math.PI * 2);
      ctx.strokeStyle = clip.id === selectedMosaicClipId ? 'rgba(255,140,60,0.95)' : 'rgba(144,238,144,0.95)';
      ctx.lineWidth = clip.id === selectedMosaicClipId ? 2 : 1;
      ctx.stroke();

      if (clip.id === selectedMosaicClipId) {
        // ハンドル（中心・4方向・回転）
        const right: [number, number] = [px + prx * cosA, py + prx * sinA];
        const left: [number, number] = [px - prx * cosA, py - prx * sinA];
        const down: [number, number] = [px - pry * sinA, py + pry * cosA];
        const up: [number, number] = [px + pry * sinA, py - pry * cosA];
        const rotate: [number, number] = [up[0] + (up[0] - px) * 0.35, up[1] + (up[1] - py) * 0.35];
        const handles: Array<[number, number, boolean]> = [
          [px, py, false],
          [right[0], right[1], false],
          [left[0], left[1], false],
          [down[0], down[1], false],
          [up[0], up[1], false],
          [rotate[0], rotate[1], true],
        ];
        for (const [hx, hy, isRotate] of handles) {
          ctx.beginPath();
          ctx.arc(hx, hy, 5, 0, Math.PI * 2);
          ctx.fillStyle = isRotate ? 'rgba(96,218,251,0.95)' : 'rgba(255,200,0,0.9)';
          ctx.fill();
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }, [mosaicTracks, playhead, selectedMosaicClipId]);

  // ─── モザイクオーバーレイのポインタ操作（楕円の移動・リサイズ・回転）──────────

  const mosaicOverlayDragRef = useRef<{
    clipId: string;
    trackId: string;
    mode: 'move' | 'resize-right' | 'resize-left' | 'resize-bottom' | 'resize-top' | 'rotate';
    originX: number;
    originY: number;
    initialMask: EllipseMask;
  } | null>(null);

  function handleMosaicOverlayPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const canvas = mosaicCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) / rect.width;
    const my = (event.clientY - rect.top) / rect.height;

    const activeClips = getActiveMosaicClips(mosaicTracks, playhead);
    // 選択中クリップのハンドル判定を優先
    const sorted = [...activeClips].sort((a, b) =>
      a.clip.id === selectedMosaicClipId ? -1 : b.clip.id === selectedMosaicClipId ? 1 : 0,
    );

    for (const { clip, track } of sorted) {
      const { cx, cy, rx, ry, angle } = clip.mask;
      const cosA = Math.cos(angle || 0);
      const sinA = Math.sin(angle || 0);
      const handleRadius = 0.02;

      // ハンドル判定（正規化座標）
      const right: [number, number] = [cx + rx * cosA, cy + rx * sinA];
      const left: [number, number] = [cx - rx * cosA, cy - rx * sinA];
      const down: [number, number] = [cx - ry * sinA, cy + ry * cosA];
      const up: [number, number] = [cx + ry * sinA, cy - ry * cosA];
      const rotate: [number, number] = [up[0] + (up[0] - cx) * 0.35, up[1] + (up[1] - cy) * 0.35];

      const hitHandles: Array<[number, number, 'move' | 'resize-right' | 'resize-left' | 'resize-bottom' | 'resize-top' | 'rotate']> = [
        [right[0], right[1], 'resize-right'],
        [left[0], left[1], 'resize-left'],
        [down[0], down[1], 'resize-bottom'],
        [up[0], up[1], 'resize-top'],
        [rotate[0], rotate[1], 'rotate'],
        [cx, cy, 'move'],
      ];

      for (const [hx, hy, mode] of hitHandles) {
        const dx = (mx - hx) * (rect.width / rect.height > 1 ? rect.width / rect.height : 1);
        const dy = my - hy;
        if (Math.sqrt(dx * dx + dy * dy) <= handleRadius) {
          setSelectedMosaicClipId(clip.id);
          setSelectedMosaicTrackId(track.id);
          mosaicOverlayDragRef.current = {
            clipId: clip.id,
            trackId: track.id,
            mode,
            originX: mx,
            originY: my,
            initialMask: { ...clip.mask },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.stopPropagation();
          return;
        }
      }

      // 回転楕円内クリックで選択
      const dx = mx - cx;
      const dy = my - cy;
      const localX = dx * cosA + dy * sinA;
      const localY = -dx * sinA + dy * cosA;
      const ex = rx > 0 ? localX / rx : 9999;
      const ey = ry > 0 ? localY / ry : 9999;
      if (ex * ex + ey * ey <= 1) {
        setSelectedMosaicClipId(clip.id);
        setSelectedMosaicTrackId(track.id);
        mosaicOverlayDragRef.current = {
          clipId: clip.id,
          trackId: track.id,
          mode: 'move',
          originX: mx,
          originY: my,
          initialMask: { ...clip.mask },
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.stopPropagation();
        return;
      }
    }
  }

  function handleMosaicOverlayPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = mosaicOverlayDragRef.current;
    if (!drag) return;
    const canvas = mosaicCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) / rect.width;
    const my = (event.clientY - rect.top) / rect.height;
    const dx = mx - drag.originX;
    const dy = my - drag.originY;
    const { initialMask } = drag;

    let newMask: EllipseMask = { ...initialMask };
    switch (drag.mode) {
      case 'move':
        newMask = { ...initialMask, cx: initialMask.cx + dx, cy: initialMask.cy + dy };
        break;
      case 'resize-right':
        newMask = { ...initialMask, rx: Math.max(0.01, initialMask.rx + dx) };
        break;
      case 'resize-left':
        newMask = { ...initialMask, rx: Math.max(0.01, initialMask.rx - dx) };
        break;
      case 'resize-bottom':
        newMask = { ...initialMask, ry: Math.max(0.01, initialMask.ry + dy) };
        break;
      case 'resize-top':
        newMask = { ...initialMask, ry: Math.max(0.01, initialMask.ry - dy) };
        break;
      case 'rotate': {
        const startAngle = Math.atan2(drag.originY - initialMask.cy, drag.originX - initialMask.cx);
        const nowAngle = Math.atan2(my - initialMask.cy, mx - initialMask.cx);
        newMask = { ...initialMask, angle: initialMask.angle + (nowAngle - startAngle) };
        break;
      }
    }

    setMosaicTracks((tracks) => updateMosaicEllipse(tracks, drag.trackId, drag.clipId, newMask));
  }

  function handleMosaicOverlayPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    mosaicOverlayDragRef.current = null;
  }

  async function runExport() {
    if (videoSources.length === 0 || videoClips.length === 0) {
      setStatus('動画がないためエクスポートできません。');
      return;
    }

    try {
      setBusy(true);
      setExportLogs([]);
      setExportProgress({ phase: 'prepare', ratio: 0, message: 'エクスポート準備中です。' });
      const blob = await exportTimelineToMp4({
        videoClips,
        audioTracks,
        mosaicTracks,
        videoSources,
        audioSources,
        onProgress: setExportProgress,
        onLog: (message) => setExportLogs((current) => [...current.slice(-120), message]),
      });
      triggerDownload(blob, 'video-edit-export.mp4');
      setStatus('mp4 エクスポートが完了しました。');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setExportLogs((current) => [...current.slice(-120), `エラー: ${detail}`]);
      setStatus(`エクスポートに失敗しました。${detail}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaSeconds = (event.clientX - drag.originX) / pixelsPerSecond;
      if (drag.kind === 'video') {
        if (drag.mode === 'move') {
          const snapshot = drag.videoClipsSnapshot;
          if (!snapshot) return;
          const previewClips = moveClip(snapshot, drag.clipId, drag.initialStart + deltaSeconds, 'video');
          const previewClip = previewClips.find((clip) => clip.id === drag.clipId);
          if (!previewClip) return;
          drag.previewStart = previewClip.timelineStart;
          setDragPreview({
            kind: 'video',
            clipId: drag.clipId,
            timelineStart: previewClip.timelineStart,
            duration: clipDuration(previewClip),
          });
          return;
        }

        setVideoClips((clips) => {
          switch (drag.mode) {
            case 'move':
              return moveClip(clips, drag.clipId, drag.initialStart + deltaSeconds, 'video');
            case 'trim-start':
              return trimClip(clips, drag.clipId, 'start', drag.initialStart + deltaSeconds, 'video');
            case 'trim-end':
              return trimClip(clips, drag.clipId, 'end', drag.initialEnd + deltaSeconds, 'video');
            case 'speed-start':
              return changeClipSpeed(clips, drag.clipId, 'start', drag.initialStart + deltaSeconds, 'video');
            case 'speed-end':
              return changeClipSpeed(clips, drag.clipId, 'end', drag.initialEnd + deltaSeconds, 'video');
          }
        });
        return;
      }

      if (drag.mode === 'move') {
        const snapshot = drag.audioClipsSnapshot;
        if (!snapshot) return;
        const previewClips = moveClip(snapshot, drag.clipId, drag.initialStart + deltaSeconds, 'audio');
        const previewClip = previewClips.find((clip) => clip.id === drag.clipId);
        if (!previewClip) return;
        drag.previewStart = previewClip.timelineStart;
        setDragPreview({
          kind: 'audio',
          trackId: drag.trackId,
          clipId: drag.clipId,
          timelineStart: previewClip.timelineStart,
          duration: clipDuration(previewClip),
        });
        return;
      }

      setAudioTracks((tracks) => tracks.map((track) => {
        if (track.id !== drag.trackId) return track;
        let clips = track.clips;
        switch (drag.mode) {
          case 'move':
            clips = moveClip(track.clips, drag.clipId, drag.initialStart + deltaSeconds, 'audio');
            break;
          case 'trim-start':
            clips = trimClip(track.clips, drag.clipId, 'start', drag.initialStart + deltaSeconds, 'audio');
            break;
          case 'trim-end':
            clips = trimClip(track.clips, drag.clipId, 'end', drag.initialEnd + deltaSeconds, 'audio');
            break;
          case 'speed-start':
            clips = changeClipSpeed(track.clips, drag.clipId, 'start', drag.initialStart + deltaSeconds, 'audio');
            break;
          case 'speed-end':
            clips = changeClipSpeed(track.clips, drag.clipId, 'end', drag.initialEnd + deltaSeconds, 'audio');
            break;
        }
        return { ...track, clips };
      }));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.mode === 'move') {
        const deltaSeconds = (event.clientX - drag.originX) / pixelsPerSecond;
        const finalStart = drag.previewStart ?? (drag.initialStart + deltaSeconds);

        if (drag.kind === 'video') {
          setVideoClips((clips) => moveClip(clips, drag.clipId, finalStart, 'video'));
        } else {
          setAudioTracks((tracks) => tracks.map((track) => {
            if (track.id !== drag.trackId) return track;
            return { ...track, clips: moveClip(track.clips, drag.clipId, finalStart, 'audio') };
          }));
        }
      }

      dragRef.current = null;
      setDragSession(null);
      setDragPreview(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    syncMedia(playhead, false);
  }, [playhead]);

  function renderClipLabel(clip: VideoClip | AudioClip) {
    const sourceName = sourceMap.get(clip.sourceId)?.name ?? (clip.kind === 'video' ? 'video' : 'audio');
    const joined = clip.segments && clip.segments.length > 1 ? ` [joined-${clip.segments.length}セグ]` : '';
    const details = clip.kind === 'audio'
      ? `${clip.speed.toFixed(2)}x / ${clip.volumeDb.toFixed(1)}dB`
      : `${clip.speed.toFixed(2)}x`;

    return (
      <div className="clip-label">
        <span>{sourceName}{joined}</span>
        <small>{details}</small>
      </div>
    );
  }

  function renderGhostClip(clip: VideoClip | AudioClip, left: number, width: number) {
    return (
      <div
        className={`clip-block ${clip.kind === 'video' ? 'video-clip' : 'audio-clip'} clip-ghost`}
        style={{ left, width }}
        aria-hidden="true"
      >
        {clip.kind === 'audio' ? (
          <RmsGraph rmsGraph={deriveClipRmsGraph(clip, audioSourceRmsMap)} width={width} height={40} />
        ) : null}
        <div className="clip-handle" data-handle="start" />
        {renderClipLabel(clip)}
        <div className="clip-handle" data-handle="end" />
      </div>
    );
  }

  const draggedVideoClip = dragPreview?.kind === 'video'
    ? videoClips.find((clip) => clip.id === dragPreview.clipId) ?? null
    : null;
  const draggedAudioClip = dragPreview?.kind === 'audio'
    ? audioTracks.find((track) => track.id === dragPreview.trackId)?.clips.find((clip) => clip.id === dragPreview.clipId) ?? null
    : null;

  return (
    <main className="video-edit-page" onClick={() => setContextMenu(null)}>
      <div className="topbar">
        <a className="topbar-link" href="../..">トップへ戻る</a>
        <nav className="topbar-nav" aria-label="ツール移動">
          <a className="topbar-link" href="../concat/">動画連結</a>
          <a className="topbar-link" href="../ugoira/">うごイラ</a>
          <a className="topbar-link" href="../pixiv/">pixivリサイズ</a>
          <a className="topbar-link" href="../character/">オリキャラ設定</a>
        </nav>
      </div>

      <section className="panel editor-shell">
        <div className="panel-head editor-head">
          <div>
            <span className="eyebrow">VIDEO EDIT MVP</span>
            <h1>動画編集</h1>
            <p>無音動画 1 本と複数音声トラックをタイムライン上で編集し、ブラウザ内で mp4 を書き出します。</p>
          </div>
          <div className="head-aside">
            <div className="status-card">
              <div className="status-text">{status}</div>
            </div>
            {exportProgress ? (
              <div className="status-card accent">
                <div className="status-text">{exportProgress.message}</div>
                <div className="progress-shell">
                  <div className="progress-bar" style={{ width: `${(exportProgress.ratio * 100).toFixed(1)}%` }} />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <section className="editor-pane">
          <div className="stack">
            <section className="preview-card">
              <h2>プレビュー</h2>
              <p className="section-note">現在の再生位置を確認します。フェードや速度変更の結果もここでそのままチェックできます。</p>
              <div className="preview-frame" style={{ aspectRatio: previewAspectRatio }}>
                {videoSources.length > 0 ? (
                  <>
                    <video ref={previewVideoRef} playsInline preload="auto" />
                    <div className="preview-fade" style={{ opacity: previewFade }} />
                    <canvas
                      ref={mosaicCanvasRef}
                      className="mosaic-overlay"
                      width={640}
                      height={360}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: mosaicTracks.length > 0 ? 'auto' : 'none' }}
                      onPointerDown={handleMosaicOverlayPointerDown}
                      onPointerMove={handleMosaicOverlayPointerMove}
                      onPointerUp={handleMosaicOverlayPointerUp}
                      onPointerCancel={handleMosaicOverlayPointerUp}
                    />
                  </>
                ) : (
                  <div className="preview-empty">動画を追加するとここにプレビューが表示されます。</div>
                )}
              </div>

              <div className="player-controls">
                <button className="primary" type="button" onClick={() => (isPlaying ? stopPlayback(false) : startPlayback())}>
                  {isPlaying ? '停止' : '再生'}
                </button>
                <button className="secondary" type="button" onClick={() => stopPlayback(true)}>
                  先頭へ
                </button>
                <div className="timecode">{formatTime(playhead)} / {formatTime(timelineDuration)}</div>
              </div>
            </section>

            <section className="timeline-card">
              <div className="timeline-header">
                <div>
                  <h2>タイムライン</h2>
                  <p>端ドラッグで速度変更、Shift + 端ドラッグでトリム、右クリックで分割・結合・フェード・削除。</p>
                  <p className="section-note">素材の追加はタイムラインに直接ドロップします。動画は Video レーン、音声は追加したい Audio レーンへ落としてください。動画は先頭基準のまま保持され、音声は同一トラック内で重ならないように配置されます。各トラックの一括 dB はクリップ群へまとめて反映されます。</p>
                </div>
                <button
                  className="primary"
                  type="button"
                  onClick={() => void runExport()}
                  disabled={busy || videoSources.length === 0 || videoClips.length === 0}
                >
                  mp4 エクスポート
                </button>
              </div>

              <div
                className="timeline-scroll"
                ref={timelineScrollRef}
                onPointerDown={handleTimelinePointerDown}
                onPointerMove={handleTimelinePointerMove}
                onPointerUp={handleTimelinePointerEnd}
                onPointerCancel={handleTimelinePointerEnd}
              >
                <div className="timeline-content" style={{ width: timelineWidth }}>
                  <div className="timeline-ruler">
                    {Array.from({ length: Math.max(2, renderedTimelineSeconds + 1) }).map((_, index) => (
                      <div
                        key={index}
                        className="ruler-tick"
                        style={{ left: index * pixelsPerSecond, width: pixelsPerSecond }}
                      >
                        {formatTime(index)}
                      </div>
                    ))}
                    <div className="playhead" style={{ left: playhead * pixelsPerSecond }}>
                      <div className="playhead-handle" />
                    </div>
                  </div>

                  <div
                    className={`track-lane video-lane lane-drop-target ${dropTarget === 'video' ? 'lane-drop-active' : ''}`}
                    onDragOver={handleVideoDragOver}
                    onDragEnter={handleVideoDragEnter}
                    onDragLeave={(event) => handleDragLeave(event, 'video')}
                    onDrop={handleVideoDrop}
                  >
                    <div className="track-lane-inner">
                      <div className="lane-label">Video</div>
                      <button className="lane-import-button" type="button" onClick={openVideoPicker}>動画を追加</button>
                      {videoClips.length === 0 ? (
                        <div className="lane-empty-state">ここに無音動画をドロップ</div>
                      ) : null}
                    </div>
                    <div className="playhead" style={{ left: playhead * pixelsPerSecond }} />
                    {videoClips.map((clip) => (
                      <div
                        key={clip.id}
                        className={`clip-block video-clip ${dragSession?.mode === 'move' && dragSession.kind === 'video' && dragSession.clipId === clip.id ? 'clip-drag-source' : ''}`}
                        style={{ left: clip.timelineStart * pixelsPerSecond, width: Math.max(12, clipDuration(clip) * pixelsPerSecond) }}
                        onPointerDown={(event) => handleClipPointerDown('video', clip.id, event)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({ clipId: clip.id, kind: 'video', x: event.clientX, y: event.clientY });
                        }}
                      >
                        <div className="clip-handle" data-handle="start" />
                        {renderClipLabel(clip)}
                        <div className="clip-handle" data-handle="end" />
                      </div>
                    ))}
                    {dragPreview && dragPreview.kind === 'video' && draggedVideoClip && Math.abs(dragPreview.timelineStart - draggedVideoClip.timelineStart) > 0.001
                      ? renderGhostClip(
                        draggedVideoClip,
                        dragPreview.timelineStart * pixelsPerSecond,
                        Math.max(12, dragPreview.duration * pixelsPerSecond),
                      )
                      : null}
                  </div>

                  {audioTracks.map((track) => (
                    <div key={track.id} className="audio-track-block">
                      <div className="audio-track-bar">
                        <button
                          className={`track-chip ${selectedTrackId === track.id ? 'active' : ''}`}
                          type="button"
                          onClick={() => setSelectedTrackId(track.id)}
                        >
                          {track.name}
                        </button>
                        <label className="inline-field">
                          <span>一括 dB</span>
                          <input
                            type="number"
                            step={0.1}
                            min={-60}
                            max={12}
                            value={bulkValues[track.id] ?? '0'}
                            onChange={(event) => {
                              const value = event.target.value;
                              setBulkValues((current) => ({ ...current, [track.id]: value }));
                            }}
                          />
                        </label>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            const numeric = Number.parseFloat(bulkValues[track.id] ?? '0');
                            if (!Number.isFinite(numeric)) return;
                            setAudioTracks((tracks) => tracks.map((item) => {
                              if (item.id !== track.id) return item;
                              return { ...item, clips: applyTrackVolume(item.clips, numeric) };
                            }));
                          }}
                        >
                          一括適用
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          onClick={addAudioTrack}
                        >
                          音声トラック追加
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => deleteAudioTrack(track.id)}
                        >
                          {track.name}削除
                        </button>
                      </div>

                      <div
                        className={`track-lane audio-lane lane-drop-target ${dropTarget === `audio:${track.id}` ? 'lane-drop-active' : ''}`}
                        onDragOver={(event) => handleAudioDragOver(event, track.id)}
                        onDragEnter={(event) => handleAudioDragEnter(event, track.id)}
                        onDragLeave={(event) => handleDragLeave(event, `audio:${track.id}`)}
                        onDrop={(event) => handleAudioDrop(event, track.id)}
                      >
                        <div className="track-lane-inner">
                          <div className="lane-label">{track.name}</div>
                          <button className="lane-import-button" type="button" onClick={() => openAudioPicker(track.id)}>音声を追加</button>
                          {track.clips.length === 0 ? (
                            <div className="lane-empty-state">ここに音声をドロップ</div>
                          ) : null}
                        </div>
                        <div className="playhead" style={{ left: playhead * pixelsPerSecond }} />
                        {track.clips.map((clip) => {
                          const clipWidth = Math.max(12, clipDuration(clip) * pixelsPerSecond);
                          return (
                            <div
                              key={clip.id}
                              className={`clip-block audio-clip ${dragSession?.mode === 'move' && dragSession.kind === 'audio' && dragSession.clipId === clip.id ? 'clip-drag-source' : ''}`}
                              style={{ left: clip.timelineStart * pixelsPerSecond, width: clipWidth }}
                              onPointerDown={(event) => handleClipPointerDown('audio', clip.id, event, track.id)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setContextMenu({ clipId: clip.id, kind: 'audio', trackId: track.id, x: event.clientX, y: event.clientY });
                              }}
                            >
                              <RmsGraph
                                rmsGraph={deriveClipRmsGraph(clip, audioSourceRmsMap)}
                                width={clipWidth}
                                height={40}
                              />
                              <div className="clip-handle" data-handle="start" />
                              {renderClipLabel(clip)}
                              <div className="clip-handle" data-handle="end" />
                            </div>
                          );
                          })}
                          {dragPreview && dragPreview.kind === 'audio' && dragPreview.trackId === track.id && draggedAudioClip && Math.abs(dragPreview.timelineStart - draggedAudioClip.timelineStart) > 0.001
                            ? renderGhostClip(
                              draggedAudioClip,
                              dragPreview.timelineStart * pixelsPerSecond,
                              Math.max(12, dragPreview.duration * pixelsPerSecond),
                            )
                            : null}
                      </div>
                    </div>
                  ))}

                                    {/* ─── モザイクタイムライン ─── */}
                  <div className="mosaic-tracks-section">
                    <div className="audio-track-bar">
                      <button className="secondary" type="button" onClick={handleAddMosaicTrack}>
                        ＋モザイクトラック追加
                      </button>
                    </div>
                    <p className="mosaic-help-text">
                      各モザイク行名の右にある追加ボタンで区間を作成します。区間ブロックはドラッグで移動、端ドラッグで長さ調整、右クリックで分割・結合・削除できます。
                    </p>
                    {mosaicTracks.map((track) => (
                      <div key={track.id} className="audio-track-block">
                        <div className="audio-track-bar">
                          <span className="track-chip">{track.name}</span>
                          <button className="secondary" type="button" onClick={() => handleAddMosaicClip(track.id)}>
                            追加
                          </button>
                          <button className="secondary" type="button" onClick={() => handleDeleteMosaicTrack(track.id)}>
                            {`${track.name.replace(/\s+/g, '')}削除`}
                          </button>
                        </div>
                        <div className="track-lane mosaic-lane" style={{ position: 'relative', minHeight: 72 }} data-no-timeline-seek>
                          <div className="playhead" style={{ left: playhead * pixelsPerSecond }} />
                          {track.clips.map((clip) => {
                            const clipLeft = clip.timelineStart * pixelsPerSecond;
                            const clipWidth = Math.max(12, clip.duration * pixelsPerSecond);
                            const isSelected = clip.id === selectedMosaicClipId;
                            return (
                              <div
                                key={clip.id}
                                className={`clip-block video-clip mosaic-clip ${isSelected ? 'clip-selected' : ''}`}
                                style={{ left: clipLeft, width: clipWidth }}
                                onPointerDown={(event) => handleMosaicClipPointerDown(track.id, clip.id, event)}
                                onPointerMove={handleMosaicClipPointerMove}
                                onPointerUp={handleMosaicClipPointerUp}
                                onPointerCancel={handleMosaicClipPointerUp}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setContextMenu({ clipId: clip.id, kind: 'mosaic', trackId: track.id, x: event.clientX, y: event.clientY });
                                }}
                              >
                                <div className="clip-handle" data-handle="start" />
                                <div className="clip-label">
                                  <span>{track.name}</span>
                                  <small>{`${clip.duration.toFixed(2)}s`}</small>
                                </div>
                                <div className="clip-handle" data-handle="end" />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              </div>
            </section>

            <section className="log-card">
              <h2>エクスポートログ</h2>
              <p className="section-note">書き出し処理の進行状況と ffmpeg の出力を表示します。失敗時は最後の数行を見ると原因を追いやすくなります。</p>
              <div className="log-box">{exportLogs.length > 0 ? exportLogs.join('\n') : 'まだエクスポートしていません。'}</div>
            </section>
          </div>
        </section>
      </section>

      <div hidden>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleVideoFile(file);
            }
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
              void handleAudioFiles(files, audioPickerTrackIdRef.current);
            }
            event.currentTarget.value = '';
          }}
        />
        {flattenedAudioClips.map((clip) => (
          <audio
            key={clip.id}
            preload="auto"
            ref={(element) => {
              audioRefs.current[clip.id] = element;
            }}
          />
        ))}
      </div>

      {contextMenu && contextMenuClip ? (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: contextMenuPosition?.left ?? contextMenuMargin,
            top: contextMenuPosition?.top ?? contextMenuMargin,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="secondary" type="button" onClick={splitActiveClip}>再生ヘッドで分割</button>
          <button className="secondary" type="button" onClick={joinActiveClip} disabled={!canJoinMenuClip()}>隣接クリップを結合</button>

          <label className="field">
            <span>フェードイン秒</span>
            <input
              type="number"
              step={0.1}
              min={0}
              max={contextMenuMaxFade}
              value={contextMenuClip.fadeIn}
              onChange={(event) => updateMenuClip({ fadeIn: Number(event.target.value) })}
            />
          </label>

          <label className="field">
            <span>フェードアウト秒</span>
            <input
              type="number"
              step={0.1}
              min={0}
              max={contextMenuMaxFade}
              value={contextMenuClip.fadeOut}
              onChange={(event) => updateMenuClip({ fadeOut: Number(event.target.value) })}
            />
          </label>

          {contextMenu.kind === 'audio' ? (
            <label className="field">
              <span>音量 dB</span>
              <input
                type="number"
                step={0.1}
                min={-60}
                max={12}
                value={(contextMenuClip as AudioClip).volumeDb}
                onChange={(event) => updateMenuClip({ volumeDb: Number(event.target.value) })}
              />
            </label>
          ) : null}

          <button className="danger" type="button" onClick={removeActiveClip}>削除</button>
        </div>
      ) : null}

      {contextMenu && contextMenuMosaicClip ? (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: contextMenuPosition?.left ?? contextMenuMargin,
            top: contextMenuPosition?.top ?? contextMenuMargin,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="secondary" type="button" onClick={splitActiveClip}>再生ヘッドで分割</button>
          <button className="secondary" type="button" onClick={joinActiveClip} disabled={!canJoinMenuClip()}>隣接クリップを結合</button>
          <button className="danger" type="button" onClick={removeActiveClip}>削除</button>
        </div>
      ) : null}
    </main>
  );
}

export default App;








