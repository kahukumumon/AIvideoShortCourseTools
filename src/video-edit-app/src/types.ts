export type MediaKind = 'video' | 'audio';

export interface MediaSourceItem {
  id: string;
  kind: MediaKind;
  name: string;
  file: File;
  objectUrl: string;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  rmsGraph?: number[];
}

export interface ClipSegment {
  sourceId: string;
  sourceStart: number;
  sourceDuration: number;
  speed: number;
}

export interface BaseClip {
  id: string;
  sourceId: string;
  kind: MediaKind;
  timelineStart: number;
  sourceStart: number;
  sourceDuration: number;
  sourceMaxDuration: number;
  speed: number;
  trimIn?: number;
  trimOut?: number;
  fadeIn: number;
  fadeOut: number;
  segments?: ClipSegment[];
}

export interface VideoClip extends BaseClip {
  kind: 'video';
}

export interface AudioClip extends BaseClip {
  kind: 'audio';
  volumeDb: number;
  rmsGraph?: number[];  // 10ms ごと、-80dB～0dB 正規化の配列
}

export interface AudioTrack {
  id: string;
  name: string;
  clips: AudioClip[];
}

export interface EllipseMask {
  /** 楕円中心 X（0～1 の正規化座標） */
  cx: number;
  /** 楕円中心 Y（0～1 の正規化座標） */
  cy: number;
  /** 水平半径（0～1 の正規化値） */
  rx: number;
  /** 垂直半径（0～1 の正規化値） */
  ry: number;
  /** 回転角度（ラジアン） */
  angle: number;
}

export interface MosaicClip {
  id: string;
  /** タイムライン上の開始時刻（秒） */
  timelineStart: number;
  /** クリップの長さ（秒） */
  duration: number;
  mask: EllipseMask;
}

export interface MosaicTrack {
  id: string;
  name: string;
  clips: MosaicClip[];
}

export interface ContextMenuState {
  clipId: string;
  kind: MediaKind | 'mosaic';
  trackId?: string;
  x: number;
  y: number;
}

export interface ExportProgress {
  phase: string;
  ratio: number;
  message: string;
}
