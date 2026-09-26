// Primitivas de UI del host. Todo lo interactivo lleva `data-nav` para que se
// pueda manejar con mando.

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { NavAction } from "../api/types";
import { useApp } from "../store/app";
import { Hints } from "./Hints";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "ghost" | "soft" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode; size?: "sm" | "md" | "lg" }
>(function Button({ variant = "soft", icon, size = "md", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      data-nav
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[calc(var(--h-radius)*0.7)] font-medium whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none cursor-pointer",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        variant === "primary" && "bg-accent text-accent-contrast hover:brightness-110",
        variant === "soft" && "bg-surface-3 text-fg hover:brightness-125",
        variant === "ghost" && "text-fg hover:bg-surface-3",
        variant === "danger" && "bg-red-500/15 text-red-300 hover:bg-red-500/25",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      data-nav
      aria-label={label}
      title={label}
      {...rest}
      className={cx("grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-fg cursor-pointer", className)}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      data-nav
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-4 rounded-[calc(var(--h-radius)*0.7)] px-3 py-2.5 text-left hover:bg-surface-3/60 cursor-pointer disabled:opacity-40"
    >
      <span className="flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
      </span>
      <span
        className={cx(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-surface-3 ring-1 ring-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block px-3 py-2">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      data-nav
      {...rest}
      className={cx(
        "h-10 w-full rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 px-3 text-sm text-fg outline-none ring-1 ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-accent",
        className,
      )}
    />
  );
});

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: ReactNode;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{format ? format(value) : value}</span>
      </div>
      <input
        data-nav
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[var(--h-accent)]"
        style={{ background: `linear-gradient(to right, var(--h-accent) ${pct}%, var(--h-surface-3) ${pct}%)` }}
      />
    </div>
  );
}

/** Selector que se maneja con izquierda/derecha (mando) o con clic (menú). */
export function Cycle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fn = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      const next = options[(idx + d + options.length) % options.length];
      if (next) onChange(next.value);
    };
    el.addEventListener("cycle", fn);
    return () => el.removeEventListener("cycle", fn);
  }, [idx, options, onChange]);
  return (
    <div className="relative flex items-center gap-4 px-3 py-2">
      <span className="flex-1 text-sm">{label}</span>
      <button
        ref={ref}
        data-nav
        data-cycle
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 min-w-44 items-center justify-between gap-3 rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 px-3 text-sm ring-1 ring-line cursor-pointer"
      >
        <span className="text-muted">‹</span>
        <span className="truncate">{options[idx]?.label ?? "—"}</span>
        <span className="text-muted">›</span>
      </button>
      {open && (
        <div
          className="absolute right-3 top-12 z-30 max-h-72 min-w-52 overflow-auto rounded-[calc(var(--h-radius)*0.7)] p-1 glass shadow-2xl"
          onMouseLeave={() => setOpen(false)}
        >
          {options.map((o) => (
            <button
              key={o.value}
              data-nav
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                ref.current?.focus();
              }}
              className={cx(
                "block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-3 cursor-pointer",
                o.value === value && "text-accent",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-3 py-2">
      <span className="flex-1 text-sm">{label}</span>
      <label
        data-nav
        tabIndex={0}
        className="relative flex h-9 items-center gap-2 rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 pl-1.5 pr-3 ring-1 ring-line cursor-pointer"
        onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.click()}
      >
        <span className="h-6 w-6 rounded-md ring-1 ring-white/20" style={{ background: value }} />
        <span className="font-mono text-xs text-muted uppercase">{value}</span>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 opacity-0 pointer-events-none"
          tabIndex={-1}
        />
      </label>
    </div>
  );
}

export function Section({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-5 rounded-[var(--h-radius)] bg-surface-2/70 p-2 ring-1 ring-line">
      {(title || actions) && (
        <header className="flex items-center justify-between px-3 pb-1 pt-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          data-nav
          data-tab
          data-autofocus={t.value === value || undefined}
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx(
            "flex h-10 items-center gap-3 rounded-[calc(var(--h-radius)*0.7)] px-3 text-left text-sm cursor-pointer",
            t.value === value ? "bg-accent/15 text-fg" : "text-muted hover:bg-surface-3 hover:text-fg",
          )}
        >
          <span className={t.value === value ? "text-accent" : ""}>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/** Contenedor de overlay: fondo difuminado + panel centrado. */
export const Modal = forwardRef<
  HTMLDivElement,
  {
    title?: ReactNode;
    onClose: () => void;
    children: ReactNode;
    width?: string;
    height?: string;
    className?: string;
    hideClose?: boolean;
    headerExtra?: ReactNode;
    hints?: [NavAction, string][];
  }
>(function Modal({ title, onClose, children, width = "min(1100px, 94vw)", height = "min(760px, 90vh)", className, hideClose, headerExtra, hints }, ref) {
  const source = useApp((s) => s.inputSource);
  const footer = hints ?? [
    ["accept", "Elegir"],
    ["back", "Cerrar"],
    ["lb", "Sección anterior"],
    ["rb", "Siguiente"],
  ];
  return (
    <div
      className="overlay-enter absolute inset-0 z-40 grid place-items-center bg-black/55 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        data-focus-trap
        className={cx("panel-enter glass flex flex-col overflow-hidden rounded-[calc(var(--h-radius)*1.4)] shadow-2xl", className)}
        style={{ width, height }}
      >
        {(title || !hideClose) && (
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
            <h2 className="flex-1 truncate text-base font-semibold">{title}</h2>
            {headerExtra}
            {!hideClose && (
              <IconButton label="Cerrar (Esc)" onClick={onClose}>
                <X size={18} />
              </IconButton>
            )}
          </header>
        )}
        <div className="min-h-0 flex-1">{children}</div>
        {source !== "mouse" && (
          <footer className="flex h-11 shrink-0 items-center justify-end border-t border-line px-5">
            <Hints items={footer} />
          </footer>
        )}
      </div>
    </div>
  );
});

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
      style={{ width: size, height: size }}
    />
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-muted">
      <div className="opacity-60">{icon}</div>
      <div className="text-base text-fg">{title}</div>
      <div className="max-w-md text-sm">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-muted ring-1 ring-line">{children}</kbd>;
}
