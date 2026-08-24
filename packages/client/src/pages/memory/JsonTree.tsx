import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

/** Anything JSON.parse can produce. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const INDENT_PX = 14;

function JsonPrimitive({ value }: { value: string | number | boolean | null }) {
  if (value === null) {
    return <span className="text-faint italic">null</span>;
  }
  if (typeof value === "string") {
    return <span className="text-ok break-all">&quot;{value}&quot;</span>;
  }
  if (typeof value === "number") {
    return (
      <span className="text-info" data-numeric>
        {value}
      </span>
    );
  }
  return <span className="text-warn">{String(value)}</span>;
}

function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return value !== null && typeof value === "object";
}

/** One node in the tree: a key/index label plus its (possibly nested) value. */
function JsonNode({
  label,
  value,
  depth,
}: {
  label?: string;
  value: JsonValue;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const indent = { paddingLeft: depth * INDENT_PX };

  if (!isContainer(value)) {
    return (
      <div className="flex items-start gap-1.5 py-0.5 text-[13px] font-mono leading-relaxed" style={indent}>
        {label !== undefined ? <span className="text-muted shrink-0">{label}:</span> : null}
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, JsonValue]> = isArray
    ? value.map((item, i) => [String(i), item] as [string, JsonValue])
    : Object.entries(value);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const countLabel = `${entries.length} ${isArray ? "item" : "key"}${entries.length === 1 ? "" : "s"}`;

  return (
    <div className="text-[13px] font-mono leading-relaxed">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 rounded-sm py-0.5 text-left hover:bg-surface-2"
        style={indent}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-faint" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-faint" aria-hidden="true" />
        )}
        {label !== undefined ? <span className="text-muted">{label}:</span> : null}
        <span className="text-faint">{openBracket}</span>
        {!open ? (
          <>
            <span className="text-faint italic">{countLabel}</span>
            <span className="text-faint">{closeBracket}</span>
          </>
        ) : entries.length === 0 ? (
          <span className="text-faint">{closeBracket}</span>
        ) : null}
      </button>
      {open && entries.length > 0 ? (
        <div>
          {entries.map(([key, child]) => (
            <JsonNode key={key} label={key} value={child} depth={depth + 1} />
          ))}
          <div className="text-faint font-mono text-[13px]" style={indent}>
            {closeBracket}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Expandable/collapsible JSON viewer with syntax colouring from design
 * tokens (strings `text-ok`, numbers `text-info`, booleans `text-warn`,
 * null `text-faint`). Top two levels open by default.
 */
export function JsonTree({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={cn("select-text", className)}>
      <JsonNode value={value as JsonValue} depth={0} />
    </div>
  );
}
