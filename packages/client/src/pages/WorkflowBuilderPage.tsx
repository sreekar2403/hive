import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  GitBranch,
  LayoutGrid,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../components/ui";
import { useProjects } from "../state/ProjectContext";
import { cn } from "../lib/cn";
import { Palette, PALETTE_DRAG_MIME } from "./workflow/Palette";
import { Inspector } from "./workflow/Inspector";
import { nodeTypes } from "./workflow/nodes";
import { nodeDef } from "./workflow/nodeDefs";
import { autoLayout } from "./workflow/autoLayout";
import { validateWorkflow } from "./workflow/validate";
import { useHistory } from "./workflow/useHistory";
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  sanitizeEdges,
  sanitizeNodes,
  updateWorkflow,
} from "./workflow/api";
import type {
  HiveEdge,
  HiveNode,
  HiveNodeData,
  HiveNodeKind,
  WorkflowRecord,
} from "./workflow/types";
import "./workflow/flow.css";

type SaveState = "idle" | "saving" | "saved";

let nodeSeq = 0;
const nextNodeId = () =>
  `n${Date.now().toString(36)}${(nodeSeq++).toString(36)}`;

function WorkflowCanvas() {
  const { activeProject, activeProjectId } = useProjects();
  const { screenToFlowPosition } = useReactFlow();

  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<HiveNode[]>([]);
  const [edges, setEdges] = useState<HiveEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showIssues, setShowIssues] = useState(true);

  const history = useHistory<HiveNode, HiveEdge>();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppresses autosave while we're loading a workflow into the canvas.
  const hydrating = useRef(false);

  const current = workflows.find((w) => w.id === currentId) ?? null;
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const issues = useMemo(() => validateWorkflow(nodes, edges), [nodes, edges]);

  /* ---------------- load ---------------- */

  /* eslint-disable react-hooks/set-state-in-effect -- loads server state into the canvas */
  useEffect(() => {
    if (!activeProjectId) {
      setWorkflows([]);
      setCurrentId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listWorkflows(activeProjectId)
      .then((list) => {
        if (cancelled) return;
        setWorkflows(list);
        setCurrentId((prev) =>
          prev && list.some((w) => w.id === prev)
            ? prev
            : (list[0]?.id ?? null),
        );
      })
      .catch(() => !cancelled && setWorkflows([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!current) {
      setNodes([]);
      setEdges([]);
      return;
    }
    hydrating.current = true;
    setNodes(current.nodes ?? []);
    setEdges(current.edges ?? []);
    setSelectedId(null);
    history.reset();
    // Let the state settle before autosave is allowed to fire again.
    const t = setTimeout(() => {
      hydrating.current = false;
    }, 0);
    return () => clearTimeout(t);
    // history is a stable ref-backed API; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---------------- autosave ---------------- */

  useEffect(() => {
    if (!currentId || hydrating.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(() => {
      updateWorkflow(currentId, {
        nodes: sanitizeNodes(nodes),
        edges: sanitizeEdges(edges),
      })
        .then(() => {
          setSaveState("saved");
          setTimeout(() => setSaveState("idle"), 1600);
        })
        .catch(() => setSaveState("idle"));
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, currentId]);

  /* ---------------- graph editing ---------------- */

  const snapshot = useCallback(() => ({ nodes, edges }), [nodes, edges]);

  const onNodesChange = useCallback((changes: NodeChange<HiveNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<HiveEdge>[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      history.record(snapshot());
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            data:
              connection.sourceHandle === "true" ||
              connection.sourceHandle === "false"
                ? { branch: connection.sourceHandle }
                : undefined,
            label:
              connection.sourceHandle === "true"
                ? "true"
                : connection.sourceHandle === "false"
                  ? "false"
                  : undefined,
          } as HiveEdge,
          eds,
        ),
      );
    },
    [history, snapshot],
  );

  const patchNode = useCallback((id: string, patch: Partial<HiveNodeData>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    );
  }, []);

  const removeNode = useCallback(
    (id: string) => {
      history.record(snapshot());
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((s) => (s === id ? null : s));
    },
    [history, snapshot],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(
        PALETTE_DRAG_MIME,
      ) as HiveNodeKind;
      if (!kind) return;
      const def = nodeDef(kind);
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      history.record(snapshot());
      const node = {
        id: nextNodeId(),
        type: kind,
        position: { x: position.x - 90, y: position.y - 30 },
        data: def.createData(),
      } as HiveNode;
      setNodes((nds) => [...nds, node]);
      setSelectedId(node.id);
    },
    [screenToFlowPosition, history, snapshot],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const doAutoLayout = useCallback(() => {
    history.record(snapshot());
    setNodes((nds) => autoLayout(nds, edges));
  }, [edges, history, snapshot]);

  const doUndo = useCallback(() => {
    const prev = history.undo(snapshot());
    if (!prev) return;
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [history, snapshot]);

  const doRedo = useCallback(() => {
    const next = history.redo(snapshot());
    if (!next) return;
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [history, snapshot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  /* ---------------- workflow management ---------------- */

  async function handleCreate() {
    if (!activeProjectId || !newName.trim()) return;
    const created = await createWorkflow({
      name: newName.trim(),
      projectId: activeProjectId,
      nodes: [],
      edges: [],
    });
    setWorkflows((w) => [created, ...w]);
    setCurrentId(created.id);
    setNewName("");
    setCreating(false);
  }

  async function handleDelete() {
    if (!currentId) return;
    await deleteWorkflow(currentId);
    setWorkflows((w) => w.filter((x) => x.id !== currentId));
    setCurrentId(null);
  }

  /* ---------------- render ---------------- */

  if (!activeProject) {
    return (
      <div className="p-6 h-full flex flex-col">
        <PageHeader eyebrow="Direct" title="Workflows" />
        <EmptyState
          icon={<GitBranch />}
          title="No project selected"
          description="Pick a project from the switcher above to build workflows for it."
        />
      </div>
    );
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Direct"
          title="Workflows"
          description="Chain agents, gates, and approvals into a repeatable run."
          actions={
            <div className="flex items-center gap-2">
              {saveState !== "idle" ? (
                <span className="text-[12px] text-muted">
                  {saveState === "saving" ? "Saving…" : "Saved"}
                </span>
              ) : null}
              <Select
                value={currentId ?? ""}
                onChange={(e) => setCurrentId(e.target.value || null)}
                className="w-52"
                aria-label="Select workflow"
              >
                {workflows.length === 0 ? (
                  <option value="">No workflows yet</option>
                ) : null}
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New
              </Button>
            </div>
          }
        />
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted">
          Loading workflows…
        </div>
      ) : !current ? (
        <EmptyState
          icon={<GitBranch />}
          title="No workflows yet"
          description="A workflow chains agent steps, branches, and approvals into something you can run on a schedule."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Create workflow
            </Button>
          }
        />
      ) : (
        <div className="flex-1 min-h-0 flex border-t border-line">
          <div className="w-52 shrink-0 border-r border-line overflow-y-auto bg-surface">
            <Palette />
          </div>

          <div
            className="flex-1 min-w-0 relative"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 p-0.5 bg-surface border border-line rounded-md shadow-card">
                <IconButton
                  size="sm"
                  onClick={doUndo}
                  disabled={!history.canUndo}
                  aria-label="Undo"
                >
                  <Undo2 className="size-3.5" />
                </IconButton>
                <IconButton
                  size="sm"
                  onClick={doRedo}
                  disabled={!history.canRedo}
                  aria-label="Redo"
                >
                  <Redo2 className="size-3.5" />
                </IconButton>
                <IconButton
                  size="sm"
                  onClick={doAutoLayout}
                  aria-label="Tidy layout"
                >
                  <LayoutGrid className="size-3.5" />
                </IconButton>
              </div>
              <IconButton
                size="sm"
                variant="danger"
                onClick={handleDelete}
                aria-label="Delete workflow"
                className="bg-surface border-line shadow-card"
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>

            {issues.length > 0 && showIssues ? (
              <div className="absolute bottom-3 left-3 z-10 w-80 bg-surface border border-line rounded-lg shadow-pop overflow-hidden">
                <button
                  onClick={() => setShowIssues(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 border-b border-line hover:bg-surface-2 transition-colors"
                >
                  <AlertTriangle
                    className={cn(
                      "size-3.5",
                      errorCount ? "text-danger" : "text-warn",
                    )}
                  />
                  <span className="text-[12px] font-medium text-ink">
                    {errorCount > 0
                      ? `${errorCount} problem${errorCount === 1 ? "" : "s"} to fix`
                      : `${issues.length} suggestion${issues.length === 1 ? "" : "s"}`}
                  </span>
                  <span className="ml-auto text-[11px] text-faint">Hide</span>
                </button>
                <ul className="max-h-40 overflow-y-auto py-1">
                  {issues.map((issue, i) => (
                    <li
                      key={i}
                      className="px-3 py-1.5 text-[12px] text-muted flex items-start gap-2"
                    >
                      <Badge
                        tone={issue.severity === "error" ? "danger" : "warn"}
                      >
                        {issue.severity}
                      </Badge>
                      <span className="min-w-0">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {issues.length > 0 && !showIssues ? (
              <button
                onClick={() => setShowIssues(true)}
                className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-line rounded-md shadow-card text-[12px] text-muted hover:text-ink"
              >
                <AlertTriangle
                  className={cn(
                    "size-3.5",
                    errorCount ? "text-danger" : "text-warn",
                  )}
                />
                {issues.length}
              </button>
            ) : null}

            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStart={() => history.record(snapshot())}
              onSelectionChange={({ nodes: sel }) =>
                setSelectedId(sel.length === 1 ? sel[0].id : null)
              }
              defaultEdgeOptions={{ type: "smoothstep" }}
              className="hive-flow"
              snapToGrid
              snapGrid={[16, 16]}
              fitView
              // Without a max, fitView zooms a two-node graph to 2x and the
              // cards render enormous.
              fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.75}
              proOptions={{ hideAttribution: true }}
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={1}
                color="var(--hive-border)"
              />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                maskColor="var(--hive-accent-soft)"
                bgColor="var(--hive-surface-2)"
                nodeColor="var(--hive-border-strong)"
                nodeStrokeWidth={0}
              />
            </ReactFlow>
          </div>

          <div className="w-72 shrink-0 border-l border-line bg-surface overflow-hidden">
            <Inspector
              node={selected}
              onChange={patchNode}
              onDelete={removeNode}
            />
          </div>
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New workflow"
        description={`Created in ${activeProject.name}.`}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Create workflow
            </Button>
          </>
        }
      >
        <Field label="Name" required>
          {(id) => (
            <Input
              id={id}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nightly test sweep"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          )}
        </Field>
      </Modal>
    </div>
  );
}

export function WorkflowBuilderPage() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas />
    </ReactFlowProvider>
  );
}
