import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Check, Minus, X } from "lucide-react";
import { cn } from "../lib/cn";

/*
  Shared primitives for the Hive "Ledger" design system.
  Every screen composes these rather than hand-rolling Tailwind, so the
  app reads as one product. See src/index.css for the token definitions.
*/

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "default" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg border-transparent hover:bg-accent-hover font-medium",
  default:
    "bg-surface text-ink border-line hover:bg-surface-2 hover:border-line-strong",
  ghost: "bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-ink",
  danger:
    "bg-transparent text-danger border-line hover:bg-danger-soft hover:border-danger",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

/*
  Square sizes are kept separate rather than layering `px-0` over the
  padded variants: Tailwind resolves conflicting utilities by their order
  in the generated stylesheet, not in the class string, so `px-2.5` beat a
  later `px-0` and squeezed icons into an 8px box.
*/
const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
};

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md border whitespace-nowrap " +
  "transition-colors duration-100 disabled:opacity-45 disabled:pointer-events-none";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

/** Square icon-only button. Always pass an aria-label. */
export function IconButton({
  variant = "ghost",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        ICON_BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-lg",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-4 py-3 border-b border-line",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <div className="text-sm font-semibold text-ink truncate">{title}</div>
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page scaffolding                                                    */
/* ------------------------------------------------------------------ */

/**
 * Standard page header. Every screen opens with this so titles, spacing
 * and action placement stay identical across the app.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-6 mb-6">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h1 className="text-[22px] leading-tight font-semibold text-ink">
          {title}
        </h1>
        {description ? (
          <p className="text-[13px] text-muted mt-1.5 max-w-[68ch]">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2 shrink-0 pb-0.5">{actions}</div>
      ) : null}
    </div>
  );
}

/** Standard page padding wrapper. */
export function PageBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 h-full flex flex-col", className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/* Badge / status                                                      */
/* ------------------------------------------------------------------ */

type Tone = "neutral" | "accent" | "ok" | "info" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  ok: "bg-ok-soft text-ok border-transparent",
  info: "bg-info-soft text-info border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border rounded-sm px-1.5 py-0.5",
        "font-mono text-[10px] font-medium uppercase tracking-[0.08em]",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Small filled dot for live status. `pulse` marks in-flight work. */
export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  const color: Record<Tone, string> = {
    neutral: "bg-faint",
    accent: "bg-accent",
    ok: "bg-ok",
    info: "bg-info",
    warn: "bg-warn",
    danger: "bg-danger",
  };
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse ? (
        <span
          className={cn(
            "absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping",
            color[tone],
          )}
        />
      ) : null}
      <span className={cn("relative size-2 rounded-full", color[tone])} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

const FIELD_BASE =
  "w-full bg-surface border border-line rounded-md text-ink placeholder:text-faint " +
  "transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft " +
  "disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, "h-9 px-3 text-sm", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(FIELD_BASE, "px-3 py-2 text-sm resize-y", className)} {...props} />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD_BASE, "h-9 px-2.5 text-sm", className)} {...props} />
  );
}

/** Label + control + optional hint/error, with wiring handled for you. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-ink">
        {label}
        {required ? <span className="text-danger ml-0.5">*</span> : null}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/*
  Switch geometry is done with a transparent border as the inset rather
  than absolute positioning, because the previous version drove the knob
  with `absolute top-0.5` + `translate-x-[18px]`: `left` was left to the
  static position, so the travel was measured from wherever the inline
  box happened to start and the knob rode over the track's edge.

  Here the border *is* the padding, so with `box-sizing: border-box` the
  content box is exactly track − 2×inset. A knob sized to the content
  height therefore fits flush, and a translate of (content width − knob)
  lands it flush against the far edge — at any size, in any theme.
*/
const SWITCH_SIZES = {
  sm: {
    track: "h-4 w-7 border-2",
    knob: "size-3",
    travel: "translateX(12px)",
    glyph: "size-2",
  },
  md: {
    track: "h-5 w-9 border-2",
    knob: "size-4",
    travel: "translateX(16px)",
    glyph: "size-2.5",
  },
} as const;

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size = "md",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: keyof typeof SWITCH_SIZES;
}) {
  const geometry = SWITCH_SIZES[size];
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "group relative inline-flex items-center shrink-0 rounded-full",
          // The border is transparent and the background is *not* clipped to
          // the padding box, so the track paints edge to edge behind it.
          "border-transparent transition-colors duration-150",
          "disabled:opacity-45 disabled:pointer-events-none",
          geometry.track,
          // The ring draws the track's edge, so it can't crowd the knob the
          // way a real border would.
          checked
            ? "bg-accent ring-1 ring-inset ring-black/10"
            : "bg-surface-3 ring-1 ring-inset ring-line-strong hover:bg-surface-2",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none flex items-center justify-center rounded-full",
            "shadow-sm transition-transform duration-150",
            geometry.knob,
            checked ? "bg-accent-fg" : "bg-surface",
          )}
          style={{ transform: checked ? geometry.travel : "translateX(0)" }}
        >
          {/* On/off is carried by more than position, which matters at a
              glance and for anyone who can't separate the two colours. */}
          {checked ? (
            <Check className={cn(geometry.glyph, "text-accent")} strokeWidth={3.5} />
          ) : (
            <Minus className={cn(geometry.glyph, "text-faint")} strokeWidth={3.5} />
          )}
        </span>
      </button>
      <span className="text-[13px] text-ink select-none">{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs (uncontrolled-friendly, purely presentational)                 */
/* ------------------------------------------------------------------ */

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 p-0.5 bg-surface-2 border border-line rounded-md",
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "h-6 px-2.5 rounded-sm text-xs transition-colors whitespace-nowrap",
            value === opt.value
              ? "bg-surface text-ink shadow-sm font-medium"
              : "text-muted hover:text-ink",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

/**
 * Empty screens are an invitation to act, so this always takes an action
 * slot rather than only explaining that nothing is here.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex-1 flex flex-col items-center justify-center text-center px-6 py-12",
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 text-faint [&>svg]:size-6" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="text-[13px] text-muted mt-1 max-w-[46ch]">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) return null;

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full bg-surface border border-line rounded-xl shadow-pop outline-none",
          widths[width],
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description ? (
              <p className="text-[13px] text-muted mt-1">{description}</p>
            ) : null}
          </div>
          <IconButton size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="px-5 py-4 max-h-[65vh] overflow-y-auto">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-line">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
} | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

export { ThemeContext };
