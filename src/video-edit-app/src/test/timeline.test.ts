import { describe, expect, it } from 'vitest';
import { applyTrackVolume, canJoinPair, changeClipSpeed, clipDuration, clipEnd, joinClipWithNext, moveClip, resolveSegmentAtPlaytime, splitClip, trimClip } from '../lib/timeline';
import type { AudioClip, VideoClip } from '../types';

const videoA: VideoClip = {
  id: 'v1',
  sourceId: 'src-v',
  kind: 'video',
  timelineStart: 0,
  sourceStart: 0,
  sourceDuration: 8,
  sourceMaxDuration: 8,
  speed: 1,
  fadeIn: 0,
  fadeOut: 0,
};

const audioA: AudioClip = {
  id: 'a1',
  sourceId: 'src-a',
  kind: 'audio',
  timelineStart: 0,
  sourceStart: 0,
  sourceDuration: 4,
  sourceMaxDuration: 8,
  speed: 1,
  fadeIn: 0,
  fadeOut: 0,
  volumeDb: 0,
};

const audioB: AudioClip = {
  ...audioA,
  id: 'a2',
  timelineStart: 4,
  sourceStart: 4,
};

describe('timeline helpers', () => {
  it('moves audio clips without overlap', () => {
    const moved = moveClip([audioA, audioB], 'a2', 2, 'audio');
    expect(moved[1].timelineStart).toBe(4);
  });

  it('keeps first video clip at zero', () => {
    const moved = moveClip([videoA], 'v1', 3, 'video');
    expect(moved[0].timelineStart).toBe(0);
  });

  it('splits at playhead', () => {
    const result = splitClip([audioA], 'a1', 1.5);
    expect(result).toHaveLength(2);
    expect(clipEnd(result[0])).toBe(1.5);
    expect(result[1].timelineStart).toBe(1.5);
  });

  it('changes speed by edge drag', () => {
    const result = changeClipSpeed([audioA], 'a1', 'end', 2, 'audio');
    expect(result[0].speed).toBe(2);
    expect(clipDuration(result[0])).toBe(2);
  });

  it('joins adjacent same-source clips', () => {
    expect(canJoinPair(audioA, audioB)).toBe(true);
    const joined = joinClipWithNext([audioA, audioB], 'a1');
    expect(joined).toHaveLength(1);
    expect(joined[0].sourceDuration).toBe(8);
  });

  it('applies track volume in bulk', () => {
    const result = applyTrackVolume([audioA, audioB], -9);
    expect(result.every((clip) => clip.volumeDb === -9)).toBe(true);
  });
});

// ─── 結合仕様のカバレッジテスト ────────────────────────────────

describe('canJoinPair: 隣接判定のみ（sourceId・speed は不問）', () => {
  it('異なる sourceId でも隣接していれば結合可', () => {
    const audioDiffSrc: AudioClip = {
      ...audioA,
      id: 'diff-src',
      sourceId: 'src-b',    // 別ソース
      timelineStart: 4,     // audioA 終端 = 4
    };
    expect(canJoinPair(audioA, audioDiffSrc)).toBe(true);
  });

  it('異なる speed でも隣接していれば結合可', () => {
    // audioFast: speed=2, sourceDuration=4 → plays 2s (ends at t=2)
    const audioFast: AudioClip = { ...audioA, id: 'fast', speed: 2 };
    // audioAfter: starts at t=2
    const audioAfter: AudioClip = { ...audioA, id: 'after', timelineStart: 2, sourceStart: 4, speed: 3 };
    expect(canJoinPair(audioFast, audioAfter)).toBe(true);
  });

  it('隣接していないクリップは結合不可', () => {
    const audioFar: AudioClip = { ...audioA, id: 'far', timelineStart: 10 };
    expect(canJoinPair(audioA, audioFar)).toBe(false);
  });

  it('異なる kind は結合不可', () => {
    const videoClip: VideoClip = { ...videoA, timelineStart: 8 };
    // audioA.kind='audio', videoClip.kind='video'
    expect(canJoinPair(audioA as unknown as VideoClip, videoClip)).toBe(false);
  });
});

describe('joinClipWithNext: speed 統合ルール', () => {
  it('一方が標準値(1)ならもう一方の変更値を採用する', () => {
    // left.speed=1(標準), right.speed=2(変更) → merged=2
    const audioNormal: AudioClip = { ...audioA, id: 'normal', speed: 1 };
    const audioFast: AudioClip = { ...audioA, id: 'fast', timelineStart: 4, sourceStart: 4, speed: 2 };
    const joined = joinClipWithNext([audioNormal, audioFast], 'normal');
    expect(joined[0].speed).toBe(2);
  });

  it('両方が変更値なら時間的に早いほう(left)を採用する', () => {
    // left.speed=2, right.speed=3 → merged=2 (leftが時間的に早い)
    const audioFast2: AudioClip = { ...audioA, id: 'f2', speed: 2 };           // ends at t=2
    const audioFast3: AudioClip = { ...audioA, id: 'f3', timelineStart: 2, sourceStart: 4, speed: 3 };
    const joined = joinClipWithNext([audioFast2, audioFast3], 'f2');
    expect(joined[0].speed).toBe(2);
  });

  it('両方が標準値(1)なら標準値(1)を維持する', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1');
    expect(joined[0].speed).toBe(1);
  });
});

describe('joinClipWithNext: volume/fade 統合ルール', () => {
  it('volume: 一方が標準値(0)ならもう一方の変更値を採用する', () => {
    const audioLoud: AudioClip = { ...audioA, id: 'loud', volumeDb: -6 };
    const audioNormVol: AudioClip = { ...audioB, volumeDb: 0 };
    const joined = joinClipWithNext([audioLoud, audioNormVol], 'loud');
    expect((joined[0] as AudioClip).volumeDb).toBe(-6);
  });

  it('volume: 両方が変更値なら時間的に早いほう(left)を採用する', () => {
    const audioLeft: AudioClip = { ...audioA, id: 'vl', volumeDb: -6 };
    const audioRight: AudioClip = { ...audioB, id: 'vr', volumeDb: -12 };
    const joined = joinClipWithNext([audioLeft, audioRight], 'vl');
    expect((joined[0] as AudioClip).volumeDb).toBe(-6);
  });

  it('fadeIn: 一方が標準値(0)ならもう一方の変更値を採用する', () => {
    const audioFI: AudioClip = { ...audioA, id: 'fi', fadeIn: 0.5 };
    const audioNext: AudioClip = { ...audioB, fadeIn: 0 };
    const joined = joinClipWithNext([audioFI, audioNext], 'fi');
    expect(joined[0].fadeIn).toBe(0.5);
  });

  it('fadeOut: 両方が変更値なら時間的に早いほう(left)を採用する', () => {
    const audioFO1: AudioClip = { ...audioA, id: 'fo1', fadeOut: 0.5 };
    const audioFO2: AudioClip = { ...audioB, id: 'fo2', fadeOut: 1.0 };
    const joined = joinClipWithNext([audioFO1, audioFO2], 'fo1');
    expect(joined[0].fadeOut).toBe(0.5);
  });
});

describe('joinClipWithNext: 異なる source の結合', () => {
  it('異なる source でも隣接音声クリップを結合し segments を持つ', () => {
    const audioDiffSrc: AudioClip = {
      ...audioA,
      id: 'diff',
      sourceId: 'src-b',
      timelineStart: 4,
      sourceStart: 0,
    };
    const joined = joinClipWithNext([audioA, audioDiffSrc], 'a1');
    expect(joined).toHaveLength(1);
    const segs = joined[0].segments;
    expect(segs).toBeDefined();
    expect(segs).toHaveLength(2);
    expect(segs![0].sourceId).toBe('src-a');
    expect(segs![1].sourceId).toBe('src-b');
  });

  it('結合後クリップの clipDuration は両クリップの再生時間の合計と一致する', () => {
    const audioDiffSrc: AudioClip = {
      ...audioA,
      id: 'diff2',
      sourceId: 'src-b',
      timelineStart: 4,
      sourceStart: 0,
      sourceDuration: 3,
    };
    const joined = joinClipWithNext([audioA, audioDiffSrc], 'a1');
    // audioA plays 4s, audioDiffSrc plays 3s → total 7s
    expect(clipDuration(joined[0])).toBe(7);
  });
});

describe('changeClipSpeed: セグメント速度の比例更新', () => {
  it('結合クリップの速度変更時に各セグメントの速度も比例して更新される', () => {
    // まず 2 クリップを結合して merged speed=1 の segmented clip を作る
    const joined = joinClipWithNext([audioA, audioB], 'a1');
    expect(joined[0].segments).toHaveLength(2);
    // 速度を 2 に変更
    const sped = changeClipSpeed(joined as AudioClip[], joined[0].id, 'end', clipDuration(joined[0]) / 2, 'audio');
    const segs = sped[0].segments!;
    // 全セグメントが factor=2 倍の速度になること
    expect(segs[0].speed).toBe(2);
    expect(segs[1].speed).toBe(2);
  });
});


// ─── clipDuration: segments 対応 ────────────────────────────────────────

describe('clipDuration: segments 対応', () => {
  it('単一クリップは sourceDuration/speed を使用する', () => {
    expect(clipDuration(audioA)).toBe(4);
  });

  it('segments クリップは各セグメントの合計を返す', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1');
    expect(clipDuration(joined[0])).toBe(8);
  });

  it('速度の異なる segments の合計を正しく計算する', () => {
    // audioFast: speed=2, sourceDuration=4 -> plays 2s
    // audioSlow: speed=0.5, sourceDuration=4 -> plays 8s, starts at t=2
    const audioFast: AudioClip = { ...audioA, id: 'fast', speed: 2 };
    const audioSlow: AudioClip = { ...audioA, id: 'slow', timelineStart: 2, sourceStart: 4, speed: 0.5 };
    const joined = joinClipWithNext([audioFast, audioSlow], 'fast');
    expect(clipDuration(joined[0])).toBe(10);
  });
});

// ─── resolveSegmentAtPlaytime ────────────────────────────────────

describe('resolveSegmentAtPlaytime', () => {
  it('非-segments クリップはクリップフィールドを返す (segIdx=-1)', () => {
    const r = resolveSegmentAtPlaytime(audioA, 2);
    expect(r.segIdx).toBe(-1);
    expect(r.seg.sourceId).toBe('src-a');
    expect(r.segLocalTime).toBe(2);
  });

  it('先頭セグメント内の時刻は segIdx=0 を返す', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1');
    const r = resolveSegmentAtPlaytime(joined[0], 2);
    expect(r.segIdx).toBe(0);
    expect(r.seg.sourceStart).toBe(0);
    expect(r.segLocalTime).toBe(2);
  });

  it('2 番目セグメント内の時刻は segIdx=1 を返す', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1');
    const r = resolveSegmentAtPlaytime(joined[0], 5);
    expect(r.segIdx).toBe(1);
    expect(r.segLocalTime).toBe(1); // 5 - 4 = 1
  });

  it('セグメント境界直後 (localTime=4) は 2 番目セグメントに割り当てる', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1');
    const r = resolveSegmentAtPlaytime(joined[0], 4);
    expect(r.segIdx).toBe(1);
    expect(r.segLocalTime).toBe(0);
  });
});

// ─── trimClip: segments クリップのトリミング ─────────────────────────────────

describe('trimClip: segments サポート', () => {
  it('先頭トリム: 先頭セグメントの先頭を削る', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1')[0] as AudioClip;
    // 8s クリップ: t=2 にトリム (先頭 2s を削除)
    const result = trimClip([joined], joined.id, 'start', 2, 'audio') as AudioClip[];
    expect(result[0].timelineStart).toBe(2);
    expect(clipDuration(result[0])).toBeCloseTo(6, 3);
    const segs = result[0].segments!;
    expect(segs).toHaveLength(2);
    expect(segs[0].sourceStart).toBe(2); // 2s * speed1 = 2
    expect(segs[0].sourceDuration).toBe(2);
  });

  it('先頭トリム: 先頭セグメント全体を超えるトリムは先頭セグメントを削除する', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1')[0] as AudioClip;
    const result = trimClip([joined], joined.id, 'start', 4.5, 'audio') as AudioClip[];
    const segs = result[0].segments!;
    expect(segs).toHaveLength(1);
    expect(result[0].timelineStart).toBe(4.5);
    expect(clipDuration(result[0])).toBeCloseTo(3.5, 3);
  });

  it('末尾トリム: 最後セグメントの末尾を削る', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1')[0] as AudioClip;
    // 8s クリップ: t=6 にトリム (末尾 2s を削除)
    const result = trimClip([joined], joined.id, 'end', 6, 'audio') as AudioClip[];
    expect(clipDuration(result[0])).toBeCloseTo(6, 3);
    const segs = result[0].segments!;
    expect(segs).toHaveLength(2);
    expect(segs[segs.length - 1].sourceDuration).toBe(2);
  });

  it('末尾トリム: 最後セグメント全体を超えるトリムは最後セグメントを削除する', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1')[0] as AudioClip;
    const result = trimClip([joined], joined.id, 'end', 3.5, 'audio') as AudioClip[];
    expect(result[0].segments!).toHaveLength(1);
    expect(clipDuration(result[0])).toBeCloseTo(3.5, 3);
  });
});

// ─── splitClip: segments クリップの分割 ────────────────────────────────

describe('splitClip: segments サポート', () => {
  it('先頭セグメント内で分割: 左に 1 セグ、右に 2 セグ', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1')[0] as AudioClip;
    const result = splitClip([joined], joined.id, 2) as AudioClip[];
    expect(result).toHaveLength(2);
    expect(clipDuration(result[0])).toBeCloseTo(2, 3);
    expect(clipDuration(result[1])).toBeCloseTo(6, 3);
    expect(result[1].timelineStart).toBe(2);
    expect(result[0].segments!).toHaveLength(1);
    expect(result[1].segments!).toHaveLength(2);
  });

  it('セグメント境界で分割: 左右それぞれ 1 セグ', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1')[0] as AudioClip;
    const result = splitClip([joined], joined.id, 4) as AudioClip[];
    expect(result).toHaveLength(2);
    expect(clipDuration(result[0])).toBeCloseTo(4, 3);
    expect(clipDuration(result[1])).toBeCloseTo(4, 3);
  });

  it('2 番目セグメント内で分割: 右に別ソースの単一セグ', () => {
    const audioDiff: AudioClip = { ...audioA, id: 'diff', sourceId: 'src-b', timelineStart: 4, sourceStart: 0 };
    const joined = joinClipWithNext([audioA, audioDiff], 'a1')[0] as AudioClip;
    // t=5 で分割 (2 番目セグの 1s 目)
    const result = splitClip([joined], joined.id, 5) as AudioClip[];
    expect(result).toHaveLength(2);
    const right = result[1];
    expect(right.segments!).toHaveLength(1);
    expect(right.segments![0].sourceId).toBe('src-b');
    expect(right.segments![0].sourceStart).toBe(1); // 1s trimmed from front of seg2
  });

  it('分割後の左右の clipDuration の合計は元の合計と一致する', () => {
    const joined = joinClipWithNext([audioA, audioB], 'a1')[0] as AudioClip;
    const originalDuration = clipDuration(joined);
    const result = splitClip([joined], joined.id, 3) as AudioClip[];
    expect(result).toHaveLength(2);
    const total = clipDuration(result[0]) + clipDuration(result[1]);
    expect(total).toBeCloseTo(originalDuration, 3);
  });
});

// ─── 複数動画クリップの重複判定 ────────────────────────────────

describe('複数動画クリップの重複禁止ロジック', () => {
  it('複数の動画クリップを時系列に配置できる', () => {
    const video1: VideoClip = { ...videoA, id: 'v1', timelineStart: 0, sourceDuration: 4 };
    const video2: VideoClip = { ...videoA, id: 'v2', timelineStart: 4, sourceDuration: 3 };
    const video3: VideoClip = { ...videoA, id: 'v3', timelineStart: 7, sourceDuration: 2 };
    const clips = [video1, video2, video3];
    
    // 各クリップの終端が正しく計算されること
    expect(clipEnd(clips[0])).toBe(4);
    expect(clipEnd(clips[1])).toBe(7);
    expect(clipEnd(clips[2])).toBe(9);
  });

  it('複数動画クリップの最後のクリップの終端が全タイムラインの終了時刻', () => {
    const clips: VideoClip[] = [
      { ...videoA, id: 'v1', timelineStart: 0, sourceDuration: 4 },
      { ...videoA, id: 'v2', timelineStart: 4, sourceDuration: 3 },
      { ...videoA, id: 'v3', timelineStart: 7, sourceDuration: 2 },
    ];
    const allAudioClips: AudioClip[] = [
      { ...audioA, id: 'a1', timelineStart: 0, sourceDuration: 5 },
    ];
    
    // 複数動画 + 音声から全期間を計算できること
    const duration = Math.max(
      clips.length > 0 ? Math.max(...clips.map(clipEnd)) : 0,
      allAudioClips.length > 0 ? Math.max(...allAudioClips.map(clipEnd)) : 0
    );
    expect(duration).toBe(9);
  });

  it('複数動画クリップの移動時に、タイムラインの先頭（t=0）を超えないこと', () => {
    const video1: VideoClip = { ...videoA, id: 'v1', timelineStart: 2, sourceDuration: 4 };
    const moved = moveClip([video1], 'v1', -1, 'video');
    // 動画クリップは常に t=0 開始を維持する
    expect(moved[0].timelineStart).toBe(0);
  });
});
