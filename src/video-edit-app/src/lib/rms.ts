/**
 * RMS (Root Mean Square) グラフ計算
 * 音声ファイルから 10ms ごとの RMS 値を計算し、-80dB～0dB で正規化した配列を返す。
 */

export async function computeRmsGraph(
  file: File,
  audioContext: AudioContext,
  sampleIntervalMs: number = 10
): Promise<number[]> {
  // ファイルを ArrayBuffer に変換
  const arrayBuffer = await file.arrayBuffer();

  // Web Audio API でデコード
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // 最初のチャンネルのデータを取得
  const channelData = audioBuffer.getChannelData(0);

  // サンプルレートから 10ms ごとのサンプル数を計算
  const samplesPerInterval = Math.round((sampleIntervalMs / 1000) * audioContext.sampleRate);

  // RMS 値を配列に格納
  const rmsValues: number[] = [];

  for (let i = 0; i < channelData.length; i += samplesPerInterval) {
    const slice = channelData.slice(i, i + samplesPerInterval);

    // RMS = sqrt(平均二乗)
    const sumOfSquares = slice.reduce((sum, val) => sum + val * val, 0);
    const rms = Math.sqrt(sumOfSquares / slice.length);

    // dB に変換: dB = 20 * log10(RMS)
    // RMS が 0 の場合は -80dB とする
    const db = rms > 0 ? 20 * Math.log10(rms) : -80;

    // -80dB～0dB を 0～1 に正規化
    const normalized = Math.max(0, Math.min(1, (db + 80) / 80));

    rmsValues.push(normalized);
  }

  return rmsValues;
}
