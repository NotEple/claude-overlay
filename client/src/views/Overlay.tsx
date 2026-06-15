import { useEffect, useRef, useCallback } from "react";
import {
  OverlayStage,
  type OverlayStageHandle,
} from "../components/CanvasStage";
import { useSocket } from "../hooks/useSocket";
import type { MediaControlPayload } from "../types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export function Overlay() {
  const stageRef = useRef<OverlayStageHandle>(null);

  const handleMediaControl = useCallback((payload: MediaControlPayload) => {
    stageRef.current?.applyControl(payload);
  }, []);

  const { elements, strokes, liveStrokes } = useSocket({
    mode: "overlay",
    onMediaControl: handleMediaControl,
  });

  useEffect(() => {
    const id = setInterval(
      () => fetch(`${SERVER_URL}/ping`).catch(() => {}),
      10 * 60 * 1000,
    );
    return () => clearInterval(id);
  }, []);

  return <OverlayStage ref={stageRef} elements={elements} strokes={strokes} liveStrokes={liveStrokes} />;
}
