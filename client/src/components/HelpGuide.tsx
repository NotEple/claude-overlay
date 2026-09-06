import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";

const sections = [
  {
    title: "Move, select & resize",
    items: [
      [
        "Left-drag an element",
        "Move it. Selected grouped elements move together.",
      ],
      ["Alt + drag", "Temporarily disable edge and center snapping."],
      ["Drag a resize handle", "Resize from that edge or corner."],
      [
        "Drag the round rotation handle",
        "Rotate the selected element around its center. Hold Shift to snap to 15° increments.",
      ],
      ["Click an element", "Select it and show its editing controls."],
      [
        "Shift / Ctrl / Cmd + click",
        "Add or remove an element from the selection.",
      ],
      [
        "Drag empty background",
        "Draw a selection box around multiple elements.",
      ],
      ["Click empty background", "Clear the current selection."],
      ["Double-click text", "Open the text editor."],
      ["Delete / Backspace", "Delete selected unlocked elements."],
    ],
  },
  {
    title: "Navigate the workspace",
    items: [
      ["Middle-mouse drag", "Pan around the workspace."],
      ["Mouse wheel", "Zoom toward or away from the pointer."],
      ["% · Fit", "Center the 1920×1080 stream area and reset its zoom."],
    ],
  },
  {
    title: "Keyboard shortcuts",
    items: [
      ["Ctrl / Cmd + Z", "Undo the latest shared canvas change."],
      ["Ctrl / Cmd + Shift + Z", "Redo the latest undone change."],
      ["Ctrl / Cmd + Y", "Redo on Windows."],
      ["Ctrl / Cmd + C", "Copy the selected elements."],
      ["Ctrl / Cmd + V", "Paste copies with a small position offset."],
    ],
  },
  {
    title: "Top toolbar",
    items: [
      ["Add media", "Upload an image, GIF, video, or audio file."],
      ["Text", "Create a styled text element."],
      ["Draw", "Open Pen, Erase, Fill, brush size, and drawing controls."],
      ["Add as Element", "Turn the current drawing into movable media."],
      ["Fit / Fill", "Fit inside the stream area, or cover it completely."],
      ["DVD", "Start or stop bouncing movement for the selected element."],
      [
        "Drag and drop",
        "Drop one local image, GIF, video, or audio file anywhere on the dashboard. You can also drag the GIF image itself from Giphy; webpage links are rejected safely.",
      ],
      [
        "Flip X / Flip Y",
        "Mirror selected visual media horizontally or vertically.",
      ],
      ["Auto", "For video: show on play, then hide when playback ends."],
    ],
  },
  {
    title: "Drawing mode",
    items: [
      ["Pen / Erase", "Draw or remove freehand strokes. The circle at the pointer previews the current brush size."],
      ["Line / Arrow", "Drag between two points. Hold Shift to snap to 45° angles."],
      ["Box / Oval", "Drag out a rectangle or ellipse. Hold Shift to constrain it to a square or circle."],
      ["Opacity", "Set transparency for new strokes, shapes, and fills."],
      ["Fill tolerance", "Control how closely neighboring pixels must match; lower values stop at sharper boundaries."],
      ["Exit Draw", "Exit drawing mode and return to selecting and moving overlay elements."],
      ["Clear", "Remove the complete drawing after confirmation. Use Undo to restore it immediately."],
    ],
  },
  {
    title: "Layers, video & stream",
    items: [
      ["Eye / eye-off", "Show or hide a layer on the OBS overlay."],
      ["Lock", "Prevent accidental movement, resizing, and deletion."],
      ["Group", "Keep multiple selected layers moving together."],
      [
        "Group rotation handles",
        "White handles rotate one member; the accent-colored handle on the dashed group boundary rotates the whole group.",
      ],
      [
        "Video body",
        "Click the upper video area to play or pause, or drag it to move. Native playback and volume controls stay in the bottom strip.",
      ],
      ["Preview eye", "Show or hide the Twitch preview only on the dashboard."],
      [
        "Switch preview",
        "Switch both the preview and chat command listener between Vicksy and Wixels. This will change the preview for all connected users.",
      ],
      ["Refresh overlay", "Ask connected overlay browser sources to reload."],
      [
        "Go-live check",
        "Verify the dashboard server, OBS connection, Twitch listeners, broadcaster Events, command targets, and visible media placement before a stream.",
      ],
      [
        "Studio",
        "Open the Soundboard, commands, Twitch events, and chat emotes.",
      ],
      [
        "Selection hints",
        "Contextual tips appear whenever a new media element is selected until you choose Don’t show again. Dismissing them permanently does not remove this guide.",
      ],
      [
        "Search layers and Studio lists",
        "Filter large layer, Soundboard, command, and event-action lists by name without changing the overlay.",
      ],
    ],
  },
  {
    title: "Commands & effects",
    items: [
      [
        "Soundboard vs media",
        "Soundboard clips play through OBS without a canvas layer. Play video/audio layer targets uploaded media in Layers.",
      ],
      [
        "Myinstants links",
        "Sound-page links are resolved on a best-effort basis. If Myinstants blocks the server, use Download MP3 and then Upload file.",
      ],
      [
        "Add another action",
        "Chain up to 10 editable actions to one chat command or Twitch event, such as showing an image, playing a sound, and sending a chat message.",
      ],
      [
        "Twitch event filters",
        "Limit subscriptions by months, gifts by count, raids by viewers, Bits by amount, or channel points by reward title.",
      ],
      [
        "Chat message variables",
        "Messages can insert {user}, {months}, {viewers}, {bits}, {reward}, and {channel}. The connected broadcaster sends the message.",
      ],
      [
        "Command action timing",
        "Run actions together, after a chosen delay, or after the previous timed effect, video, or sound finishes.",
      ],
      [
        "Random position",
        "Place media at a fresh random point anywhere it fits inside the stream area.",
      ],
      [
        "Preview flight",
        "Test a fly-across animation on your dashboard without affecting OBS or other users.",
      ],
      [
        "DVD speed panel",
        "When a selected element is using DVD mode, adjust its speed and the shared corner sound, volume, and counter position directly beneath it.",
      ],
      [
        "Selected media animation",
        "Select an image, GIF, or video in Layers, choose a directional slide, Pop, Pulse, Spin, or Shake, set its duration, and press Play. It runs on the dashboard and OBS; slides restore the previous position afterward.",
      ],
      [
        "Studio · Emotes",
        "Choose an ordered bottom parade, floor physics, or wall bounce; tune size, speed, labels, gravity, and limits, blacklist chatters, allow selected emotes after the first emote in a message, and preview locally. Wide and zero-width emotes retain their intended layout.",
      ],
      [
        "Show my cursor on overlay",
        "The green Visible or red Hidden state controls only your cursor on OBS; dashboard cursors remain visible.",
      ],
    ],
  },
];

export function HelpGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        className="ui-icon-button"
        onClick={() => setOpen(true)}
        title="Open controls and shortcuts guide"
        aria-label="Open controls and shortcuts guide"
        style={{
          position: "absolute",
          right: 14,
          bottom: 12,
          width: 34,
          height: 34,
          zIndex: 2500,
          borderRadius: "50%",
          border: "1px solid var(--accent-border)",
          background: "var(--accent-solid)",
          color: "var(--accent-contrast)",
          boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
          cursor: "pointer",
        }}
      >
        <HelpCircle size={18} />
      </button>

      {open && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 5000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            background: "rgba(0,0,0,0.68)",
            backdropFilter: "blur(3px)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="controls-guide-title"
            style={{
              width: "min(820px, calc(100vw - 40px))",
              maxHeight: "min(760px, calc(100vh - 40px))",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "#151517",
              border: "1px solid #3a3a40",
              borderRadius: 10,
              boxShadow: "0 24px 70px rgba(0,0,0,0.65)",
            }}
          >
            <div
              style={{
                minHeight: 52,
                padding: "0 14px 0 18px",
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #2c2c31",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  id="controls-guide-title"
                  style={{ color: "#f3f4f6", fontSize: 16, fontWeight: 700 }}
                >
                  Controls & shortcuts
                </div>
                <div style={{ marginTop: 2, color: "#9299a5", fontSize: 11 }}>
                  A quick guide to editing the Vicksy overlay
                </div>
              </div>
              <button
                className="ui-icon-button"
                onClick={() => setOpen(false)}
                title="Close guide (Escape)"
                aria-label="Close controls guide"
                style={{
                  background: "#202024",
                  border: "1px solid #3b3b42",
                  color: "#d5d8df",
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              style={{
                overflowY: "auto",
                padding: 18,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                gap: 14,
              }}
            >
              {sections.map((section) => (
                <section
                  key={section.title}
                  style={{
                    padding: 13,
                    background: "#1b1b1e",
                    border: "1px solid #303036",
                    borderRadius: 8,
                  }}
                >
                  <h3
                    style={{
                      margin: "0 0 10px",
                      color: "var(--accent-text)",
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.045em",
                      textTransform: "uppercase",
                    }}
                  >
                    {section.title}
                  </h3>
                  <div style={{ display: "grid", gap: 9 }}>
                    {section.items.map(([control, description]) => (
                      <div
                        key={control}
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "minmax(112px, 0.72fr) minmax(0, 1.4fr)",
                          gap: 10,
                          alignItems: "start",
                        }}
                      >
                        <kbd
                          style={{
                            minHeight: 24,
                            display: "inline-flex",
                            alignItems: "center",
                            width: "fit-content",
                            maxWidth: "100%",
                            padding: "3px 7px",
                            color: "#e7e9ed",
                            background: "#25252a",
                            border: "1px solid #44444c",
                            borderBottomWidth: 2,
                            borderRadius: 5,
                            fontFamily: "Inter, sans-serif",
                            fontSize: 10,
                            fontWeight: 700,
                            lineHeight: 1.35,
                          }}
                        >
                          {control}
                        </kbd>
                        <span
                          style={{
                            color: "#b4bac4",
                            fontSize: 11,
                            lineHeight: 1.45,
                          }}
                        >
                          {description}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
