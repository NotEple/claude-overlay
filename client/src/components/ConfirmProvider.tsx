import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const close = useCallback((accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback<ConfirmFn>((nextOptions) => {
    resolver.current?.(false);
    setOptions(nextOptions);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (!options) return;
    cancelButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, options]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && createPortal(
        <div className="confirm-backdrop" onMouseDown={() => close(false)}>
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <span className={options.danger ? "danger" : ""}><CircleAlert size={18} /></span>
              <h2 id="confirm-title">{options.title}</h2>
              <button className="ui-icon-button confirm-dialog__close" onClick={() => close(false)} title="Close confirmation"><X size={15} /></button>
            </header>
            <p id="confirm-message">{options.message}</p>
            <footer>
              <button ref={cancelButton} className="ui-button confirm-dialog__cancel" onClick={() => close(false)}>Cancel</button>
              <button
                className={`ui-button ${options.danger ? "ui-danger" : "studio-primary"}`}
                onClick={() => close(true)}
              >
                {options.confirmLabel ?? "Confirm"}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </ConfirmContext.Provider>
  );
}
