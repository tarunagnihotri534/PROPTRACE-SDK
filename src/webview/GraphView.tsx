import React, { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  Node as RFNode,
  Edge as RFEdge,
} from "reactflow";
import type { TraceResult, PropTraceNode } from "../types";
import { messaging } from "./messaging";

// Import reactflow styles locally in case index.tsx bundles them, but reactflow works with standard styles.
// We'll define inline styled custom nodes for React Flow.

interface GraphViewProps {
  result: TraceResult;
}

// Custom Node Component to render beautiful node cards inside ReactFlow
const CustomNode = ({ data }: { data: { node: PropTraceNode; isRoot: boolean } }) => {
  const { node } = data;

  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    messaging.jumpToSource(node.location);
  };

  let borderStyle = "solid";
  let badgeColor = "#3794ef";
  let badgeText = "Consume";
  let nodeBg = "rgba(55, 148, 239, 0.05)";

  if (node.kind === "origin") {
    badgeColor = "#388a34";
    badgeText = "Origin";
    nodeBg = "rgba(56, 138, 52, 0.05)";
  } else if (node.kind === "passthrough") {
    borderStyle = "dashed";
    badgeColor = "#d1803b";
    badgeText = "Passthrough";
    nodeBg = "rgba(209, 128, 59, 0.03)";
  } else if (node.kind === "spread-boundary") {
    badgeColor = "#c73c3c";
    badgeText = "Spread Boundary";
    nodeBg = "rgba(199, 60, 60, 0.08)";
  }

  const filename = node.location.filePath.split(/[/\\]/).pop() || "";

  return (
    <div
      onClick={handleNodeClick}
      style={{
        border: `1.5px ${borderStyle} ${badgeColor}`,
        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
        backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%), ${nodeBg}`,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        padding: "10px 14px",
        borderRadius: "8px",
        cursor: "pointer",
        minWidth: "240px",
        maxWidth: "280px",
        color: "var(--vscode-editor-foregroundColor, #cccccc)",
        fontFamily: "var(--vscode-font-family, sans-serif)",
        textAlign: "left",
        position: "relative",
      }}
      title={`Click to jump to ${filename}:${node.location.line}`}
    >
      {/* Top Handle */}
      {!data.isRoot && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: badgeColor, width: "10px", height: "10px", borderRadius: "50%" }}
        />
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "6px",
        }}
      >
        <span
          style={{
            fontWeight: "bold",
            fontSize: "13px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "150px",
          }}
        >
          {node.label}
        </span>
        <span
          style={{
            backgroundColor: badgeColor,
            color: "#ffffff",
            padding: "1px 5px",
            borderRadius: "3px",
            fontSize: "9px",
            fontWeight: "bold",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {badgeText}
        </span>
      </div>

      <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground, #858585)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" }}>
          <span style={{ opacity: 0.7 }}>Prop:</span>
          <code
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              padding: "1px 4px",
              borderRadius: "3px",
              color: "#ff79c6",
            }}
          >
            {node.propName}
          </code>
        </div>

        {node.rename && (
          <div
            style={{ fontSize: "10px", color: "#d1803b", marginBottom: "2px", fontStyle: "italic" }}
          >
            Renamed: <code>{node.rename.fromName}</code> &rarr; <code>{node.rename.toName}</code>
          </div>
        )}

        <div style={{ fontSize: "9px", opacity: 0.6 }}>
          {filename}:{node.location.line}
        </div>
      </div>

      {/* Bottom Handle */}
      {node.children.length > 0 && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: badgeColor, width: "10px", height: "10px", borderRadius: "50%" }}
        />
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export const GraphView: React.FC<GraphViewProps> = ({ result }) => {
  const { nodes, rootNodeId } = result;

  const { flowNodes, flowEdges } = useMemo(() => {
    const fNodes: RFNode[] = [];
    const fEdges: RFEdge[] = [];

    if (!rootNodeId || !nodes[rootNodeId]) {
      return { flowNodes: [], flowEdges: [] };
    }

    // BFS level-based layout algorithm
    const levels: string[][] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; level: number }> = [{ id: rootNodeId, level: 0 }];

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      if (!levels[level]) levels[level] = [];
      levels[level].push(id);

      const node = nodes[id];
      if (node) {
        for (const childId of node.children) {
          queue.push({ id: childId, level: level + 1 });
        }
      }
    }

    // Positions & construct RFNodes
    const HORIZONTAL_GAP = 280;
    const VERTICAL_GAP = 160;

    levels.forEach((levelNodeIds, levelIdx) => {
      const levelWidth = (levelNodeIds.length - 1) * HORIZONTAL_GAP;
      const startX = -levelWidth / 2;

      levelNodeIds.forEach((nodeId, nodeIdx) => {
        const node = nodes[nodeId];
        if (!node) return;

        const x = startX + nodeIdx * HORIZONTAL_GAP;
        const y = levelIdx * VERTICAL_GAP + 50;

        fNodes.push({
          id: nodeId,
          type: "custom",
          position: { x, y },
          data: {
            node,
            isRoot: nodeId === rootNodeId,
          },
        });

        // Add Edges from parent to children
        node.children.forEach((childId) => {
          fEdges.push({
            id: `edge-${nodeId}-${childId}`,
            source: nodeId,
            target: childId,
            animated: true,
            style: {
              stroke: node.kind === "origin" ? "#388a34" : "#d1803b",
              strokeWidth: 2,
            },
          });
        });
      });
    });

    return { flowNodes: fNodes, flowEdges: fEdges };
  }, [nodes, rootNodeId]);

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background color="#555" gap={16} />
        <Controls style={{ fill: "var(--vscode-editor-foreground, #ccc)" }} />
        <MiniMap
          nodeStrokeColor={(n) => {
            const nodeData = n.data?.node as PropTraceNode | undefined;
            if (!nodeData) return "#333";
            return nodeData.kind === "origin" ? "#388a34" : "#d1803b";
          }}
          nodeColor={(n) => {
            const nodeData = n.data?.node as PropTraceNode | undefined;
            if (!nodeData) return "#111";
            return nodeData.kind === "origin"
              ? "rgba(56, 138, 52, 0.4)"
              : "rgba(209, 128, 59, 0.3)";
          }}
          maskColor="rgba(0,0,0,0.4)"
        />
      </ReactFlow>
    </div>
  );
};
