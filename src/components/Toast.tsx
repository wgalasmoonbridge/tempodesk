import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export type ToastTone = "info" | "success" | "error" | "warning";

export interface ToastOptions {
  title: string;
  message?: string;
  tone?: ToastTone;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  pushToast: (options: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((options: ToastOptions) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((current) => [...current.slice(-3), { ...options, id }]);
    return id;
  }, []);

  const value = useMemo(
    () => ({ pushToast, dismissToast }),
    [pushToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toaster" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} dismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  dismiss,
}: {
  toast: ToastItem;
  dismiss: (id: number) => void;
}) {
  const { id, tone = "info", duration = toast.action ? 8000 : 5000 } = toast;

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(id), duration);
    return () => window.clearTimeout(timer);
  }, [id, duration, dismiss]);

  return (
    <div className={`toast ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <div className="toast-body">
        <strong>{toast.title}</strong>
        {toast.message ? <p>{toast.message}</p> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.onClick();
            dismiss(id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => dismiss(id)}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
