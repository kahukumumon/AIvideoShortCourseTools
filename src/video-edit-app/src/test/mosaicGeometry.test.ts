import { describe, expect, it } from 'vitest';

import { resizeEllipseWithFixedOpposite } from '../App';
import type { EllipseMask } from '../types';

function geometry(mask: EllipseMask, width: number, height: number) {
  const angle = mask.angle || 0;
  return {
    centerX: mask.cx * width,
    centerY: mask.cy * height,
    radiusX: mask.rx * width,
    radiusY: mask.ry * height,
    cosA: Math.cos(angle),
    sinA: Math.sin(angle),
  };
}

function sidePoint(mask: EllipseMask, width: number, height: number, side: 'left' | 'right' | 'top' | 'bottom') {
  const { centerX, centerY, radiusX, radiusY, cosA, sinA } = geometry(mask, width, height);
  switch (side) {
    case 'right':
      return [centerX + radiusX * cosA, centerY + radiusX * sinA] as const;
    case 'left':
      return [centerX - radiusX * cosA, centerY - radiusX * sinA] as const;
    case 'bottom':
      return [centerX - radiusY * sinA, centerY + radiusY * cosA] as const;
    case 'top':
      return [centerX + radiusY * sinA, centerY - radiusY * cosA] as const;
  }
}

function cornerPoint(mask: EllipseMask, width: number, height: number, xSide: 'left' | 'right', ySide: 'top' | 'bottom') {
  const { centerX, centerY } = geometry(mask, width, height);
  const x = sidePoint(mask, width, height, xSide);
  const y = sidePoint(mask, width, height, ySide);
  return [x[0] + y[0] - centerX, x[1] + y[1] - centerY] as const;
}

function expectPointClose(actual: readonly [number, number], expected: readonly [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 5);
  expect(actual[1]).toBeCloseTo(expected[1], 5);
}

describe('resizeEllipseWithFixedOpposite', () => {
  const width = 1280;
  const height = 720;
  const mask: EllipseMask = { cx: 0.45, cy: 0.5, rx: 0.18, ry: 0.12, angle: Math.PI / 6 };

  it('keeps the opposite side fixed when dragging a side handle on a rotated ellipse', () => {
    const beforeLeft = sidePoint(mask, width, height, 'left');
    const right = sidePoint(mask, width, height, 'right');
    const { cosA, sinA } = geometry(mask, width, height);
    const pointer = [right[0] + cosA * 96, right[1] + sinA * 96] as const;

    const resized = resizeEllipseWithFixedOpposite(mask, 'resize-right', pointer[0] / width, pointer[1] / height, width, height);

    expectPointClose(sidePoint(resized, width, height, 'left'), beforeLeft);
    expect(resized.rx).toBeGreaterThan(mask.rx);
    expect(resized.cx).not.toBeCloseTo(mask.cx, 5);
  });

  it('keeps the opposite corner fixed when dragging a diagonal handle', () => {
    const beforeBottomLeft = cornerPoint(mask, width, height, 'left', 'bottom');
    const topRight = cornerPoint(mask, width, height, 'right', 'top');
    const { cosA, sinA } = geometry(mask, width, height);
    const axisY = [-sinA, cosA] as const;
    const pointer = [topRight[0] + cosA * 80 - axisY[0] * 48, topRight[1] + sinA * 80 - axisY[1] * 48] as const;

    const resized = resizeEllipseWithFixedOpposite(
      mask,
      'resize-top-right',
      pointer[0] / width,
      pointer[1] / height,
      width,
      height,
    );

    expectPointClose(cornerPoint(resized, width, height, 'left', 'bottom'), beforeBottomLeft);
    expect(resized.rx).toBeGreaterThan(mask.rx);
    expect(resized.ry).toBeGreaterThan(mask.ry);
  });
});
