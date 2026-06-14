import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

type ConcatMetadata = {
  fps: number;
  duration: number;
  hasAudio: boolean;
};

type AppContext = {
  buildTrimmedConcatCommand: (
    inputPaths: string[],
    metadataList: ConcatMetadata[],
    trimFrames: number,
    outputName: string,
  ) => string[];
  formatFfmpegCommandForLog: (args: string[]) => string;
};

function loadAppContext() {
  const appSource = readFileSync(resolve(process.cwd(), 'assets/js/app.js'), 'utf8');
  const context = {
    console,
    window: {},
    document: {
      addEventListener: () => {},
      getElementById: () => null,
    },
    crypto: {
      randomUUID: () => 'test-id',
    },
    Blob,
    File,
  };
  vm.createContext(context);
  vm.runInContext(appSource, context);
  return context as unknown as AppContext;
}

describe('concat command builder', () => {
  it('trims audio-video joins without reverse filters', () => {
    const { buildTrimmedConcatCommand } = loadAppContext();
    const args = buildTrimmedConcatCommand(
      ['in1.mp4', 'in2.mp4', 'in3.mp4'],
      [
        { fps: 30, duration: 10, hasAudio: true },
        { fps: 30, duration: 10, hasAudio: true },
        { fps: 30, duration: 10, hasAudio: true },
      ],
      3,
      'out.mp4',
    );
    const filter = args[args.indexOf('-filter_complex') + 1];

    expect(filter).toContain('trim=end=9.900000');
    expect(filter).toContain('trim=start=0.100000:end=9.900000');
    expect(filter).toContain('atrim=end=9.900000');
    expect(filter).toContain('atrim=start=0.100000:end=9.900000');
    expect(filter).not.toContain('reverse');
    expect(filter).not.toContain('areverse');
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
  });

  it('quotes filter_complex in diagnostic command logs', () => {
    const { formatFfmpegCommandForLog } = loadAppContext();

    expect(formatFfmpegCommandForLog(['-filter_complex', '[0:v]trim=end=1,setpts=PTS-STARTPTS[v0];[v0]null[vout]']))
      .toBe('-filter_complex "[0:v]trim=end=1,setpts=PTS-STARTPTS[v0];[v0]null[vout]"');
  });
});
