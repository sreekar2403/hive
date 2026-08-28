import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "../../components/ui";
import { NODE_CATEGORIES, NODE_DEFS } from "./nodeDefs";

export const PALETTE_DRAG_MIME = "application/hive-node";

/**
 * Left rail: node types grouped by category, drag-to-canvas. Search filters
 * by label or description across both groups.
 */
export function Palette() {
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return NODE_CATEGORIES.map((category) => ({
      category,
      defs: NODE_DEFS.filter(
        (d) =>
          d.category === category &&
          (!q ||
            d.label.toLowerCase().includes(q) ||
            d.description.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.defs.length > 0);
  }, [search]);

  return (
    <aside className="w-64 shrink-0 border-r border-line bg-surface flex flex-col h-full">
      <div className="px-3 pt-3 pb-2.5 border-b border-line">
        <div className="eyebrow mb-2">Nodes</div>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-faint pointer-events-none"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes…"
            aria-label="Search node types"
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groups.length === 0 ? (
          <p className="text-[12px] text-muted px-1">
            No nodes match "{search}".
          </p>
        ) : (
          groups.map(({ category, defs }) => (
            <div key={category}>
              <div className="eyebrow mb-1.5 px-1">{category}</div>
              <div className="space-y-1">
                {defs.map((def) => (
                  <div
                    key={def.kind}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PALETTE_DRAG_MIME, def.kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group flex items-start gap-2.5 px-2.5 py-2 rounded-md border border-line bg-surface hover:border-line-strong hover:bg-surface-2 cursor-grab active:cursor-grabbing transition-colors"
                  >
                    <span className="flex items-center justify-center size-6 rounded-md bg-surface-2 text-muted group-hover:text-ink shrink-0">
                      <def.icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-ink">
                        {def.label}
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {def.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
