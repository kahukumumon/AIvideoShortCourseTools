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

/**
 * クリップの再生時間（秒）を返す。
 * segments を持つ結合クリップは各セグメントの再生時間の合計を使用する。
 */
export function clipDuration(clip: BaseClip) {
  if (clip.segments && clip.segments.length > 0) {
    return roundTime(clip.segments.reduce((sum, seg) => sum + seg.sourceDuration / seg.speed, 0));
  }
  return roundTime(clip.sourceDuration / clip.speed);
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

// ─── segments 操作ヘルパー (内部使用) ────────────────────────────

/** segments の合計再生時間（秒） */
function segmentPlayDuration(segs: ClipSegment[]): number {
  return segs.reduce((sum, seg) => sum + seg.sourceDuration / seg.speed, 0);
}

/** 先頭から trimPlay 秒分を取り除いた segments を返す */
function trimSegmentsFromStart(segs: ClipSegment[], trimPlay: number): ClipSegment[] {
  const result: ClipSegment[] = [];
  let remaining = trimPlay;
  for (const seg of segs) {
    const segPlay = seg.sourceDuration / seg.speed;
    if (remaining <= 0) {
      result.push(seg);
    } else if (remaining >= segPlay - 1e-9) {
      remaining -= segPlay;
      // このセグメントは丸ごとスキップ
    } else {
      const trimSource = roundTime(remaining * seg.speed);
      result.push({
        ...seg,
        sourceStart: roundTime(seg.sourceStart + trimSource),
        sourceDuration: roundTime(seg.sourceDuration - trimSource),
      });
      remaining = 0;
    }
  }
  return result;
}

/** 末尾から trimPlay 秒分を取り除いた segments を返す */
function trimSegmentsFromEnd(segs: ClipSegment[], trimPlay: number): ClipSegment[] {
  const result: ClipSegment[] = [...segs];
  let remaining = trimPlay;
  for (let i = result.length - 1; i >= 0 && remaining > 0; i--) {
    const seg = result[i];
    const segPlay = seg.sourceDuration / seg.speed;
    if (remaining >= segPlay - 1e-9) {
      remaining -= segPlay;
      result.splice(i, 1);
    } else {
      const trimSource = roundTime(remaining * seg.speed);
      result[i] = { ...seg, sourceDuration: roundTime(seg.sourceDuration - trimSource) };
      remaining = 0;
    }
  }
  return result;
}

// ─── resolveSegmentAtPlaytime ─────────────────────────────────────

/** resolveSegmentAtPlaytime の戻り値型 */
export interface SegmentResolution {
  /** アクティブなセグメント（非 segments クリップは合成値） */
  seg: ClipSegment;
  /** segments 配列のインデックス。非 segments クリップは -1 */
  segIdx: number;
  /** 当該セグメント内での再生経過時間（秒） */
  segLocalTime: number;
}

/**
 * クリップ先頭からの localTime 秒時点でアクティブなセグメントと再生位置を解決する。
 * 非 segments クリップはクリップフィールドを合成して返す。
 */
export function resolveSegmentAtPlaytime(clip: BaseClip, localTime: number): SegmentResolution {
  if (!clip.segments || clip.segments.length === 0) {
    return {
      seg: {
        sourceId: clip.sourceId,
        sourceStart: clip.sourceStart,
        sourceDuration: clip.sourceDuration,
        speed: clip.speed,
      },
      segIdx: -1,
      segLocalTime: Math.max(0, localTime),
    };
  }
  let accumulated = 0;
  for (let i = 0; i < clip.segments.length; i++) {
    const seg = clip.segments[i];
    const segPlay = seg.sourceDuration / seg.speed;
    if (localTime < accumulated + segPlay || i === clip.segments.length - 1) {
      return { seg, segIdx: i, segLocalTime: Math.max(0, localTime - accumulated) };
    }
    accumulated += segPlay;
  }
  // フォールバック（到達しないはず）
  const last = clip.segments[clip.segments.length - 1];
  return { seg: last, segIdx: clip.segments.length - 1, segLocalTime: 0 };
}

// ─── trimClip ────────────────────────────────────────────────────

export function trimClip<T extends BaseClip>(clips: T[], clipId: string, side: 'start' | 'end', desiredEdge: number, kind: MediaKind) {
  const current = getClipById(clips, clipId);
  if (!current) return clips;
  const start = current.timelineStart;
  const end = clipEnd(current);
  const { previousEnd, nextStart } = getNeighborBounds(clips, clipId);

  let nextClip: T = current;

  if (current.segments && current.segments.length > 0) {
    // ── segments クリップ: segments 配列を直接操作 ──
    const segs = current.segments;
    if (side === 'start') {
      // 結合クリップは前方トリムのみ可（ソース素材が start より前にない）
      const minimumStart = Math.max(kind === 'video' ? 0 : previousEnd, start);
      const edge = clamp(desiredEdge, minimumStart, end - MIN_TIMELINE_SECONDS);
      const trimPlay = roundTime(edge - start);
      if (trimPlay <= 0) return clips;
      const newSegs = trimSegmentsFromStart(segs, trimPlay);
      if (newSegs.length === 0) return clips;
      const newPlayDuration = roundTime(segmentPlayDuration(newSegs));
      nextClip = {
        ...current,
        timelineStart: roundTime(edge),
        sourceStart: 0,
        sourceDuration: roundTime(newPlayDuration * current.speed),
        sourceMaxDuration: roundTime(newPlayDuration * current.speed),
        segments: newSegs,
      } as T;
    } else {
      // 結合クリップは後方トリムのみ可（延長不可）
      const maximumEnd = Math.min(nextStart, end);
      const edge = clamp(desiredEdge, start + MIN_TIMELINE_SECONDS, maximumEnd);
      const trimPlay = roundTime(end - edge);
      if (trimPlay <= 0) return clips;
      const newSegs = trimSegmentsFromEnd(segs, trimPlay);
      if (newSegs.length === 0) return clips;
      const newPlayDuration = roundTime(segmentPlayDuration(newSegs));
      nextClip = {
        ...current,
        sourceDuration: roundTime(newPlayDuration * current.speed),
        sourceMaxDuration: roundTime(newPlayDuration * current.speed),
        segments: newSegs,
      } as T;
    }
  } else {
    // ── 通常クリップ: 既存ロジック ──
    if (side === 'start') {
      const minimumStart = Math.max(kind === 'video' ? 0 : previousEnd, start - current.sourceStart / current.speed);
      const edge = clamp(desiredEdge, minimumStart, end - MIN_TIMELINE_SECONDS);
      const deltaTimeline = edge - start;
      const deltaSource = deltaTimeline * current.speed;
      nextClip = {
        ...current,
        timelineStart: roundTime(edge),
        sourceStart: roundTime(current.sourceStart + deltaSource),
        sourceDuration: roundTime(current.sourceDuration - deltaSource),
      } as T;
    } else {
      const maximumEnd = Math.min(nextStart, start + (current.sourceMaxDuration - current.sourceStart) / current.speed);
      const edge = clamp(desiredEdge, start + MIN_TIMELINE_SECONDS, maximumEnd);
      const deltaTimeline = edge - end;
      const deltaSource = deltaTimeline * current.speed;
      nextClip = {
        ...current,
        sourceDuration: roundTime(current.sourceDuration + deltaSource),
      } as T;
    }
  }

  nextClip = {
    ...nextClip,
    fadeIn: clampFade(nextClip.fadeIn, nextClip),
    fadeOut: clampFade(nextClip.fadeOut, nextClip),
  } as T;

  return normalizeClips(clips.map((clip) => (clip.id === clipId ? nextClip : clip))) as T[];
}

// ─── changeClipSpeed ──────────────────────────────────────────────

export function changeClipSpeed<T extends BaseClip>(clips: T[], clipId: string, side: 'start' | 'end', desiredEdge: number, kind: MediaKind) {
  const current = getClipById(clips, clipId);
  if (!current) return clips;
  const start = current.timelineStart;
  const end = clipEnd(current);
  const { previousEnd, nextStart } = getNeighborBounds(clips, clipId);
  const minStart = kind === 'video' ? 0 : previousEnd;
  let updated = current;

  if (side === 'end') {
    const boundedEnd = clamp(desiredEdge, start + MIN_TIMELINE_SECONDS, nextStart);
    const duration = boundedEnd - start;
    const speed = clamp(roundTime(current.sourceDuration / duration), MIN_SPEED, MAX_SPEED);
    updated = { ...current, speed } as T;
  } else {
    const boundedStart = clamp(desiredEdge, minStart, end - MIN_TIMELINE_SECONDS);
    const duration = end - boundedStart;
    const speed = clamp(roundTime(current.sourceDuration / duration), MIN_SPEED, MAX_SPEED);
    updated = { ...current, timelineStart: roundTime(end - current.sourceDuration / speed), speed } as T;
  }

  // segments クリップ: 各セグメント速度を比例更新し、sourceDuration を同期
  if (updated.segments && updated.segments.length > 0 && current.speed > 0) {
    const factor = updated.speed / current.speed;
    const scaledSegs = updated.segments.map((seg) => ({
      ...seg,
      speed: clamp(roundTime(seg.speed * factor), MIN_SPEED, MAX_SPEED),
    }));
    const actualPlayDuration = roundTime(segmentPlayDuration(scaledSegs));
    updated = {
      ...updated,
      segments: scaledSegs,
      sourceDuration: roundTime(actualPlayDuration * updated.speed),
      sourceMaxDuration: roundTime(actualPlayDuration * updated.speed),
    } as T;
  }

  updated = {
    ...updated,
    fadeIn: clampFade(updated.fadeIn, updated),
    fadeOut: clampFade(updated.fadeOut, updated),
  } as T;

  return normalizeClips(clips.map((clip) => (clip.id === clipId ? updated : clip))) as T[];
}

// ─── splitClip ───────────────────────────────────────────────────

export function splitClip<T extends BaseClip>(clips: T[], clipId: string, playhead: number) {
  const current = getClipById(clips, clipId);
  if (!current) return clips;
  const localStart = playhead - current.timelineStart;
  const duration = clipDuration(current);
  if (localStart <= MIN_TIMELINE_SECONDS || duration - localStart <= MIN_TIMELINE_SECONDS) {
    return clips;
  }

  if (current.segments && current.segments.length > 0) {
    // ── segments クリップ: playhead でセグメント配列を左右に分割 ──
    const leftSegs = trimSegmentsFromEnd(current.segments, roundTime(duration - localStart));
    const rightSegs = trimSegmentsFromStart(current.segments, roundTime(localStart));
    if (leftSegs.length === 0 || rightSegs.length === 0) return clips;

    const leftPlayDuration = roundTime(segmentPlayDuration(leftSegs));
    const rightPlayDuration = roundTime(segmentPlayDuration(rightSegs));

    const left = {
      ...current,
      segments: leftSegs,
      sourceDuration: roundTime(leftPlayDuration * current.speed),
      sourceMaxDuration: roundTime(leftPlayDuration * current.speed),
      fadeIn: clampFade(current.fadeIn, { ...current, sourceDuration: roundTime(leftPlayDuration * current.speed) }),
      fadeOut: 0,
    };
    const right = {
      ...current,
      id: crypto.randomUUID(),
      timelineStart: roundTime(playhead),
      sourceStart: 0,
      segments: rightSegs,
      sourceDuration: roundTime(rightPlayDuration * current.speed),
      sourceMaxDuration: roundTime(rightPlayDuration * current.speed),
      fadeIn: 0,
      fadeOut: clampFade(current.fadeOut, { ...current, sourceDuration: roundTime(rightPlayDuration * current.speed) }),
    };

    return normalizeClips(clips.flatMap((clip) => (clip.id === clipId ? [left as T, right as T] : [clip]))) as T[];
  }

  // ── 通常クリップ: 既存ロジック ──
  const leftSourceDuration = roundTime(localStart * current.speed);
  const rightSourceDuration = roundTime(current.sourceDuration - leftSourceDuration);
  const left = {
    ...current,
    sourceDuration: leftSourceDuration,
    fadeIn: clampFade(current.fadeIn, { ...current, sourceDuration: leftSourceDuration }),
    fadeOut: 0,
  };
  const right = {
    ...current,
    id: crypto.randomUUID(),
    timelineStart: roundTime(playhead),
    sourceStart: roundTime(current.sourceStart + leftSourceDuration),
    sourceDuration: rightSourceDuration,
    fadeIn: 0,
    fadeOut: clampFade(current.fadeOut, { ...current, sourceDuration: rightSourceDuration }),
  };

  return normalizeClips(clips.flatMap((clip) => (clip.id === clipId ? [left as T, right as T] : [clip]))) as T[];
}

// ─── その他ユーティリティ ─────────────────────────────────────────

export function mergeEditableValue<T extends number>(left: T, right: T, defaultValue: T) {
  if (left === defaultValue) return right;
  if (right === defaultValue) return left;
  return left;
}

// クリップのソースセグメントリストを返す（結合クリップはsegments、単一クリップは単要素配列）
function getClipSegments(clip: BaseClip): ClipSegment[] {
  if (clip.segments && clip.segments.length > 0) return clip.segments;
  return [{
    sourceId: clip.sourceId,
    sourceStart: clip.sourceStart,
    sourceDuration: clip.sourceDuration,
    speed: clip.speed,
  }];
}

/**
 * 結合可否判定。仕様：同一トラック内で隣接している同種クリップのみ結合可能。
 * sourceId・speed・ソース連続性は制約に含まない。
 */
export function canJoinPair<T extends BaseClip>(left: T, right: T) {
  if (left.kind !== right.kind) return false;
  return Math.abs(clipEnd(left) - right.timelineStart) <= 0.02;
}

/**
 * 結合処理。
 * - speed/fadeIn/fadeOut/volumeDb: どちらか一方が標準値ならもう一方、両方変更値なら時間的に早い方（left）を採用
 * - 結合クリップはセグメントリストを保持し、エクスポート・プレビューで正確に再生できる
 */
export function joinClipWithNext<T extends BaseClip>(clips: T[], clipId: string) {
  const sorted = normalizeClips(clips);
  const index = sorted.findIndex((clip) => clip.id === clipId);
  if (index === -1 || index === sorted.length - 1) return clips;
  const left = sorted[index];
  const right = sorted[index + 1];
  if (!canJoinPair(left, right)) return clips;

  const leftSegs = getClipSegments(left);
  const rightSegs = getClipSegments(right);
  const totalPlayDuration = roundTime(clipDuration(left) + clipDuration(right));
  const mergedSpeed = mergeEditableValue(left.speed, right.speed, 1 as number);
  const mergedSourceDuration = roundTime(totalPlayDuration * mergedSpeed);

  const mergedBase = {
    ...left,
    sourceStart: 0,
    sourceDuration: mergedSourceDuration,
    sourceMaxDuration: mergedSourceDuration,
    speed: mergedSpeed,
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
  return Math.max(
    0,
    ...videoClips.map((clip) => clipEnd(clip)),
    ...audioClips.map((clip) => clipEnd(clip)),
  );
}
