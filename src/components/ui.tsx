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
import { useApp, useTelon } from "../store/app";
import { Hints } from "./Hints";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "ghost" | "soft" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode; size?: "sm" | "md" | "lg" }
>(function Button({ variant = "soft", icon, size = "md", className, children, ...rest }, ref) {
  const telon = useTelon();
  // Telón: el principal es un bloque blanco de esquinas pequeñas; los demás, solo texto.
  const flat = telon && variant !== "primary";
  return (
    <button
      ref={ref}
      data-nav
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none cursor-pointer",
        telon ? "rounded-[4px] font-normal" : "rounded-full font-semibold",
        size === "sm" && (flat ? "h-8 px-1.5 text-[13.5px]" : "h-8 px-3 text-[13px]"),
        size === "md" && (flat ? "h-10 px-1.5 text-[15px]" : "h-10 px-4 text-sm"),
        size === "lg" && (flat ? "h-12 px-2 text-base" : "h-12 px-6 text-base"),
        variant === "primary" && (telon ? "bg-fg text-surface font-semibold hover:brightness-95" : "bg-fg text-surface hover:brightness-95"),
        flat && variant !== "danger" && "text-fg/70 hover:text-fg hover:underline underline-offset-[6px]",
        flat && variant === "danger" && "text-red-300 hover:underline underline-offset-[6px]",
        !telon && variant === "soft" && "bg-surface-3 text-fg hover:brightness-125",
        !telon && variant === "ghost" && "text-fg hover:bg-surface-3",
        !telon && variant === "danger" && "bg-red-500/15 text-red-300 hover:bg-red-500/25",
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
  const telon = useTelon();
  return (
    <button
      data-nav
      aria-label={label}
      title={label}
      {...rest}
      className={cx("grid h-9 w-9 place-items-center rounded-full text-muted hover:text-fg cursor-pointer", !telon && "hover:bg-surface-3", className)}
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
  const telon = useTelon();
  if (telon)
    return (
      <button
        data-nav
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex min-h-[56px] w-full items-center gap-8 rounded-[4px] px-0 py-2.5 text-left cursor-pointer disabled:opacity-40"
      >
        <span className="flex-1">
          <span className="block text-[15.5px] font-normal">{label}</span>
          {hint && <span className="mt-0.5 block max-w-[560px] text-[13.5px] leading-snug text-muted">{hint}</span>}
        </span>
        {/* Interruptor de contorno: blanco y relleno cuando está encendido. */}
        <span className={cx("relative h-[22px] w-10 shrink-0 rounded-full transition-colors", checked ? "bg-fg" : "ring-[1.5px] ring-inset ring-fg/35")}>
          <span
            className={cx(
              "absolute top-1 h-[14px] w-[14px] rounded-full transition-transform",
              checked ? "translate-x-[22px] bg-surface" : "translate-x-1 bg-fg/55",
            )}
          />
        </span>
      </button>
    );
  return (
    <button
      data-nav
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[60px] w-full items-center gap-4 rounded-[calc(var(--h-radius)*0.7)] px-4 py-3 text-left hover:bg-surface-3/60 cursor-pointer disabled:opacity-40"
    >
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{hint}</span>}
      </span>
      <span
        className={cx(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-fg" : "bg-surface-3 ring-1 ring-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-5 w-5 rounded-full shadow transition-transform",
            checked ? "bg-surface" : "bg-muted",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const telon = useTelon();
  return (
    <label className={cx("block py-2", telon ? "px-0" : "px-3")}>
      <span className={cx("mb-1.5 block text-[13px] text-muted", telon ? "font-normal" : "font-semibold")}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  const telon = useTelon();
  return (
    <input
      ref={ref}
      data-nav
      {...rest}
      className={cx(
        telon
          ? "h-10 w-full rounded-none border-b border-fg/25 bg-transparent px-0 text-[15px] text-fg outline-none placeholder:text-muted/70 focus:border-fg"
          : "h-10 w-full rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 px-3 text-sm text-fg outline-none ring-1 ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-fg",
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
  const telon = useTelon();
  if (telon)
    return (
      <div className="flex min-h-[52px] items-center gap-8 py-2">
        <span className="flex-1 text-[15.5px]">{label}</span>
        <input
          data-nav
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="telon-range w-[220px] cursor-pointer"
          style={{ background: `linear-gradient(to right, var(--h-text) ${pct}%, color-mix(in srgb, var(--h-text) 20%, transparent) ${pct}%)` }}
        />
        <span className="w-16 text-right text-sm tabular-nums text-muted">{format ? format(value) : value}</span>
      </div>
    );
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
  const telon = useTelon();
  return (
    <div className={cx("relative flex items-center gap-4 py-2", telon ? "min-h-[52px] px-0" : "px-3")}>
      <span className={cx("flex-1", telon ? "text-[15.5px]" : "text-sm")}>{label}</span>
      {telon ? (
        // Telón: el valor escrito y una flecha, sin caja.
        <button ref={ref} data-nav data-cycle onClick={() => setOpen((o) => !o)} className="flex h-9 items-center gap-2 rounded-[4px] px-1 text-[15px] text-fg/85 hover:text-fg cursor-pointer">
          <span className="truncate">{options[idx]?.label ?? "—"}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" className="opacity-60" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      ) : (
        <button
          ref={ref}
          data-nav
          data-cycle
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 min-w-60 items-center justify-between gap-3 rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 px-3 text-sm ring-1 ring-line cursor-pointer"
        >
          <span className="text-muted">‹</span>
          <span className="truncate">{options[idx]?.label ?? "—"}</span>
          <span className="text-muted">›</span>
        </button>
      )}
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
  const telon = useTelon();
  // Telón: sin caja; el título es una etiqueta pequeña y las filas van sueltas.
  if (telon)
    return (
      <section className="mb-9">
        {(title || actions) && (
          <header className="mb-1 flex min-h-8 items-center justify-between gap-3">
            <h3 className="telon-label text-[13px] font-normal tracking-normal text-muted">{title}</h3>
            <div className="flex gap-4">{actions}</div>
          </header>
        )}
        <div>{children}</div>
      </section>
    );
  return (
    <section className="mb-8">
      {(title || actions) && (
        <header className="mb-2.5 flex min-h-9 items-center justify-between gap-3 px-1">
          <h3 className="text-[18px] font-bold tracking-tight">{title}</h3>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      <div className="rounded-[var(--h-radius)] bg-surface-2 p-1.5">{children}</div>
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
  const telon = useTelon();
  if (telon)
    return (
      // Telón: los apartados como texto, sin iconos ni fondo.
      <nav className="flex flex-col">
        {tabs.map((t) => (
          <button
            key={t.value}
            data-nav
            data-tab
            data-autofocus={t.value === value || undefined}
            aria-selected={t.value === value}
            onClick={() => onChange(t.value)}
            className={cx("flex h-10 items-center rounded-[4px] text-left text-[16px] font-normal cursor-pointer", t.value === value ? "text-fg" : "text-muted hover:text-fg")}
          >
            {t.label}
          </button>
        ))}
      </nav>
    );
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
            "flex h-11 items-center gap-3 rounded-[calc(var(--h-radius)*0.65)] px-3.5 text-left text-[15px] font-semibold cursor-pointer",
            t.value === value ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-3 hover:text-fg",
          )}
        >
          <span className={t.value === value ? "text-fg" : ""}>{t.icon}</span>
          {t.label}
          {/* La ranura del logo: la sección abierta. */}
          {t.value === value && <span className="ml-auto h-[18px] w-[5px] shrink-0 rounded-[1.5px] bg-accent" />}
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
  const telon = useTelon();
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
        className={cx("panel-enter glass flex flex-col overflow-hidden shadow-2xl", telon ? "rounded-[6px]" : "rounded-[calc(var(--h-radius)*1.4)]", className)}
        style={{ width, height }}
      >
        {(title || !hideClose) && (
          <header className={cx("flex shrink-0 items-center gap-3", telon ? "h-16 px-7" : "h-14 border-b border-line px-5")}>
            <h2 className={cx("flex-1 truncate", telon ? "text-[24px] font-light tracking-tight" : "text-base font-semibold")}>{title}</h2>
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
