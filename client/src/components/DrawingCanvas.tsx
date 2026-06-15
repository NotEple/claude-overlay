import { useRef, useEffect, useCallback } from 'react';
import type { DrawStroke, LiveDrawStroke } from '../types';
import { randomUUID } from '../utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRGBA(hex: string): [number, number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: [number, number, number, number],
  tolerance = 64,
) {
  const canvas = ctx.canvas;
  startX = Math.round(startX);
  startY = Math.round(startY);
  if (startX < 0 || startX >= canvas.width || startY < 0 || startY >= canvas.height) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const si = (startY * w + startX) * 4;
  const tR = data[si], tG = data[si + 1], tB = data[si + 2], tA = data[si + 3];

  // Don't fill if target already matches fill color
  if (
    Math.abs(tR - fillColor[0]) <= tolerance &&
    Math.abs(tG - fillColor[1]) <= tolerance &&
    Math.abs(tB - fillColor[2]) <= tolerance &&
    Math.abs(tA - fillColor[3]) <= tolerance
  ) return;

  const matches = (i: number) =>
    Math.abs(data[i] - tR) <= tolerance &&
    Math.abs(data[i + 1] - tG) <= tolerance &&
    Math.abs(data[i + 2] - tB) <= tolerance &&
    Math.abs(data[i + 3] - tA) <= tolerance;

  const visited = new Uint8Array(w * h);
  const stack = [startY * w + startX];
  const MAX = 3_000_000;
  let count = 0;

  while (stack.length && count < MAX) {
    const pos = stack.pop()!;
    if (visited[pos]) continue;
    visited[pos] = 1;
    const i4 = pos * 4;
    if (!matches(i4)) continue;
    data[i4] = fillColor[0];
    data[i4 + 1] = fillColor[1];
    data[i4 + 2] = fillColor[2];
    data[i4 + 3] = fillColor[3];
    count++;
    const x = pos % w, y = (pos / w) | 0;
    if (x > 0) stack.push(pos - 1);
    if (x < w - 1) stack.push(pos + 1);
    if (y > 0) stack.push(pos - w);
    if (y < h - 1) stack.push(pos + w);
  }

  // 1-pixel dilation: expand fill into adjacent stroke-edge pixels (anti-aliased
  // pixels that aren't background and weren't reached by the BFS).
  for (let pos = 0; pos < w * h; pos++) {
    if (!visited[pos]) continue;
    const x = pos % w, y = (pos / w) | 0;
    const neighbors = [
      x > 0 ? pos - 1 : -1,
      x < w - 1 ? pos + 1 : -1,
      y > 0 ? pos - w : -1,
      y < h - 1 ? pos + w : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || visited[n]) continue;
      const i4 = n * 4;
      if (matches(i4)) continue; // skip open background pixels
      data[i4] = fillColor[0];
      data[i4 + 1] = fillColor[1];
      data[i4 + 2] = fillColor[2];
      data[i4 + 3] = fillColor[3];
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---------------------------------------------------------------------------
// Render a single action (stroke or fill) onto a canvas context
// ---------------------------------------------------------------------------

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: { points: Array<[number, number]>; color: string; size: number; eraser: boolean },
  offsetX = 0,
  offsetY = 0,
) {
  const { points, color, size, eraser } = stroke;
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0] - offsetX, points[0][1] - offsetY, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0][0] - offsetX, points[0][1] - offsetY);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0] - offsetX, points[i][1] - offsetY);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function renderAction(
  ctx: CanvasRenderingContext2D,
  action: DrawStroke,
  offsetX = 0,
  offsetY = 0,
) {
  if (action.fillX !== undefined && action.fillY !== undefined) {
    floodFill(ctx, action.fillX - offsetX, action.fillY - offsetY, hexToRGBA(action.color));
  } else {
    renderStroke(ctx, action, offsetX, offsetY);
  }
}

// ---------------------------------------------------------------------------
// DrawingCanvas
// ---------------------------------------------------------------------------

export type DrawToolMode = 'pen' | 'eraser' | 'fill';

interface DrawingCanvasProps {
  width: number;
  height: number;
  strokes: DrawStroke[];
  liveStrokes?: Map<string, LiveDrawStroke>;
  drawMode: boolean;
  toolMode: DrawToolMode;
  color: string;
  size: number;
  onStroke: (stroke: DrawStroke) => void;
  onLiveStroke?: (data: Omit<LiveDrawStroke, 'userId'>) => void;
  offsetX?: number;
  offsetY?: number;
  zIndex?: number;
}

export function DrawingCanvas({
  width,
  height,
  strokes,
  liveStrokes,
  drawMode,
  toolMode,
  color,
  size,
  onStroke,
  onLiveStroke,
  offsetX = 0,
  offsetY = 0,
  zIndex = 1,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const livePointsRef = useRef<Array<[number, number]>>([]);
  const isDrawingRef = useRef(false);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const toolRef = useRef(toolMode);
  const lastLiveEmitRef = useRef(0);

  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { toolRef.current = toolMode; }, [toolMode]);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const action of strokes) {
      renderAction(ctx, action, offsetX, offsetY);
    }
    if (liveStrokes) {
      for (const live of liveStrokes.values()) {
        renderStroke(ctx, live, offsetX, offsetY);
      }
    }
    if (livePointsRef.current.length > 0) {
      renderStroke(ctx, {
        points: livePointsRef.current,
        color: colorRef.current,
        size: sizeRef.current,
        eraser: toolRef.current === 'eraser',
      }, offsetX, offsetY);
    }
  }, [strokes, liveStrokes, offsetX, offsetY]);

  useEffect(() => { redrawAll(); }, [redrawAll]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !drawMode) return;

    const getPoint = (e: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return [
        (e.clientX - rect.left) * scaleX + offsetX,
        (e.clientY - rect.top) * scaleY + offsetY,
      ];
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      if (toolRef.current === 'fill') {
        const [wx, wy] = getPoint(e);
        // Run fill locally immediately
        const ctx = canvas.getContext('2d')!;
        floodFill(ctx, wx - offsetX, wy - offsetY, hexToRGBA(colorRef.current));
        // Emit as a draw action so other clients + overlay can replay
        onStroke({
          id: randomUUID(),
          points: [],
          color: colorRef.current,
          size: 0,
          eraser: false,
          fillX: wx,
          fillY: wy,
        });
        return;
      }

      isDrawingRef.current = true;
      livePointsRef.current = [getPoint(e)];
      redrawAll();
    };

    const onMove = (e: MouseEvent) => {
      if (!isDrawingRef.current) return;
      livePointsRef.current.push(getPoint(e));
      redrawAll();
      const now = Date.now();
      if (onLiveStroke && now - lastLiveEmitRef.current > 16) {
        lastLiveEmitRef.current = now;
        onLiveStroke({
          points: livePointsRef.current,
          color: colorRef.current,
          size: sizeRef.current,
          eraser: toolRef.current === 'eraser',
        });
      }
    };

    const onUp = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      const pts = livePointsRef.current;
      livePointsRef.current = [];
      if (pts.length > 0) {
        onStroke({
          id: randomUUID(),
          points: pts,
          color: colorRef.current,
          size: sizeRef.current,
          eraser: toolRef.current === 'eraser',
        });
      } else {
        onLiveStroke?.({ points: [], color: '', size: 0, eraser: false });
        redrawAll();
      }
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drawMode, onStroke, onLiveStroke, redrawAll, offsetX, offsetY]);

  const cursor = !drawMode ? 'default'
    : toolMode === 'fill' ? 'cell'
    : toolMode === 'eraser' ? 'cell'
    : 'crosshair';

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: drawMode ? 'all' : 'none',
        cursor,
        zIndex: drawMode ? 999 : zIndex,
      }}
    />
  );
}
