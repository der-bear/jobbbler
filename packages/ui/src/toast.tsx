"use client";

import { CheckCircle, Info, Warning, X } from "@phosphor-icons/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cx } from "./cx.js";

export type ToastTone = "success" | "info" | "warning" | "danger";

export interface ToastInput {
  readonly description?: string;
  readonly title: string;
  readonly tone?: ToastTone;
}

interface ToastRecord extends ToastInput {
  readonly id: number;
  readonly tone: ToastTone;
}

export interface ToastContextValue {
  readonly dismiss: (id: number) => void;
  readonly show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const TRANSIENT_TOAST_DURATION_MS = 5_000;

function ToastIcon({ tone }: { readonly tone: ToastTone }) {
  if (tone === "success") return <CheckCircle aria-hidden="true" weight="fill" />;
  if (tone === "warning" || tone === "danger") return <Warning aria-hidden="true" weight="fill" />;
  return <Info aria-hidden="true" weight="fill" />;
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextToastId = useRef(0);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    const timer = toastTimers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    toastTimers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const show = useCallback(
    (toast: ToastInput) => {
      nextToastId.current += 1;
      const id = nextToastId.current;
      const tone = toast.tone ?? "info";
      setToasts((current) => [...current, { ...toast, id, tone }]);
      if (tone === "success" || tone === "info") {
        toastTimers.current.set(
          id,
          setTimeout(() => dismiss(id), TRANSIENT_TOAST_DURATION_MS),
        );
      }
    },
    [dismiss],
  );
  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
    },
    [],
  );
  const value = useMemo(() => ({ dismiss, show }), [dismiss, show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-atomic="true" aria-live="polite" className="jb-toast-viewport">
        {toasts.map((toast) => (
          <div className={cx("jb-toast", `jb-toast--${toast.tone}`)} key={toast.id} role="status">
            <ToastIcon tone={toast.tone} />
            <div>
              <strong>{toast.title}</strong>
              {toast.description ? <p>{toast.description}</p> : null}
            </div>
            <button
              aria-label="Dismiss notification"
              className="jb-icon-button"
              onClick={() => dismiss(toast.id)}
              type="button"
            >
              <X aria-hidden="true" size={16} weight="bold" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context;
}
