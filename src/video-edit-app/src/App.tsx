import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type {
  AudioClip,
  AudioTrack,
  ContextMenuState,
  ExportProgress,
  MediaSourceItem,
  VideoClip,
} from './types';
import { loadAudioSource, loadVideoSource } from './lib/media';
import { exportTimelineToMp4 } from './lib/exportFfmpeg';
import { computeRmsGraph } from './lib/rms';
import { RmsGraph } from './components/RmsGraph';
import {
  applyTrackVolume,
  canJoinPair,
  changeClipSpeed,
  clampFade,
  clampVolumeDb,
  clipDuration,
  clipEnd,
  dbToGain,
  deleteClip,
  formatTime,
  joinClipWithNext,
  moveClip,
  normalizeClips,
  resolveSegmentAtPlaytime,
  splitClip,
  totalTimelineDuration,
  trimClip,
} from './lib/timeline';

const PIXELS_PER_SECOND = 88;

type DragMode = 'move' | 'trim-start' | 'trim-end' | 'speed-start' | 'speed-end';
type FlattenedAudioClip = AudioClip & { trackId: string };
type DropTarget = 'video' | 'audio' | null;

function isVideoFile(file: File) {
  return file.type.startsWith('video/');
}

function isAudioFile(file: File) {
  return file.type.startsWith('audio/');
}

function hasDraggedFiles(dataTransfer: DataTransfer | null) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes('Files'));
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

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
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

  const timelineDuration = useMemo(() => {
    return totalTimelineDuration(videoClips, flattenedAudioClips);
  }, [flattenedAudioClips, videoClips]);

  const activeVideoClip = useMemo(() => {
    return videoClips.find((clip) => playhead >= clip.timelineStart && playhead < clipEnd(clip)) ?? null;
  }, [playhead, videoClips]);

  const contextMenuClip = useMemo(() => {
    if (!contextMenu) return null;
    if (contextMenu.kind === 'video') {
      return videoClips.find((clip) => clip.id === contextMenu.clipId) ?? null;
    }
    const track = audioTracks.find((item) => item.id === contextMenu.trackId);
    return track?.clips.find((clip) => clip.id === contextMenu.clipId) ?? null;
  }, [audioTracks, contextMenu, videoClips]);

  const contextMenuMaxFade = contextMenuClip ? clipDuration(contextMenuClip) / 2 : 0;

  useEffect(() => {
    if (!contextMenu || !contextMenuClip) {
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
  }, [contextMenu, contextMenuClip]);
  const timelineWidth = Math.max(12, Math.ceil(timelineDuration) + 1) * PIXELS_PER_SECOND;
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
        if (videoElement.src !== source.objectUrl) {
          videoElement.src = source.objectUrl;
        }
        const mediaElement = videoElement as HTMLVideoElement & {
          preservesPitch?: boolean;
          mozPreservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        mediaElement.playbackRate = resolution.seg.speed;
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
      mediaElement.playbackRate = resolution.seg.speed;
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

  async function handleAudioFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const targetTrackId = selectedTrackId || audioTracks[0]?.id;
    if (!targetTrackId || list.length === 0) return;

    try {
      setStatus('音声メタデータを解析しています。');
      
      // AudioContext を生成（RMS グラフ計算用）
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const loadedSources = await Promise.all(list.map((file) => loadAudioSource(file)));
      setAudioSources((current) => [...current, ...loadedSources]);
      
      // 各音声ファイルの RMS グラフを計算
      const rmsGraphs = await Promise.all(
        list.map((file) => computeRmsGraph(file, audioContext))
      );

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

  function handleAudioDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget('audio');
  }

  function handleAudioDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDropTarget('audio');
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

  function handleAudioDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setDropTarget(null);
    const files = collectFiles(event.dataTransfer.files).filter(isAudioFile);
    if (files.length === 0) {
      setStatus('音声ファイルをドロップしてください。');
      return;
    }
    void handleAudioFiles(files);
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
    };
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
    const next = Math.max(0, Math.min(maxTime, relativeX / PIXELS_PER_SECOND));
    stopPlaybackForSeek();
    setPlayhead(next);
  }

  function handleTimelinePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.clip-block')) return;

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
        videoSource: videoSources[0],
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

      const deltaSeconds = (event.clientX - drag.originX) / PIXELS_PER_SECOND;
      if (drag.kind === 'video') {
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

    const handlePointerUp = () => {
      dragRef.current = null;
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

  return (
    <main className="video-edit-page" onClick={() => setContextMenu(null)}>
      <div className="topbar">
        <a className="topbar-link" href="../..">トップへ戻る</a>
        <nav className="topbar-nav" aria-label="tools">
          <a className="topbar-link" href="../concat/">concat</a>
          <a className="topbar-link" href="../ugoira/">ugoira</a>
          <a className="topbar-link" href="../pixiv/">pixiv</a>
          <a className="topbar-link" href="../character/">character</a>
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

        <div className="editor-grid">
          <section className="editor-pane left-pane">
            <div className="stack">
              <label
                className={`dropzone ${dropTarget === 'video' ? 'dropzone-active' : ''}`}
                onDragOver={handleVideoDragOver}
                onDragEnter={handleVideoDragEnter}
                onDragLeave={(event) => handleDragLeave(event, 'video')}
                onDrop={handleVideoDrop}
              >
                <span>無音動画を追加</span>
                <small>クリックまたは動画ファイルをドロップ</small>
                <input
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
              </label>

              <div className="audio-import-row">
                <label
                  className={`dropzone compact-dropzone ${dropTarget === 'audio' ? 'dropzone-active' : ''}`}
                  onDragOver={handleAudioDragOver}
                  onDragEnter={handleAudioDragEnter}
                  onDragLeave={(event) => handleDragLeave(event, 'audio')}
                  onDrop={handleAudioDrop}
                >
                  <span>音声を追加</span>
                  <small>クリックまたは音声ファイルをドロップ</small>
                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={(event) => {
                      const files = event.target.files;
                      if (files && files.length > 0) {
                        void handleAudioFiles(files);
                      }
                      event.currentTarget.value = '';
                    }}
                  />
                </label>

                <div className="track-actions">
                  <label className="field small-field">
                    <span>追加先トラック</span>
                    <select value={selectedTrackId} onChange={(event) => setSelectedTrackId(event.target.value)}>
                      {audioTracks.map((track) => (
                        <option key={track.id} value={track.id}>{track.name}</option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      const next = createAudioTrack(audioTracks.length + 1);
                      setAudioTracks((tracks) => [...tracks, next]);
                      setSelectedTrackId(next.id);
                      setBulkValues((current) => ({ ...current, [next.id]: '0' }));
                    }}
                  >
                    音声トラック追加
                  </button>
                </div>
              </div>

              <section className="preview-card">
                <h2>プレビュー</h2>
                <div className="preview-frame" style={{ aspectRatio: previewAspectRatio }}>
                  {videoSources.length > 0 ? (
                    <>
                      <video ref={previewVideoRef} playsInline preload="auto" />
                      <div className="preview-fade" style={{ opacity: previewFade }} />
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
                  onPointerDown={handleTimelinePointerDown}
                  onPointerMove={handleTimelinePointerMove}
                  onPointerUp={handleTimelinePointerEnd}
                  onPointerCancel={handleTimelinePointerEnd}
                >
                  <div style={{ position: 'relative', width: timelineWidth }}>
                    <div className="timeline-ruler">
                      {Array.from({ length: Math.max(2, Math.ceil(timelineDuration) + 2) }).map((_, index) => (
                        <div
                          key={index}
                          className="ruler-tick"
                          style={{ left: index * PIXELS_PER_SECOND, width: PIXELS_PER_SECOND }}
                        >
                          {formatTime(index)}
                        </div>
                      ))}
                      <div className="playhead" style={{ left: playhead * PIXELS_PER_SECOND }}>
                        <div className="playhead-handle" />
                      </div>
                    </div>

                    <div className="track-lane video-lane">
                      <div className="lane-label">Video</div>
                      <div className="playhead" style={{ left: playhead * PIXELS_PER_SECOND }} />
                      {videoClips.map((clip) => (
                        <div
                          key={clip.id}
                          className="clip-block video-clip"
                          style={{ left: clip.timelineStart * PIXELS_PER_SECOND, width: Math.max(12, clipDuration(clip) * PIXELS_PER_SECOND) }}
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
                    </div>

                    {audioTracks.map((track) => (
                      <div key={track.id} className="audio-track-block">
                        <div className="audio-track-bar">
                          <span className={`track-chip ${selectedTrackId === track.id ? 'active' : ''}`}>{track.name}</span>
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
                        </div>

                        <div className="track-lane audio-lane">
                          <div className="lane-label">{track.name}</div>
                          <div className="playhead" style={{ left: playhead * PIXELS_PER_SECOND }} />
                          {track.clips.map((clip) => {
                            const clipWidth = Math.max(12, clipDuration(clip) * PIXELS_PER_SECOND);
                            return (
                              <div
                                key={clip.id}
                                className="clip-block audio-clip"
                                style={{ position: 'relative', left: clip.timelineStart * PIXELS_PER_SECOND, width: clipWidth }}
                                onPointerDown={(event) => handleClipPointerDown('audio', clip.id, event, track.id)}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  setContextMenu({ clipId: clip.id, kind: 'audio', trackId: track.id, x: event.clientX, y: event.clientY });
                                }}
                              >
                                {clip.rmsGraph && <RmsGraph rmsGraph={clip.rmsGraph} width={clipWidth} height={40} />}
                                <div className="clip-handle" data-handle="start" />
                                {renderClipLabel(clip)}
                                <div className="clip-handle" data-handle="end" />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </section>

          <aside className="editor-pane right-pane">
            <section className="log-card">
              <h2>編集メモ</h2>
              <ul className="plain-list">
                <li>動画トラックは 0 秒開始を維持します。</li>
                <li>音声はトラック内で重ならないように移動します。</li>
                <li>端ドラッグで速度変更、Shift + 端ドラッグでトリミングします。</li>
                <li>右クリックで再生ヘッド分割、結合、フェード、音量、削除を操作します。</li>
                <li>音量はトラック単位で一括 dB 適用できます。</li>
              </ul>
            </section>

            <section className="log-card">
              <h2>エクスポートログ</h2>
              <div className="log-box">{exportLogs.length > 0 ? exportLogs.join('\n') : 'まだエクスポートしていません。'}</div>
            </section>
          </aside>
        </div>
      </section>

      <div hidden>
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
    </main>
  );
}

export default App;
