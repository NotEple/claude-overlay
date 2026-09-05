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

function withOpacity(color: [number, number, number, number], opacity: number) {
  return [color[0], color[1], color[2], Math.round(255 * opacity)] as [number, number, number, number];
}

function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: [number, number, number, number],
  tolerance = 64,
  requireEnclosed = false,
): boolean {
  const canvas = ctx.canvas;
  startX = Math.round(startX);
  startY = Math.round(startY);
  if (startX < 0 || startX >= canvas.width || startY < 0 || startY >= canvas.height) return false;

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
  ) return false;

  const matches = (i: number) =>
    Math.abs(data[i] - tR) <= tolerance &&
    Math.abs(data[i + 1] - tG) <= tolerance &&
    Math.abs(data[i + 2] - tB) <= tolerance &&
    Math.abs(data[i + 3] - tA) <= tolerance;

  const visited = new Uint8Array(w * h);
  const filled = new Uint8Array(w * h);
  const stack = [startY * w + startX];
  const MAX = 3_000_000;
  let count = 0;
  let touchesBoundary = false;

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
    filled[pos] = 1;
    count++;
    const x = pos % w, y = (pos / w) | 0;
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) touchesBoundary = true;
    if (x > 0) stack.push(pos - 1);
    if (x < w - 1) stack.push(pos + 1);
    if (y > 0) stack.push(pos - w);
    if (y < h - 1) stack.push(pos + w);
  }

  // Expand the fill beneath the anti-aliased inner edge of the brush. `visited`
  // also contains rejected boundary pixels, so use the separate `filled` mask;
  // otherwise the exact edge pixels are skipped and a hairline gap remains.
  for (let pos = 0; pos < w * h; pos++) {
    if (!filled[pos]) continue;
    const x = pos % w, y = (pos / w) | 0;
    const neighbors = [
      x > 0 ? pos - 1 : -1,
      x < w - 1 ? pos + 1 : -1,
      y > 0 ? pos - w : -1,
      y < h - 1 ? pos + w : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || filled[n]) continue;
      const i4 = n * 4;
      if (matches(i4)) continue; // skip open background pixels

      // Composite the fill behind the existing edge rather than replacing it.
      // This closes the transparent anti-alias seam while preserving the
      // brush's original color (including when outline and fill differ).
      const edgeAlpha = data[i4 + 3] / 255;
      const fillAlpha = fillColor[3] / 255;
      const outAlpha = edgeAlpha + fillAlpha * (1 - edgeAlpha);
      if (outAlpha === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        data[i4 + channel] = Math.round(
          (data[i4 + channel] * edgeAlpha +
            fillColor[channel] * fillAlpha * (1 - edgeAlpha)) /
            outAlpha,
        );
      }
      data[i4 + 3] = Math.round(outAlpha * 255);
    }
  }

  // A fill that reaches the canvas edge is the open workspace background, not
  // a shape. Discard the mutated ImageData before it ever reaches the canvas.
  // Hitting the safety cap is also treated as open/unsafe rather than applying
  // a partial multi-million-pixel fill.
  if (count === 0 || (requireEnclosed && (touchesBoundary || stack.length > 0))) return false;

  ctx.putImageData(imageData, 0, 0);
  return true;
}

// ---------------------------------------------------------------------------
// Render a single action (stroke or fill) onto a canvas context
// ---------------------------------------------------------------------------

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<DrawStroke, "points" | "color" | "size" | "eraser" | "tool" | "opacity">,
  offsetX = 0,
  offsetY = 0,
) {
  const { points, color, size, eraser } = stroke;
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
  ctx.globalAlpha = stroke.opacity ?? 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const tool = stroke.tool ?? (eraser ? 'eraser' : 'pen');
  if (["line", "arrow", "rectangle", "ellipse"].includes(tool) && points.length >= 2) {
    const [start, end] = [points[0], points[points.length - 1]];
    const x1 = start[0] - offsetX, y1 = start[1] - offsetY;
    const x2 = end[0] - offsetX, y2 = end[1] - offsetY;
    ctx.beginPath();
    if (tool === "rectangle") {
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (tool === "ellipse") {
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (tool === "arrow") {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.max(10, Math.min(30, size * 3));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
      }
      ctx.stroke();
    }
  } else if (points.length === 1) {
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
    floodFill(
      ctx,
      action.fillX - offsetX,
      action.fillY - offsetY,
      withOpacity(hexToRGBA(action.color), action.opacity ?? 1),
      action.fillTolerance ?? 64,
    );
  } else {
    renderStroke(ctx, action, offsetX, offsetY);
  }
}

// ---------------------------------------------------------------------------
// DrawingCanvas
// ---------------------------------------------------------------------------

export type DrawToolMode = 'pen' | 'eraser' | 'fill' | 'line' | 'arrow' | 'rectangle' | 'ellipse';

interface DrawingCanvasProps {
  width: number;
  height: number;
  strokes: DrawStroke[];
  liveStrokes?: Map<string, LiveDrawStroke>;
  drawMode: boolean;
  toolMode: DrawToolMode;
  color: string;
  size: number;
  opacity: number;
  fillTolerance: number;
  onStroke: (stroke: DrawStroke) => void;
  onFillRejected?: () => void;
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
  opacity,
  fillTolerance,
  onStroke,
  onFillRejected,
  onLiveStroke,
  offsetX = 0,
  offsetY = 0,
  zIndex = 1,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const shapePreviewRef = useRef<SVGPathElement>(null);
  // Offscreen canvas holding all *committed* strokes/fills already baked in.
  // Avoids ever re-running an expensive flood fill on every redraw.
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bakedCountRef = useRef(0);
  const livePointsRef = useRef<Array<[number, number]>>([]);
  const isDrawingRef = useRef(false);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const toolRef = useRef(toolMode);
  const opacityRef = useRef(opacity);
  const fillToleranceRef = useRef(fillTolerance);
  const brushPreviewRef = useRef<HTMLDivElement>(null);
  const lastLiveEmitRef = useRef(0);
  const redrawFrameRef = useRef<number | null>(null);

  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { toolRef.current = toolMode; }, [toolMode]);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);
  useEffect(() => { fillToleranceRef.current = fillTolerance; }, [fillTolerance]);

  // Bake newly-committed strokes into the offscreen base layer once.
  // If strokes shrank (e.g. cleared) or otherwise diverged, rebuild from scratch.
  useEffect(() => {
    let base = baseCanvasRef.current;
    if (!base) {
      base = document.createElement('canvas');
      baseCanvasRef.current = base;
    }
    if (base.width !== width || base.height !== height) {
      base.width = width;
      base.height = height;
      bakedCountRef.current = 0;
    }
    const ctx = base.getContext('2d')!;
    if (strokes.length < bakedCountRef.current) {
      ctx.clearRect(0, 0, base.width, base.height);
      bakedCountRef.current = 0;
    }
    for (let i = bakedCountRef.current; i < strokes.length; i++) {
      renderAction(ctx, strokes[i], offsetX, offsetY);
    }
    bakedCountRef.current = strokes.length;
    const canvas = canvasRef.current;
    if (canvas) {
      const visibleContext = canvas.getContext('2d')!;
      visibleContext.clearRect(0, 0, canvas.width, canvas.height);
      visibleContext.drawImage(base, 0, 0);
    }
  }, [strokes, width, height, offsetX, offsetY]);

  const redrawAll = useCallback(() => {
    if (redrawFrameRef.current !== null) return;
    redrawFrameRef.current = window.requestAnimationFrame(() => {
      redrawFrameRef.current = null;
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (liveStrokes) {
        for (const live of liveStrokes.values()) {
          // A transparent preview layer cannot erase pixels from the committed
          // canvas beneath it, so show an understated light trail until the
          // eraser action is committed on mouse-up.
          renderStroke(ctx, live.eraser
            ? { ...live, eraser: false, color: "#ffffff", opacity: 0.3 }
            : live, offsetX, offsetY);
        }
      }
      const drawingShape = ["line", "arrow", "rectangle", "ellipse"].includes(toolRef.current);
      if (livePointsRef.current.length > 0 && !drawingShape) {
        const erasing = toolRef.current === 'eraser';
        renderStroke(ctx, {
          points: livePointsRef.current,
          color: erasing ? "#ffffff" : colorRef.current,
          size: sizeRef.current,
          eraser: false,
          tool: toolRef.current === "fill" ? "pen" : toolRef.current,
          opacity: erasing ? 0.3 : opacityRef.current,
        }, offsetX, offsetY);
      }
    });
  }, [liveStrokes, offsetX, offsetY]);

  useEffect(() => { redrawAll(); }, [strokes, redrawAll]);
  useEffect(() => () => {
    if (redrawFrameRef.current !== null) window.cancelAnimationFrame(redrawFrameRef.current);
  }, []);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
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

    const shapePoint = (event: MouseEvent): [number, number] => {
      const point = getPoint(event);
      const start = livePointsRef.current[0];
      if (!start || !event.shiftKey) return point;
      if (toolRef.current === "rectangle" || toolRef.current === "ellipse") {
        const dx = point[0] - start[0];
        const dy = point[1] - start[1];
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        return [start[0] + Math.sign(dx || 1) * side, start[1] + Math.sign(dy || 1) * side];
      }
      if (toolRef.current === "line" || toolRef.current === "arrow") {
        const dx = point[0] - start[0];
        const dy = point[1] - start[1];
        const length = Math.hypot(dx, dy);
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        return [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length];
      }
      return point;
    };

    const updateShapePreview = () => {
      const path = shapePreviewRef.current;
      const [start, end] = livePointsRef.current;
      if (!path || !start || !end) return;
      const x1 = start[0] - offsetX, y1 = start[1] - offsetY;
      const x2 = end[0] - offsetX, y2 = end[1] - offsetY;
      let d = "";
      if (toolRef.current === "rectangle") {
        d = `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`;
      } else if (toolRef.current === "ellipse") {
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        d = rx > 0 && ry > 0
          ? `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`
          : "";
      } else {
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        if (toolRef.current === "arrow") {
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const head = Math.max(10, Math.min(30, sizeRef.current * 3));
          d += ` M ${x2} ${y2} L ${x2 - head * Math.cos(angle - Math.PI / 6)} ${y2 - head * Math.sin(angle - Math.PI / 6)}`;
          d += ` M ${x2} ${y2} L ${x2 - head * Math.cos(angle + Math.PI / 6)} ${y2 - head * Math.sin(angle + Math.PI / 6)}`;
        }
      }
      path.setAttribute("d", d);
      path.setAttribute("stroke", colorRef.current);
      path.setAttribute("stroke-width", String(sizeRef.current));
      path.setAttribute("opacity", String(opacityRef.current));
      path.style.display = "block";
    };

    const hideShapePreview = () => {
      const path = shapePreviewRef.current;
      if (!path) return;
      path.style.display = "none";
      path.removeAttribute("d");
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      if (toolRef.current === 'fill') {
        const [wx, wy] = getPoint(e);
        // Run fill locally immediately
        const committedCanvas = canvasRef.current;
        if (!committedCanvas) return;
        const ctx = committedCanvas.getContext('2d')!;
        const filled = floodFill(
          ctx,
          wx - offsetX,
          wy - offsetY,
          withOpacity(hexToRGBA(colorRef.current), opacityRef.current),
          fillToleranceRef.current,
          true,
        );
        if (!filled) {
          onFillRejected?.();
          return;
        }
        // Emit as a draw action so other clients + overlay can replay
        onStroke({
          id: randomUUID(),
          points: [],
          color: colorRef.current,
          size: 0,
          eraser: false,
          fillX: wx,
          fillY: wy,
          tool: "fill",
          opacity: opacityRef.current,
          fillTolerance: fillToleranceRef.current,
        });
        return;
      }

      isDrawingRef.current = true;
      livePointsRef.current = [getPoint(e)];
      if (!["line", "arrow", "rectangle", "ellipse"].includes(toolRef.current)) redrawAll();
    };

    const onMove = (e: MouseEvent) => {
      if (!isDrawingRef.current) return;
      const isShape = ["line", "arrow", "rectangle", "ellipse"].includes(toolRef.current);
      const point = isShape ? shapePoint(e) : getPoint(e);
      if (isShape) livePointsRef.current = [livePointsRef.current[0], point];
      else livePointsRef.current.push(point);
      if (isShape) updateShapePreview();
      else redrawAll();
      const now = Date.now();
      // Shape previews are lightweight SVG locally, so they can be sent at
      // display-frame cadence. A 50 ms interval made the OBS overlay visibly
      // advance in 20 fps steps even though the dashboard itself was smooth.
      const broadcastInterval = isShape ? 16 : 32;
      if (onLiveStroke && now - lastLiveEmitRef.current > broadcastInterval) {
        lastLiveEmitRef.current = now;
        onLiveStroke({
          points: livePointsRef.current,
          color: colorRef.current,
          size: sizeRef.current,
          eraser: toolRef.current === 'eraser',
          tool: toolRef.current === "fill" ? "pen" : toolRef.current,
          opacity: opacityRef.current,
        });
      }
    };

    const onUp = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      const pts = livePointsRef.current;
      livePointsRef.current = [];
      hideShapePreview();
      if (pts.length > 0) {
        onStroke({
          id: randomUUID(),
          points: pts,
          color: colorRef.current,
          size: sizeRef.current,
          eraser: toolRef.current === 'eraser',
          tool: toolRef.current,
          opacity: opacityRef.current,
        });
      } else {
        onLiveStroke?.({ points: [], color: '', size: 0, eraser: false });
        redrawAll();
      }
    };

    canvas.addEventListener('mousedown', onDown);
    const updatePreview = (event: MouseEvent) => {
      const preview = brushPreviewRef.current;
      if (!preview) return;
      if (!["pen", "eraser"].includes(toolRef.current)) {
        preview.style.display = "none";
        return;
      }
      const [x, y] = getPoint(event);
      preview.style.display = "block";
      preview.style.left = `${x - offsetX}px`;
      preview.style.top = `${y - offsetY}px`;
      preview.style.width = `${sizeRef.current}px`;
      preview.style.height = `${sizeRef.current}px`;
      preview.style.borderColor = toolRef.current === "eraser" ? "#ffffff" : colorRef.current;
      preview.style.opacity = String(Math.max(0.35, opacityRef.current));
    };
    const hidePreview = () => {
      if (brushPreviewRef.current) brushPreviewRef.current.style.display = "none";
    };
    canvas.addEventListener('mousemove', updatePreview);
    canvas.addEventListener('mouseleave', hidePreview);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', updatePreview);
      canvas.removeEventListener('mouseleave', hidePreview);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drawMode, onStroke, onFillRejected, onLiveStroke, redrawAll, offsetX, offsetY]);

  const cursor = !drawMode ? 'default'
    : toolMode === 'fill' ? 'cell'
    : ['pen', 'eraser'].includes(toolMode) ? 'none'
    : 'crosshair';

  return (
    <>
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
        pointerEvents: 'none',
        // Uploaded layers use timestamp-based z-indices, so drawing mode must
        // sit above them rather than relying on a small fixed layer number.
        zIndex: drawMode ? 2147483646 : zIndex,
      }}
    />
    <canvas
      ref={previewCanvasRef}
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
        zIndex: drawMode ? 2147483647 : zIndex + 1,
      }}
    />
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        inset: 0,
        width,
        height,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 2147483647,
      }}
    >
      <path
        ref={shapePreviewRef}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: 'none' }}
      />
    </svg>
    <div
      ref={brushPreviewRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        zIndex: 2147483647,
        display: "none",
        boxSizing: "border-box",
        border: "1px solid",
        borderRadius: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        boxShadow: "0 0 0 1px rgba(0,0,0,.65)",
      }}
    />
    </>
  );
}
