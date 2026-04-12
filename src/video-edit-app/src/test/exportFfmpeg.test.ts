import { describe, expect, it } from 'vitest';
import { buildMosaicFilters, collectExportSources } from '../lib/exportFfmpeg';
import type { MediaSourceItem, MosaicTrack } from '../types';

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

describe('buildMosaicFilters', () => {
  it('returns empty filters when no mosaic clips', () => {
    const result = buildMosaicFilters([], 1920, 1080, 'vconcat');
    expect(result.filters).toEqual([]);
    expect(result.outputLabel).toBe('vconcat');
  });

  it('builds geq filters for mosaic clips', () => {
    const tracks: MosaicTrack[] = [
      {
        id: 'm1',
        name: 'モザイク 1',
        clips: [
          {
            id: 'mc1',
            timelineStart: 1,
            duration: 2,
            mask: { cx: 0.5, cy: 0.4, rx: 0.2, ry: 0.1, angle: 0 },
          },
        ],
      },
    ];

    const result = buildMosaicFilters(tracks, 1920, 1080, 'vconcat');
    expect(result.filters).toHaveLength(1);
    expect(result.filters[0]).toContain('geq=lum=');
    expect(result.filters[0]).toContain("between(t,1.000000,3.000000)");
    expect(result.outputLabel).toBe('mosaicout0');
  });

  it('uses pixel-space ellipse math so rotated masks match the preview aspect ratio', () => {
    const tracks: MosaicTrack[] = [
      {
        id: 'm1',
        name: 'モザイク 1',
        clips: [
          {
            id: 'mc1',
            timelineStart: 0,
            duration: 1,
            mask: { cx: 0.5, cy: 0.25, rx: 0.2, ry: 0.1, angle: Math.PI / 4 },
          },
        ],
      },
    ];

    const result = buildMosaicFilters(tracks, 1920, 1080, 'vconcat');

    expect(result.filters[0]).toContain('(X-960.000000)');
    expect(result.filters[0]).toContain('(Y-270.000000)');
    expect(result.filters[0]).toContain('/384.000000');
    expect(result.filters[0]).toContain('/108.000000');
  });
});
