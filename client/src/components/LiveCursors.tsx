import type { CursorPayload } from "../types";

interface LiveCursorsProps {
  cursors: Map<string, CursorPayload>;
  pan: { x: number; y: number };
  zoom: number;
  large?: boolean;
}

/** Choose readable label and pointer ink for user-selected Twitch colors. */
function foregroundFor(color: string) {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return "#ffffff";
  const [red, green, blue] = [0, 2, 4].map(
    (offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.62
    ? "#111827"
    : "#ffffff";
}

export function LiveCursors({ cursors, pan, zoom, large = false }: LiveCursorsProps) {
  return (
    <>
      {[...cursors.values()].map((cursor) => {
        const foreground = foregroundFor(cursor.color);
        return (
          <div
            key={cursor.userId}
            style={{
              position: "absolute",
              left: cursor.x * zoom + pan.x,
              top: cursor.y * zoom + pan.y,
              pointerEvents: "none",
              zIndex: 1000,
              transition: "left 60ms linear, top 60ms linear",
            }}
          >
            <svg
              width={large ? 32 : 18}
              height={large ? 32 : 18}
              viewBox="0 0 20 20"
              style={{
                display: "block",
                filter: large ? "drop-shadow(0 2px 3px rgba(0,0,0,.8))" : undefined,
              }}
            >
              <path
                d="M4 2L16 10L10 11L7 18L4 2Z"
                fill={cursor.color}
                stroke={foreground}
                strokeWidth={large ? "2" : "1.5"}
              />
            </svg>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: large ? 7 : 4,
                background: cursor.color,
                borderRadius: large ? 7 : 4,
                padding: large ? "5px 10px" : "2px 6px",
                whiteSpace: "nowrap",
                marginTop: large ? 3 : 2,
                border: `${large ? 2 : 1}px solid ${foreground}`,
                boxShadow: large ? "0 3px 8px rgba(0,0,0,.65)" : undefined,
              }}
            >
              <img
                src={cursor.avatar}
                alt=""
                style={{
                  width: large ? 24 : 14,
                  height: large ? 24 : 14,
                  borderRadius: "50%",
                }}
              />
              <span
                style={{
                  fontSize: large ? 18 : 11,
                  color: foreground,
                  fontWeight: large ? 700 : 600,
                  fontFamily: "Inter, sans-serif",
                  textShadow:
                    foreground === "#ffffff"
                      ? "0 1px 2px rgba(0,0,0,.8)"
                      : "0 1px 1px rgba(255,255,255,.45)",
                }}
              >
                {cursor.displayName}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}
