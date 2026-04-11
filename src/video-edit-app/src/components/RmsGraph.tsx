import { useEffect, useRef } from 'react';

interface RmsGraphProps {
  rmsGraph?: number[];
  width: number;
  height: number;
  color?: string;
}

/**
 * 音声クリップの RMS グラフを Canvas で描画するコンポーネント。
 * rmsGraph の各値を棒グラフとして表示し、クリップの背景に重ねる。
 */
export function RmsGraph({
  rmsGraph,
  width,
  height,
  color = 'rgba(196, 247, 255, 0.78)',
}: RmsGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !rmsGraph || rmsGraph.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas のサイズを設定
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    const barWidth = Math.max(1, width / rmsGraph.length);
    ctx.fillStyle = color;

    for (let i = 0; i < rmsGraph.length; i++) {
      const value = rmsGraph[i];
      const barHeight = value * height;
      ctx.fillRect(i * barWidth, height - barHeight, barWidth, barHeight);
    }
  }, [rmsGraph, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
