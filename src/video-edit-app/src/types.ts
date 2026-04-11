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

export interface ContextMenuState {
  clipId: string;
  kind: MediaKind;
  trackId?: string;
  x: number;
  y: number;
}

export interface ExportProgress {
  phase: string;
  ratio: number;
  message: string;
}
