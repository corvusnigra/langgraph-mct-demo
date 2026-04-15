"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

export type NotificationType = "error" | "warning" | "success" | "info";

export type Notification = {
  id: string;
  type: NotificationType;
  message: string;
  /** Ссылка (необязательно) */
  action?: { label: string; href: string };
  /** Авто-скрытие через N мс. 0 = не скрывать. По умолчанию 5000. */
  duration?: number;
};

type NotifyOptions = Omit<Notification, "id">;

type NotificationsCtx = {
  notify: (opts: NotifyOptions) => string;
  dismiss: (id: string) => void;
};

const Ctx = createContext<NotificationsCtx>({
  notify: () => "",
  dismiss: () => {},
});

export function useNotify() {
  return useContext(Ctx);
}

const ICONS: Record<NotificationType, string> = {
  error: "✕",
  warning: "⚠",
  success: "✓",
  info: "ℹ",
};

const COLORS: Record<NotificationType, { bg: string; border: string; text: string }> = {
  error:   { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)", text: "#f87171" },
  warning: { bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.3)",  text: "#f59e0b" },
  success: { bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.3)",  text: "#4ade80" },
  info:    { bg: "rgba(91,159,212,0.12)",  border: "rgba(91,159,212,0.3)",  text: "#5b9fd4" },
};

function Toast({ n, onDismiss }: { n: Notification; onDismiss: () => void }) {
  const c = COLORS[n.type];
  return (
    <div
      className="toast"
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: "#e8edf4",
      }}
      role="alert"
    >
      <span className="toast__icon" style={{ color: c.text }}>{ICONS[n.type]}</span>
      <span className="toast__msg">
        {n.message}
        {n.action && (
          <>
            {" "}
            <a
              href={n.action.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: c.text, textDecoration: "underline" }}
            >
              {n.action.label} →
            </a>
          </>
        )}
      </span>
      <button
        type="button"
        className="toast__close"
        onClick={onDismiss}
        aria-label="Закрыть"
      >✕</button>
    </div>
  );
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const notify = useCallback((opts: NotifyOptions): string => {
    const id = crypto.randomUUID();
    const duration = opts.duration ?? 5000;
    setItems((prev) => [...prev, { ...opts, id }]);
    if (duration > 0) {
      const t = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, t);
    }
    return id;
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ notify, dismiss }}>
      {children}
      {items.length > 0 && (
        <div className="toast-container" aria-live="polite" aria-atomic="false">
          {items.map((n) => (
            <Toast key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}
