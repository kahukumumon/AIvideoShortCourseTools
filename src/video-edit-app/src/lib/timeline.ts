import type { AudioClip, BaseClip, ClipSegment, MediaKind, VideoClip } from '../types';

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const MIN_TIMELINE_SECONDS = 0.1;
export const MIN_VOLUME_DB = -60;
export const MAX_VOLUME_DB = 12;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function getTrimIn(clip: BaseClip) {
  return roundTime(clip.trimIn ?? 0);
}

function getTrimOut(clip: BaseClip) {
  return roundTime(clip.trimOut ?? 0);
}

function baseSegmentsForClip(clip: BaseClip): ClipSegment[] {
  if (clip.segments && clip.segments.length > 0) {
    return clip.segments.map((seg) => ({ ...seg }));
  }
  return [{
    sourceId: clip.sourceId,
    sourceStart: clip.sourceStart,
    sourceDuration: clip.sourceDuration,
    speed: 1,
  }];
}

function segmentBasePlayDuration(seg: ClipSegment) {
  return seg.sourceDuration / seg.speed;
}

function segmentPlayDuration(segs: ClipSegment[]) {
  return roundTime(segs.reduce((sum, seg) => sum + segmentBasePlayDuration(seg), 0));
}

function trimSegmentsFromStart(segs: ClipSegment[], trimPlay: number): ClipSegment[] {
  const result: ClipSegment[] = [];
  let remaining = roundTime(trimPlay);
  for (const seg of segs) {
    const segPlay = segmentBasePlayDuration(seg);
    if (remaining <= 0) {
      result.push({ ...seg });
      continue;
    }
    if (remaining >= segPlay - 1e-9) {
      remaining = roundTime(remaining - segPlay);
      continue;
    }
    const trimSource = roundTime(remaining * seg.speed);
    result.push({
      ...seg,
      sourceStart: roundTime(seg.sourceStart + trimSource),
      sourceDuration: roundTime(seg.sourceDuration - trimSource),
    });
    remaining = 0;
  }
  return result;
}

function trimSegmentsFromEnd(segs: ClipSegment[], trimPlay: number): ClipSegment[] {
  const result = segs.map((seg) => ({ ...seg }));
  let remaining = roundTime(trimPlay);
  for (let i = result.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const seg = result[i];
    const segPlay = segmentBasePlayDuration(seg);
    if (remaining >= segPlay - 1e-9) {
      remaining = roundTime(remaining - segPlay);
      result.splice(i, 1);
      continue;
    }
    const trimSource = roundTime(remaining * seg.speed);
    result[i] = {
      ...seg,
      sourceDuration: roundTime(seg.sourceDuration - trimSource),
    };
    remaining = 0;
  }
  return result;
}

function fullBaseDuration(clip: BaseClip) {
  return segmentPlayDuration(baseSegmentsForClip(clip));
}

export function getVisibleSegments(clip: BaseClip): ClipSegment[] {
  const full = baseSegmentsForClip(clip);
  const trimmedStart = trimSegmentsFromStart(full, getTrimIn(clip));
  return trimSegmentsFromEnd(trimmedStart, getTrimOut(clip));
}

function visibleBaseDuration(clip: BaseClip) {
  return roundTime(fullBaseDuration(clip) - getTrimIn(clip) - getTrimOut(clip));
}

/**
 * クリップの再生時間（秒）を返す。
 * trim は表示上の編集状態として保持し、実処理は再生/エクスポート時に解決する。
 */
export function clipDuration(clip: BaseClip) {
  return roundTime(visibleBaseDuration(clip) / clip.speed);
}

export function clipEnd(clip: BaseClip) {
  return roundTime(clip.timelineStart + clipDuration(clip));
}

export function clampFade(value: number, clip: BaseClip) {
  return clamp(roundTime(value), 0, clipDuration(clip) / 2);
}

export function clampVolumeDb(value: number) {
  return clamp(Math.round(value * 10) / 10, MIN_VOLUME_DB, MAX_VOLUME_DB);
}

export function dbToGain(value: number) {
  return Math.pow(10, clampVolumeDb(value) / 20);
}

export function formatTime(value: number) {
  const safe = Math.max(0, value || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

export function normalizeClips<T extends BaseClip>(clips: T[]) {
  return [...clips].sort((left, right) => left.timelineStart - right.timelineStart);
}

export function getClipById<T extends BaseClip>(clips: T[], clipId: string) {
  return clips.find((clip) => clip.id === clipId);
}

export function getNeighborBounds<T extends BaseClip>(clips: T[], clipId: string) {
  const sorted = normalizeClips(clips);
  const index = sorted.findIndex((clip) => clip.id === clipId);
  if (index === -1) {
    return { previousEnd: 0, nextStart: Number.POSITIVE_INFINITY };
  }
  return {
    previousEnd: index > 0 ? clipEnd(sorted[index - 1]) : 0,
    nextStart: index < sorted.length - 1 ? sorted[index + 1].timelineStart : Number.POSITIVE_INFINITY,
  };
}

export function moveClip<T extends BaseClip>(clips: T[], clipId: string, desiredStart: number, kind: MediaKind) {
  const current = getClipById(clips, clipId);
  if (!current) return clips;
  const duration = clipDuration(current);
  const { previousEnd, nextStart } = getNeighborBounds(clips, clipId);
  const minStart = kind === 'video' ? Math.max(0, previousEnd) : previousEnd;
  const maxStart = Number.isFinite(nextStart) ? nextStart - duration : Number.POSITIVE_INFINITY;
  const boundedStart = roundTime(clamp(desiredStart, minStart, Math.max(minStart, maxStart)));
  const updated = clips.map((clip) => (clip.id === clipId ? { ...clip, timelineStart: boundedStart } : clip));
  if (kind === 'video') {
    const sorted = normalizeClips(updated);
    if (sorted.length > 0 && sorted[0].timelineStart !== 0) {
      const shift = sorted[0].timelineStart;
      return sorted.map((clip) => ({ ...clip, timelineStart: roundTime(clip.timelineStart - shift) })) as T[];
    }
  }
  return normalizeClips(updated) as T[];
}

export interface SegmentResolution {
  seg: ClipSegment;
  segIdx: number;
  segLocalTime: number;
  effectiveSpeed: number;
}

/**
 * localTime はタイムライン上のクリップ内時刻。
 * trim と clip.speed を解決し、実ソース位置へ変換する。
 */
export function resolveSegmentAtPlaytime(clip: BaseClip, localTime: number): SegmentResolution {
  const segs = baseSegmentsForClip(clip);
  const baseTime = roundTime(getTrimIn(clip) + Math.max(0, localTime) * clip.speed);
  let accumulated = 0;
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    const segPlay = segmentBasePlayDuration(seg);
    if (baseTime < accumulated + segPlay || i === segs.length - 1) {
      return {
        seg,
        segIdx: clip.segments && clip.segments.length > 0 ? i : -1,
        segLocalTime: Math.max(0, baseTime - accumulated),
        effectiveSpeed: roundTime(seg.speed * clip.speed),
      };
    }
    accumulated = roundTime(accumulated + segPlay);
  }
  const last = segs[segs.length - 1];
  return {
    seg: last,
    segIdx: clip.segments && clip.segments.length > 0 ? segs.length - 1 : -1,
    segLocalTime: 0,
    effectiveSpeed: roundTime(last.speed * clip.speed),
  };
}

export function trimClip<T extends BaseClip>(clips: T[], clipId: string, side: 'start' | 'end', desiredEdge: number, kind: MediaKind) {
  const current = getClipById(clips, clipId);
  if (!current) return clips;
  const start = current.timelineStart;
  const end = clipEnd(current);
  const { previousEnd, nextStart } = getNeighborBounds(clips, clipId);
  const currentTrimIn = getTrimIn(current);
  const currentTrimOut = getTrimOut(current);
  const fullDuration = fullBaseDuration(current);

  let nextClip = current;

  if (side === 'start') {
    const minimumStart = Math.max(kind === 'video' ? 0 : previousEnd, start - currentTrimIn / current.speed);
    const edge = clamp(desiredEdge, minimumStart, end - MIN_TIMELINE_SECONDS);
    const deltaTimeline = roundTime(edge - start);
    nextClip = {
      ...current,
      timelineStart: roundTime(edge),
      trimIn: roundTime(currentTrimIn + deltaTimeline * current.speed),
    } as T;
  } else {
    const maximumEnd = Math.min(nextStart, end + currentTrimOut / current.speed);
    const edge = clamp(desiredEdge, start + MIN_TIMELINE_SECONDS, maximumEnd);
    const nextTrimOut = roundTime(currentTrimOut + (end - edge) * current.speed);
    nextClip = {
      ...current,
      trimOut: clamp(nextTrimOut, 0, fullDuration),
    } as T;
  }

  nextClip = {
    ...nextClip,
    trimIn: clamp(getTrimIn(nextClip), 0, fullDuration - MIN_TIMELINE_SECONDS * nextClip.speed),
    trimOut: clamp(getTrimOut(nextClip), 0, fullDuration - getTrimIn(nextClip) - MIN_TIMELINE_SECONDS * nextClip.speed),
  } as T;

  nextClip = {
    ...nextClip,
    fadeIn: clampFade(nextClip.fadeIn, nextClip),
    fadeOut: clampFade(nextClip.fadeOut, nextClip),
  } as T;

  return normalizeClips(clips.map((clip) => (clip.id === clipId ? nextClip : clip))) as T[];
}

export function changeClipSpeed<T extends BaseClip>(clips: T[], clipId: string, side: 'start' | 'end', desiredEdge: number, kind: MediaKind) {
  const current = getClipById(clips, clipId);
  if (!current) return clips;
  const start = current.timelineStart;
  const end = clipEnd(current);
  const baseDuration = visibleBaseDuration(current);
  const { previousEnd, nextStart } = getNeighborBounds(clips, clipId);
  const minStart = kind === 'video' ? 0 : previousEnd;
  let updated = current;

  if (side === 'end') {
    const boundedEnd = clamp(desiredEdge, start + MIN_TIMELINE_SECONDS, nextStart);
    const duration = boundedEnd - start;
    const speed = clamp(roundTime(baseDuration / duration), MIN_SPEED, MAX_SPEED);
    updated = { ...current, speed } as T;
  } else {
    const boundedStart = clamp(desiredEdge, minStart, end - MIN_TIMELINE_SECONDS);
    const duration = end - boundedStart;
    const speed = clamp(roundTime(baseDuration / duration), MIN_SPEED, MAX_SPEED);
    updated = { ...current, timelineStart: roundTime(end - baseDuration / speed), speed } as T;
  }

  updated = {
    ...updated,
    fadeIn: clampFade(updated.fadeIn, updated),
    fadeOut: clampFade(updated.fadeOut, updated),
  } as T;

  return normalizeClips(clips.map((clip) => (clip.id === clipId ? updated : clip))) as T[];
}

export function splitClip<T extends BaseClip>(clips: T[], clipId: string, playhead: number) {
  const current = getClipById(clips, clipId);
  if (!current) return clips;
  const localStart = roundTime(playhead - current.timelineStart);
  const duration = clipDuration(current);
  if (localStart <= MIN_TIMELINE_SECONDS || duration - localStart <= MIN_TIMELINE_SECONDS) {
    return clips;
  }

  const splitBase = roundTime(getTrimIn(current) + localStart * current.speed);
  const fullDuration = fullBaseDuration(current);

  const left = {
    ...current,
    trimOut: roundTime(fullDuration - splitBase),
    fadeIn: clampFade(current.fadeIn, { ...current, trimOut: roundTime(fullDuration - splitBase) }),
    fadeOut: 0,
  };

  const right = {
    ...current,
    id: crypto.randomUUID(),
    timelineStart: roundTime(playhead),
    trimIn: splitBase,
    fadeIn: 0,
    fadeOut: clampFade(current.fadeOut, { ...current, trimIn: splitBase }),
  };

  return normalizeClips(clips.flatMap((clip) => (clip.id === clipId ? [left as T, right as T] : [clip]))) as T[];
}

export function mergeEditableValue<T extends number>(left: T, right: T, defaultValue: T) {
  if (left === defaultValue) return right;
  if (right === defaultValue) return left;
  return left;
}

function getVisibleSegmentsWithClipSpeed(clip: BaseClip): ClipSegment[] {
  return getVisibleSegments(clip).map((seg) => ({
    ...seg,
    speed: roundTime(seg.speed * clip.speed),
  }));
}

/**
 * 結合処理。
 * 再生結果を保つため、各クリップの可視区間を segments 化して保持する。
 */
export function canJoinPair<T extends BaseClip>(left: T, right: T) {
  if (left.kind !== right.kind) return false;
  return Math.abs(clipEnd(left) - right.timelineStart) <= 0.02;
}

export function joinClipWithNext<T extends BaseClip>(clips: T[], clipId: string) {
  const sorted = normalizeClips(clips);
  const index = sorted.findIndex((clip) => clip.id === clipId);
  if (index === -1 || index === sorted.length - 1) return clips;
  const left = sorted[index];
  const right = sorted[index + 1];
  if (!canJoinPair(left, right)) return clips;

  const mergedSpeed = mergeEditableValue(left.speed, right.speed, 1 as number);
  const leftSegs = getVisibleSegmentsWithClipSpeed(left).map((seg) => ({ ...seg, speed: seg.speed / mergedSpeed }));
  const rightSegs = getVisibleSegmentsWithClipSpeed(right).map((seg) => ({ ...seg, speed: seg.speed / mergedSpeed }));
  const mergedBaseDuration = roundTime(
    [...leftSegs, ...rightSegs].reduce((sum, seg) => sum + seg.sourceDuration / seg.speed, 0),
  );

  const mergedBase = {
    ...left,
    sourceStart: 0,
    sourceDuration: roundTime(mergedBaseDuration),
    sourceMaxDuration: roundTime(mergedBaseDuration),
    speed: mergedSpeed,
    trimIn: 0,
    trimOut: 0,
    segments: [...leftSegs, ...rightSegs],
    fadeIn: mergeEditableValue(left.fadeIn, right.fadeIn, 0 as number),
    fadeOut: mergeEditableValue(left.fadeOut, right.fadeOut, 0 as number),
  };

  const merged = left.kind === 'audio'
    ? {
        ...mergedBase,
        volumeDb: mergeEditableValue((left as AudioClip).volumeDb, (right as AudioClip).volumeDb, 0 as number),
      }
    : mergedBase;

  return sorted
    .filter((clip) => clip.id !== right.id)
    .map((clip) => (clip.id === left.id ? merged as T : clip)) as T[];
}

export function deleteClip<T extends BaseClip>(clips: T[], clipId: string) {
  return clips.filter((clip) => clip.id !== clipId);
}

export function applyTrackVolume(clips: AudioClip[], volumeDb: number) {
  return clips.map((clip) => ({ ...clip, volumeDb: clampVolumeDb(volumeDb) }));
}

export function totalTimelineDuration(videoClips: VideoClip[], audioClips: AudioClip[]) {
  if (videoClips.length > 0) {
    return Math.max(0, ...videoClips.map((clip) => clipEnd(clip)));
  }
  return Math.max(0, ...audioClips.map((clip) => clipEnd(clip)));
}
