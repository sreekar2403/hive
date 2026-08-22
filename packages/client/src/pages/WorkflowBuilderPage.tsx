import {
  useState,
  useRef,
  useCallback,
  DragEvent,
  MouseEvent,
  useEffect,
} from "react";
import { Save, Play, Trash2, Plus, X, Download, Upload } from "lucide-react";

export type NodeType = "start" | "end" | "action" | "condition";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  title: string;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

const NODE_TYPES: {
  type: NodeType;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}[] = [
  {
    type: "start",
    label: "Start",
    color: "text-green-400",
    bgColor: "bg-green-900/30",
    borderColor: "border-green-500",
  },
  {
    type: "end",
    label: "End",
    color: "text-red-400",
    bgColor: "bg-red-900/30",
    borderColor: "border-red-500",
  },
  {
    type: "action",
    label: "Action",
    color: "text-blue-400",
    bgColor: "bg-blue-900/30",
    borderColor: "border-blue-500",
  },
  {
    type: "condition",
    label: "Condition",
    color: "text-yellow-400",
    bgColor: "bg-yellow-900/30",
    borderColor: "border-yellow-500",
  },
];

const generateId = () => Math.random().toString(36).substring(2, 9);

const getPortPosition = (
  node: WorkflowNode,
  isOutput: boolean,
  containerRect: DOMRect | null,
) => {
  const nodeWidth = 160;
  const nodeHeight = 60;
  const x = node.x + (isOutput ? nodeWidth : 0);
  const y = node.y + nodeHeight / 2;
  return { x, y };
};

const getEdgePath = (
  fromNode: WorkflowNode,
  toNode: WorkflowNode,
  containerRect: DOMRect | null,
) => {
  const from = getPortPosition(fromNode, true, containerRect);
  const to = getPortPosition(toNode, false, containerRect);

  const midX = (from.x + to.x) / 2;

  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
};

const getArrowHead = (
  fromNode: WorkflowNode,
  toNode: WorkflowNode,
  containerRect: DOMRect | null,
) => {
  const to = getPortPosition(toNode, false, containerRect);
  const from = getPortPosition(fromNode, true, containerRect);

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const arrowSize = 8;

  const x1 = to.x - arrowSize * Math.cos(angle - Math.PI / 6);
  const y1 = to.y - arrowSize * Math.sin(angle - Math.PI / 6);
  const x2 = to.x - arrowSize * Math.cos(angle + Math.PI / 6);
  const y2 = to.y - arrowSize * Math.sin(angle + Math.PI / 6);

  return `M ${to.x} ${to.y} L ${x1} ${y1} M ${to.x} ${to.y} L ${x2} ${y2}`;
};

export function WorkflowBuilderPage() {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    type: NodeType;
    x: number;
    y: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const nodeTypeConfig = (type: NodeType) =>
    NODE_TYPES.find((n) => n.type === type)!;

  const handleDragStart = useCallback((e: DragEvent, type: NodeType) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ type }));
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";

    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      setDragPreview({
        type: JSON.parse(e.dataTransfer.getData("application/json")).type,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragPreview(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragPreview(null);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const data = JSON.parse(e.dataTransfer.getData("application/json"));
    const type = data.type as NodeType;

    const newNode: WorkflowNode = {
      id: generateId(),
      type,
      x: e.clientX - rect.left - 80,
      y: e.clientY - rect.top - 30,
      title: nodeTypeConfig(type).label,
    };

    setNodes((prev) => [...prev, newNode]);
  }, []);

  const handleNodeMouseDown = useCallback((e: MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
  }, []);

  const handlePortClick = useCallback(
    (e: MouseEvent, nodeId: string, isOutput: boolean) => {
      e.stopPropagation();

      if (isOutput) {
        if (connectingFrom === nodeId) {
          setConnectingFrom(null);
        } else {
          setConnectingFrom(nodeId);
        }
      } else {
        if (connectingFrom && connectingFrom !== nodeId) {
          const existingEdge = edges.find(
            (e) => e.from === connectingFrom && e.to === nodeId,
          );
          if (!existingEdge) {
            setEdges((prev) => [
              ...prev,
              { id: generateId(), from: connectingFrom, to: nodeId },
            ]);
          }
          setConnectingFrom(null);
        }
      }
    },
    [connectingFrom, edges],
  );

  const handleCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
    setConnectingFrom(null);
  }, []);

  const handleNodeDrag = useCallback(
    (nodeId: string, dx: number, dy: number) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? { ...node, x: node.x + dx, y: node.y + dy }
            : node,
        ),
      );
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Delete" && selectedNodeId) {
        setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
        setEdges((prev) =>
          prev.filter(
            (e) => e.from !== selectedNodeId && e.to !== selectedNodeId,
          ),
        );
        setSelectedNodeId(null);
      }
      if (e.key === "Escape") {
        setConnectingFrom(null);
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleSave = useCallback(() => {
    const workflow = { nodes, edges };
    const blob = new Blob([JSON.stringify(workflow, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workflow.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  const handleRun = useCallback(() => {
    console.log("Running workflow:", { nodes, edges });
    alert(`Workflow executed!\nNodes: ${nodes.length}\nEdges: ${edges.length}`);
  }, [nodes, edges]);

  const handleClear = useCallback(() => {
    if (confirm("Clear all nodes and edges?")) {
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      setConnectingFrom(null);
    }
  }, []);

  const handleLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workflow = JSON.parse(event.target?.result as string);
        if (workflow.nodes && workflow.edges) {
          setNodes(workflow.nodes);
          setEdges(workflow.edges);
        }
      } catch (err) {
        console.error("Failed to load workflow:", err);
        alert("Invalid workflow file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  return (
    <div className="flex h-full bg-gray-950 text-gray-100">
      {/* Sidebar Palette */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Node Palette</h2>
          <p className="text-xs text-gray-500 mt-1">Drag nodes to canvas</p>
        </div>
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          {NODE_TYPES.map(({ type, label, color, bgColor, borderColor }) => (
            <div
              key={type}
              draggable
              onDragStart={(e) => handleDragStart(e, type)}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-grab hover:shadow-lg transition-all ${bgColor} ${borderColor} border-opacity-50`}
            >
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${bgColor} ${borderColor}`}
              >
                <span className="text-sm font-medium">{label.charAt(0)}</span>
              </div>
              <span className={`font-medium ${color}`}>{label}</span>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-800 text-xs text-gray-500">
          <p>Click output port (right) then input port (left) to connect</p>
        </div>
      </aside>

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">Workflow Builder</h1>
            <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-800 rounded">
              {nodes.length} nodes, {edges.length} connections
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".json"
                onChange={handleLoad}
                className="hidden"
              />
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                <Upload className="w-4 h-4" />
                Load
              </button>
            </label>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
            <button
              onClick={handleRun}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
            >
              <Play className="w-4 h-4" />
              Run
            </button>
            <button
              onClick={handleClear}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        </header>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 relative bg-gray-950"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleCanvasClick}
        >
          {/* SVG Overlay for Edges */}
          <svg
            ref={svgRef}
            className="absolute inset-0 pointer-events-none"
            style={{ width: "100%", height: "100%" }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,7 L9,3.5 Z" fill="#60a5fa" />
              </marker>
            </defs>

            {/* Render edges */}
            {edges.map((edge) => {
              const fromNode = nodes.find((n) => n.id === edge.from);
              const toNode = nodes.find((n) => n.id === edge.to);
              if (!fromNode || !toNode) return null;

              const canvas = canvasRef.current;
              const rect = canvas?.getBoundingClientRect() || null;
              const path = getEdgePath(fromNode, toNode, rect);
              const arrow = getArrowHead(fromNode, toNode, rect);

              return (
                <g key={edge.id}>
                  <path
                    d={path}
                    stroke="#60a5fa"
                    strokeWidth="2"
                    fill="none"
                    markerEnd="url(#arrowhead)"
                    className="transition-colors"
                  />
                  <path
                    d={arrow}
                    stroke="#60a5fa"
                    strokeWidth="2"
                    fill="none"
                  />
                </g>
              );
            })}

            {/* Render connecting line preview */}
            {connectingFrom && (
              <g>
                {(() => {
                  const fromNode = nodes.find((n) => n.id === connectingFrom);
                  if (!fromNode) return null;

                  const canvas = canvasRef.current;
                  const rect = canvas?.getBoundingClientRect() || null;
                  const from = getPortPosition(fromNode, true, rect);

                  // We need mouse position - store it in state or use a ref
                  return null;
                })()}
              </g>
            )}
          </svg>

          {/* Drag Preview */}
          {dragPreview && (
            <div
              className="absolute pointer-events-none transition-opacity opacity-80"
              style={{ left: dragPreview.x - 80, top: dragPreview.y - 30 }}
            >
              {(() => {
                const config = nodeTypeConfig(dragPreview.type);
                return (
                  <div
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${config.bgColor} ${config.borderColor} border-opacity-50 shadow-xl`}
                  >
                    <div
                      className={`w-8 h-8 rounded flex items-center justify-center ${config.bgColor} ${config.borderColor}`}
                    >
                      <span className="text-xs font-medium">
                        {dragPreview.type.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className={`font-medium ${config.color}`}>
                      {dragPreview.type}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Nodes */}
          {nodes.map((node) => {
            const config = nodeTypeConfig(node.type);
            const isSelected = selectedNodeId === node.id;
            const isConnecting = connectingFrom === node.id;

            return (
              <div
                key={node.id}
                className="absolute select-none"
                style={{ left: node.x, top: node.y }}
              >
                <div
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg border cursor-move
                    transition-all duration-150
                    ${config.bgColor} ${config.borderColor} border-opacity-50
                    ${isSelected ? "ring-2 ring-blue-400 shadow-lg shadow-blue-500/20" : ""}
                    ${isConnecting ? "ring-2 ring-yellow-400" : ""}
                    hover:border-opacity-100
                  `}
                  style={{ width: 160, minHeight: 60 }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onMouseUp={(e) => e.stopPropagation()}
                >
                  {/* Input Port */}
                  <div
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${config.borderColor} border-2 transition-colors hover:scale-125 cursor-pointer`}
                    onClick={(e) => handlePortClick(e, node.id, false)}
                    title="Input"
                  />

                  {/* Node Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-6 h-6 rounded flex items-center justify-center ${config.bgColor} ${config.borderColor}`}
                      >
                        <span className="text-xs font-medium">
                          {node.type.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className={`font-medium truncate ${config.color}`}>
                        {node.title}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {node.type} node
                    </p>
                  </div>

                  {/* Output Port */}
                  <div
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${config.borderColor} border-2 transition-colors hover:scale-125 cursor-pointer`}
                    onClick={(e) => handlePortClick(e, node.id, true)}
                    title="Output"
                  />
                </div>

                {/* Delete button on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNodes((prev) => prev.filter((n) => n.id !== node.id));
                    setEdges((prev) =>
                      prev.filter(
                        (e) => e.from !== node.id && e.to !== node.id,
                      ),
                    );
                  }}
                  className="absolute -top-6 -right-6 w-6 h-6 rounded-full bg-red-900/50 border border-red-500/50 text-red-400 hover:bg-red-900 hover:border-red-500 hover:text-red-300 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
                  aria-label="Delete node"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-gray-600">
                <Plus className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">
                  Drop nodes from the palette to start building
                </p>
                <p className="text-sm mt-1">
                  Click output port → input port to connect
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
