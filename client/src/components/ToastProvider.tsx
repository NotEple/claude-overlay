import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { TooltipProvider } from "./TooltipProvider";
import { ConfirmProvider } from "./ConfirmProvider";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const noop = () => {};
const ToastContext = createContext<ToastApi>({ success: noop, error: noop, info: noop });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => show("success", message),
      error: (message) => show("error", message),
      info: (message) => show("info", message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      <ConfirmProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ConfirmProvider>
      <div className="toast-region" role="region" aria-label="Notifications">
        {toasts.map((toast) => {
          const Icon =
            toast.kind === "success"
              ? CheckCircle2
              : toast.kind === "error"
                ? CircleAlert
                : Info;
          return (
            <div
              key={toast.id}
              className={`app-toast app-toast--${toast.kind}`}
              role={toast.kind === "error" ? "alert" : "status"}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                title="Dismiss notification"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
