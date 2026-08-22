export const STREAM_W = 1920;
export const STREAM_H = 1080;
export const WORKSPACE_W = 4000;
export const WORKSPACE_H = 3000;

export const STREAM_OFFSET_X = Math.round((WORKSPACE_W - STREAM_W) / 2);
export const STREAM_OFFSET_Y = Math.round((WORKSPACE_H - STREAM_H) / 2);
export const SPAWN_X = STREAM_OFFSET_X - 800;
export const SPAWN_Y = STREAM_OFFSET_Y + 100;

export function parseTextSrc(src: string) {
  const [text = "", color = "#ffffff", fs = "48", fontFamily = "Inter"] = src.split("|||");
  return { text, color, fontSize: Number.parseInt(fs, 10), fontFamily };
}

export function getFileLabel(src: string): string {
  try {
    const queryName = new URL(src).searchParams.get("name");
    if (queryName) return queryName;
  } catch {
    // Non-URL sources fall through to their final path segment.
  }
  return src.split("/").pop()?.split("?")[0] ?? "";
}
