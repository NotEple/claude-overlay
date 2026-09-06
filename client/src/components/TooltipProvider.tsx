import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface TooltipState {
  text: string;
  left: number;
  top: number;
  placement: "above" | "below";
}

const TOOLTIP_ID = "app-control-tooltip";
const EDGE_GAP = 10;

function convertTitle(element: Element) {
  const title = element.getAttribute("title")?.trim();
  if (!title) return;
  element.setAttribute("data-app-tooltip", title);
  const isControl = element.matches("button, a, input, select, textarea, [role='button']");
  const hasReadableText = Boolean(element.textContent?.trim());
  if (
    isControl &&
    !hasReadableText &&
    (!element.hasAttribute("aria-label") || element.hasAttribute("data-tooltip-label"))
  ) {
    element.setAttribute("aria-label", title);
    element.setAttribute("data-tooltip-label", "true");
  }
  element.removeAttribute("title");
}

/**
 * Turns existing title descriptions into one accessible, consistently styled
 * tooltip. Event delegation also covers controls created after initial render.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeTarget = useRef<Element | null>(null);
  const showTimer = useRef<number | null>(null);
  const tooltipElement = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    document.querySelectorAll("[title]").forEach(convertTitle);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") convertTitle(record.target as Element);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          convertTitle(node);
          node.querySelectorAll("[title]").forEach(convertTitle);
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title"],
    });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = tooltipElement.current;
    if (!element || !tooltip) return;
    element.style.left = `${tooltip.left}px`;
    const rect = element.getBoundingClientRect();
    const correction =
      rect.left < EDGE_GAP
        ? EDGE_GAP - rect.left
        : rect.right > window.innerWidth - EDGE_GAP
          ? window.innerWidth - EDGE_GAP - rect.right
          : 0;
    element.style.left = `${tooltip.left + correction}px`;
  }, [tooltip]);

  useEffect(() => {
    const clearTimer = () => {
      if (showTimer.current !== null) window.clearTimeout(showTimer.current);
      showTimer.current = null;
    };
    const hide = () => {
      clearTimer();
      activeTarget.current?.removeAttribute("aria-describedby");
      activeTarget.current = null;
      setTooltip(null);
    };
    const show = (target: Element, delayed: boolean) => {
      const text = target.getAttribute("data-app-tooltip")?.trim();
      if (!text) return;
      clearTimer();
      const display = () => {
        activeTarget.current?.removeAttribute("aria-describedby");
        activeTarget.current = target;
        target.setAttribute("aria-describedby", TOOLTIP_ID);
        const rect = target.getBoundingClientRect();
        const placement = rect.top > 90 ? "above" : "below";
        setTooltip({
          text,
          left: rect.left + rect.width / 2,
          top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
          placement,
        });
      };
      if (delayed) showTimer.current = window.setTimeout(display, 350);
      else display();
    };
    const tooltipTarget = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest("[data-app-tooltip]")
        : null;
    const onPointerOver = (event: PointerEvent) => {
      const target = tooltipTarget(event);
      if (target && target !== activeTarget.current) show(target, true);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = tooltipTarget(event);
      if (!target) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = tooltipTarget(event);
      if (target) show(target, false);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (tooltipTarget(event)) hide();
    };
    const onViewportChange = () => hide();

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      hide();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, []);

  return (
    <>
      {children}
      {tooltip &&
        createPortal(
          <div
            ref={tooltipElement}
            id={TOOLTIP_ID}
            role="tooltip"
            className={`app-tooltip app-tooltip--${tooltip.placement}`}
            style={{ left: tooltip.left, top: tooltip.top }}
          >
            {tooltip.text}
          </div>,
          document.body,
        )}
    </>
  );
}
