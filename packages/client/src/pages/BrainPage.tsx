import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  RefreshCw,
  Search,
  Network,
  Lightbulb,
  ScrollText,
  Save,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";
import { cn } from "../lib/cn";
import { API } from "../lib/api";
import { useProjects } from "../state/ProjectContext";

type BrainScope = "global" | "project";

interface BrainRecord {
  id: string;
  store: string;
  shelf: string;
  title: string;
  confidence: number;
  samples: number;
  category: string | null;
  harness: string | null;
  approved?: boolean;
}

interface GraphFile {
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ id: string; type: string; from: string; to: string; strength: number }>;
}

const TABS = [
  { id: "soul", label: "soul.md", icon: ScrollText },
  { id: "records", label: "Records", icon: FileText },
  { id: "graph", label: "Graph", icon: Network },
  { id: "insights", label: "Insights", icon: Lightbulb },
] as const;

type TabId = (typeof TABS)[number]["id"];

const STORES = ["user", "task"];
const SHELVES = [
  "preferences",
  "patterns",
  "rules",
  "failures",
  "strategies",
  "routing",
];

export function BrainPage() {
  const { activeProjectId } = useProjects();
  const [scope, setScope] = useState<BrainScope>("project");
  const [tab, setTab] = useState<TabId>("soul");

  /* ---------------- soul.md ---------------- */
  const [soul, setSoul] = useState("");
  const [soulDirty, setSoulDirty] = useState(false);
  const [soulBusy, setSoulBusy] = useState(false);
  const [soulError, setSoulError] = useState<string | null>(null);

  const loadSoul = useCallback(async () => {
    setSoulBusy(true);
    setSoulError(null);
    try {
      const data = await API.get<{ content?: string }>(
        `/api/brain/soul/${scope}${activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ""}`,
      );
      setSoul(data.content ?? "");
      setSoulDirty(false);
    } catch (err) {
      setSoulError(err instanceof Error ? err.message : "Could not load soul.md");
    } finally {
      setSoulBusy(false);
    }
  }, [scope, activeProjectId]);

  const saveSoul = useCallback(async () => {
    setSoulBusy(true);
    setSoulError(null);
    try {
      await API.put(
        `/api/brain/soul/${scope}${activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ""}`,
        { content: soul },
      );
      setSoulDirty(false);
    } catch (err) {
      setSoulError(err instanceof Error ? err.message : "Could not save soul.md");
    } finally {
      setSoulBusy(false);
    }
  }, [soul, scope, activeProjectId]);

  useEffect(() => {
    if (tab !== "soul") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSoul();
  }, [tab, loadSoul]);

  /* ---------------- records ---------------- */
  const [records, setRecords] = useState<BrainRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("");
  const [shelfFilter, setShelfFilter] = useState("");
  const [query, setQuery] = useState("");

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    setRecordsError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (storeFilter) params.set("store", storeFilter);
      if (shelfFilter) params.set("shelf", shelfFilter);
      if (query.trim()) params.set("q", query.trim());
      if (activeProjectId) params.set("projectId", activeProjectId);
      const data = await API.get<BrainRecord[]>(`/api/brain/records?${params}`);
      setRecords(data);
    } catch (err) {
      setRecordsError(err instanceof Error ? err.message : "Could not load records");
    } finally {
      setRecordsLoading(false);
    }
  }, [storeFilter, shelfFilter, query, activeProjectId]);

  useEffect(() => {
    if (tab !== "records") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRecords();
  }, [tab, loadRecords]);

  /* ---------------- graph + insights ---------------- */
  const [graph, setGraph] = useState<GraphFile | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [insightQuery, setInsightQuery] = useState("");
  const [insights, setInsights] = useState<GraphFile["nodes"]>([]);
  const [insightsBusy, setInsightsBusy] = useState(false);

  const loadGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const params = new URLSearchParams();
      if (activeProjectId) params.set("projectId", activeProjectId);
      setGraph(await API.get<GraphFile>(`/api/brain/graph?${params}`));
    } catch (err) {
      setGraphError(err instanceof Error ? err.message : "Could not load the graph");
    } finally {
      setGraphLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (tab !== "graph" || graph) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGraph();
  }, [tab, graph, loadGraph]);

  const loadInsights = useCallback(async () => {
    if (!insightQuery.trim()) return;
    setInsightsBusy(true);
    try {
      // Insights are a traversal from the best-matching seed node; search
      // first for the seed, then traverse one hop from each hit.
      const params = new URLSearchParams({ q: insightQuery.trim(), limit: "5" });
      if (activeProjectId) params.set("projectId", activeProjectId);
      const hits = await API.get<{ nodes: GraphFile["nodes"] }>(
        `/api/brain/insights?${params}`,
      );
      setInsights(hits.nodes ?? []);
    } catch {
      setInsights([]);
    } finally {
      setInsightsBusy(false);
    }
  }, [insightQuery, activeProjectId]);

  const projectSuffix = useMemo(
    () => (activeProjectId ? " · this project" : ""),
    [activeProjectId],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Inspect"
          title="Second Brain"
          description={`What Hive has learned about you and your work${projectSuffix} — edit soul.md directly, browse the record stores, walk the knowledge graph.`}
          actions={
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as BrainScope)}
              className="w-36"
              aria-label="Memory scope"
            >
              <option value="global">Global scope</option>
              <option value="project">Project scope</option>
            </Select>
          }
        />
      </div>

      <div className="px-6 pb-3 flex items-center gap-1 border-b border-line">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] transition-colors",
              tab === id
                ? "bg-accent-soft text-ink font-medium"
                : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl">
          {tab === "soul" ? (
            <Card>
              <CardHeader
                title={`soul.md (${scope})`}
                actions={
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void loadSoul()} disabled={soulBusy}>
                      <RefreshCw className={cn("size-3.5", soulBusy && "animate-spin")} />
                      Reload
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void saveSoul()}
                      disabled={!soulDirty || soulBusy}
                    >
                      <Save className="size-3.5" />
                      Save
                    </Button>
                  </div>
                }
              />
              <div className="p-4 flex flex-col gap-3">
                {soulError ? (
                  <div className="px-3 py-2 rounded-md border border-danger bg-danger-soft text-[12px] text-danger">
                    {soulError}
                  </div>
                ) : null}
                <Textarea
                  value={soul}
                  onChange={(e) => {
                    setSoul(e.target.value);
                    setSoulDirty(true);
                  }}
                  placeholder="soul.md is empty so far — run tasks and approve suggestions, or write your own standing preferences here."
                  className="font-mono text-[12px] min-h-[420px]"
                  disabled={soulBusy}
                />
                {soulDirty ? (
                  <p className="text-[11px] text-warn">Unsaved changes.</p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {tab === "records" ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-end gap-2 flex-wrap">
                <Field label="Store" className="w-32">
                  {(id) => (
                    <Select
                      id={id}
                      value={storeFilter}
                      onChange={(e) => setStoreFilter(e.target.value)}
                    >
                      <option value="">All</option>
                      {STORES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Shelf" className="w-40">
                  {(id) => (
                    <Select
                      id={id}
                      value={shelfFilter}
                      onChange={(e) => setShelfFilter(e.target.value)}
                    >
                      <option value="">All</option>
                      {SHELVES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Search" className="flex-1 min-w-[12rem] max-w-sm">
                  {(id) => (
                    <Input
                      id={id}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search titles…"
                    />
                  )}
                </Field>
                <Button size="md" onClick={() => void loadRecords()} disabled={recordsLoading}>
                  <Search className="size-4" />
                  {recordsLoading ? "Loading…" : "Apply"}
                </Button>
              </div>

              {recordsError ? (
                <div className="px-3 py-2 rounded-md border border-danger bg-danger-soft text-[13px] text-danger">
                  {recordsError}
                </div>
              ) : null}

              {records.length === 0 && !recordsLoading ? (
                <Card>
                  <EmptyState
                    icon={<FileText />}
                    title="No records yet"
                    description="Records appear as Hive observes your tasks — routing outcomes, failures, corrections."
                  />
                </Card>
              ) : (
                <div className="flex flex-col gap-2">
                  {records.map((r) => (
                    <Card key={`${r.store}/${r.shelf}/${r.id}`} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] text-ink">{r.title}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge>{r.store}/{r.shelf}</Badge>
                            {r.category ? <Badge tone="info">{r.category}</Badge> : null}
                            {r.harness ? <Badge tone="neutral">{r.harness}</Badge> : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-right font-mono text-[11px] text-faint" data-numeric>
                          <div>conf {r.confidence.toFixed(2)}</div>
                          <div>{r.samples} obs</div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {tab === "graph" ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted">
                  {graph
                    ? `${graph.nodes.length} nodes · ${graph.edges.length} edges`
                    : "Loading…"}
                </span>
                <Button size="sm" onClick={() => { setGraph(null); }} disabled={graphLoading}>
                  <RefreshCw className={cn("size-3.5", graphLoading && "animate-spin")} />
                  Refresh
                </Button>
              </div>

              {graphError ? (
                <div className="px-3 py-2 rounded-md border border-danger bg-danger-soft text-[13px] text-danger">
                  {graphError}
                </div>
              ) : null}

              {graph && graph.nodes.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<Network />}
                    title="The graph is empty"
                    description="Edges form as tasks run — categories link to harness performance and learned patterns."
                  />
                </Card>
              ) : null}

              {graph?.nodes.map((n) => {
                const out = graph.edges.filter((e) => e.from === n.id);
                return (
                  <Card key={n.id} className="p-3">
                    <div className="flex items-center gap-2">
                      <Badge tone="info">{n.type}</Badge>
                      <span className="text-[13px] text-ink truncate">{n.label}</span>
                      <span className="ml-auto font-mono text-[10px] text-faint shrink-0">
                        {out.length} edge{out.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {out.length > 0 ? (
                      <ul className="mt-2 ml-1 flex flex-col gap-0.5">
                        {out.slice(0, 5).map((e) => {
                          const target = graph.nodes.find((t) => t.id === e.to);
                          return (
                            <li key={e.id} className="font-mono text-[11px] text-muted truncate">
                              → {target?.label ?? e.to}
                              <span className="text-faint"> ({e.strength.toFixed(2)})</span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          ) : null}

          {tab === "insights" ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-end gap-2">
                <Field label="Seed concept" hint="Traverses the graph from matching nodes." className="flex-1 max-w-md">
                  {(id) => (
                    <Input
                      id={id}
                      value={insightQuery}
                      onChange={(e) => setInsightQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void loadInsights()}
                      placeholder="testing, refactors, commit style…"
                    />
                  )}
                </Field>
                <Button onClick={() => void loadInsights()} disabled={insightsBusy || !insightQuery.trim()}>
                  <Lightbulb className="size-4" />
                  {insightsBusy ? "Searching…" : "Find insights"}
                </Button>
              </div>

              {insights.length === 0 && !insightsBusy ? (
                <Card>
                  <EmptyState
                    icon={<Lightbulb />}
                    title="Nothing to show"
                    description="Enter a concept above — matches are ranked by how strongly the graph links back to them."
                  />
                </Card>
              ) : (
                insights.map((n) => (
                  <Card key={n.id} className="p-3">
                    <div className="flex items-center gap-2">
                      <Badge tone="accent">{n.type}</Badge>
                      <span className="text-[13px] text-ink">{n.label}</span>
                    </div>
                  </Card>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default BrainPage;
