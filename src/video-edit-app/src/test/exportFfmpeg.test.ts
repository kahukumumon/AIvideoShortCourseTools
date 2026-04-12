import { describe, expect, it } from 'vitest';
import { collectExportSources } from '../lib/exportFfmpeg';
import type { MediaSourceItem } from '../types';

function makeSource(id: string, kind: 'video' | 'audio', name: string): MediaSourceItem {
  return {
    id,
    kind,
    name,
    file: {} as File,
    objectUrl: `blob:${id}`,
    duration: 1,
  };
}

describe('collectExportSources', () => {
  it('includes every video and audio source used by export', () => {
    const videoA = makeSource('video-a', 'video', 'video-a.mp4');
    const videoB = makeSource('video-b', 'video', 'video-b.mp4');
    const audioA = makeSource('audio-a', 'audio', 'audio-a.mp3');

    const sources = collectExportSources([videoA, videoB], [audioA]);

    expect(sources.map((source) => source.id)).toEqual(['video-a', 'video-b', 'audio-a']);
  });
});
