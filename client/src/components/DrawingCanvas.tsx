import { useRef, useEffect, useCallback } from 'react';
import type { DrawStroke, LiveDrawStroke } from '../types';
import { randomUUID } from '../utils';

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

interface DrawingCanvasProps {
  width: number;
  height: number;
  strokes: DrawStroke[];
  liveStrokes?: Map<string, LiveDrawStroke>;
  drawMode: boolean;
  color: string;
  size: number;
  eraser: boolean;
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
  color,
  size,
  eraser,
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
  const eraserRef = useRef(eraser);
  const lastLiveEmitRef = useRef(0);

  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { eraserRef.current = eraser; }, [eraser]);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Committed strokes
    for (const stroke of strokes) {
      renderStroke(ctx, stroke, offsetX, offsetY);
    }
    // Other users' live strokes
    if (liveStrokes) {
      for (const live of liveStrokes.values()) {
        renderStroke(ctx, live, offsetX, offsetY);
      }
    }
    // Own live stroke
    if (livePointsRef.current.length > 0) {
      renderStroke(ctx, {
        points: livePointsRef.current,
        color: colorRef.current,
        size: sizeRef.current,
        eraser: eraserRef.current,
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
      isDrawingRef.current = true;
      livePointsRef.current = [getPoint(e)];
      redrawAll();
    };

    const onMove = (e: MouseEvent) => {
      if (!isDrawingRef.current) return;
      const pt = getPoint(e);
      livePointsRef.current.push(pt);
      redrawAll();
      // Throttled volatile emit for live preview on other clients
      const now = Date.now();
      if (onLiveStroke && now - lastLiveEmitRef.current > 16) {
        lastLiveEmitRef.current = now;
        onLiveStroke({
          points: livePointsRef.current,
          color: colorRef.current,
          size: sizeRef.current,
          eraser: eraserRef.current,
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
          eraser: eraserRef.current,
        });
      } else {
        // Nothing drawn — signal clear of own live stroke
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
        cursor: drawMode ? (eraser ? 'cell' : 'crosshair') : 'default',
        zIndex: drawMode ? 999 : zIndex,
      }}
    />
  );
}
