import { useEffect, useMemo, useRef, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import type { CanvasElement } from "../types";

const DISMISSED_KEY = "selection_hints_dismissed";

export function SelectionHint({
  elements,
  selectedIds,
}: {
  elements: CanvasElement[];
  selectedIds: Set<string>;
}) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === "true",
  );
  const [visible, setVisible] = useState(false);
  const lastShownSelection = useRef("");

  const selection = useMemo(
    () => elements.filter((element) => selectedIds.has(element.id)),
    [elements, selectedIds],
  );
  const grouped =
    selection.length > 1 &&
    !!selection[0]?.groupId &&
    selection.every((element) => element.groupId === selection[0].groupId);
  const kind = grouped
    ? "group"
    : selection.length > 1
      ? "multiple"
      : selection[0]?.type;
  const selectionSignature = [...selectedIds].sort().join(",");

  useEffect(() => {
    if (dismissed || !kind) {
      setVisible(false);
      if (!kind) lastShownSelection.current = "";
      return;
    }
    if (lastShownSelection.current === selectionSignature) return;
    lastShownSelection.current = selectionSignature;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 9000);
    return () => window.clearTimeout(timer);
  }, [dismissed, kind, selectionSignature]);

  if (!visible || !kind) return null;

  const specific = grouped
    ? "White handles rotate individual items · Accent handle rotates the whole group"
    : kind === "video"
      ? "Click video to play/pause · Drag its body to move"
      : kind === "audio"
        ? "Use its player controls · Soundboard clips do not need canvas layers"
        : kind === "text"
          ? "Double-click to edit text"
          : kind === "multiple"
            ? "Use Group in Layers to keep these items together"
            : "Drag to move · Use the handles to resize or rotate";

  const dismissForever = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
    setVisible(false);
  };

  return (
    <div
      role="status"
      style={{
        position: "absolute",
        left: 14,
        bottom: 14,
        zIndex: 9000,
        maxWidth: 620,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 9px",
        border: "1px solid #3a3a42",
        borderLeft: "3px solid var(--accent-border)",
        borderRadius: 7,
        background: "rgba(20,20,23,.96)",
        color: "#d5dae2",
        boxShadow: "0 8px 24px rgba(0,0,0,.38)",
        font: "500 11px Inter,sans-serif",
      }}
    >
      <Lightbulb size={14} color="var(--accent-text)" />
      <span style={{ lineHeight: 1.45 }}>
        {specific} · Alt disables snapping · Shift snaps rotation · Ctrl/Cmd+C copies · Delete removes
      </span>
      <button
        className="ui-button ui-button--compact"
        onClick={dismissForever}
        title="Permanently hide contextual selection hints; the shortcuts remain in the ? guide"
        style={{
          flexShrink: 0,
          height: 24,
          padding: "0 7px",
          border: "1px solid #3a3a42",
          background: "#252529",
          color: "#b8c0cc",
          cursor: "pointer",
          fontSize: 10,
        }}
      >
        Don’t show again
      </button>
      <button
        className="ui-icon-button ui-button--compact"
        onClick={() => setVisible(false)}
        title="Dismiss this hint"
        aria-label="Dismiss selection hint"
        style={{
          width: 24,
          height: 24,
          padding: 0,
          flexShrink: 0,
          border: "1px solid #3a3a42",
          background: "#252529",
          color: "#b8c0cc",
          cursor: "pointer",
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
