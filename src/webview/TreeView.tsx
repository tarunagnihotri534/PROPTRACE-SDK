import React from "react";
import type { TraceResult } from "../types";
import { messaging } from "./messaging";

interface TreeViewProps {
  result: TraceResult;
}

export const TreeView: React.FC<TreeViewProps> = ({ result }) => {
  const { nodes, rootNodeId } = result;

  const renderNode = (nodeId: string) => {
    const node = nodes[nodeId];
    if (!node) return null;

    const handleNodeClick = () => {
      messaging.jumpToSource(node.location);
    };

    // Determine visual styles based on node kind
    let borderStyle = "solid";
    let badgeColor = "var(--vscode-charts-blue, #3794ef)";
    let badgeText = "Consume";
    let nodeBg = "rgba(55, 148, 239, 0.05)";

    if (node.kind === "origin") {
      badgeColor = "var(--vscode-charts-green, #388a34)";
      badgeText = "Origin";
      nodeBg = "rgba(56, 138, 52, 0.05)";
    } else if (node.kind === "passthrough") {
      borderStyle = "dashed";
      badgeColor = "var(--vscode-charts-orange, #d1803b)";
      badgeText = "Passthrough";
      nodeBg = "rgba(209, 128, 59, 0.03)";
    } else if (node.kind === "spread-boundary") {
      badgeColor = "var(--vscode-charts-red, #c73c3c)";
      badgeText = "Spread Boundary";
      nodeBg = "rgba(199, 60, 60, 0.08)";
    }

    const filename = node.location.filePath.split(/[/\\]/).pop() || "";

    return (
      <li key={node.id} className="tree-node-li">
        <div
          className="node-card"
          onClick={handleNodeClick}
          style={{
            borderStyle,
            borderColor: badgeColor,
            backgroundColor: nodeBg,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
            padding: "10px 14px",
            borderRadius: "6px",
            margin: "6px 0",
            cursor: "pointer",
            transition: "all 0.2s ease-in-out",
            borderWidth: "1.5px",
            display: "inline-block",
            minWidth: "260px",
          }}
          title={`Click to jump to ${filename}:${node.location.line}`}
        >
          <div
            className="node-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "4px",
            }}
          >
            <span
              className="node-label"
              style={{
                fontWeight: "bold",
                fontSize: "14px",
                color: "var(--vscode-editor-foregroundColor, #cccccc)",
              }}
            >
              {node.label}
            </span>
            <span
              className="node-badge"
              style={{
                backgroundColor: badgeColor,
                color: "#ffffff",
                padding: "2px 6px",
                borderRadius: "4px",
                fontSize: "10px",
                fontWeight: "bold",
                textTransform: "uppercase",
              }}
            >
              {badgeText}
            </span>
          </div>

          <div
            className="node-details"
            style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground, #858585)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" }}>
              <span style={{ opacity: 0.7 }}>Prop:</span>
              <code
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.08)",
                  padding: "1px 4px",
                  borderRadius: "3px",
                  color: "var(--vscode-textPreformat-foreground, #ff79c6)",
                }}
              >
                {node.propName}
              </code>
            </div>

            {node.rename && (
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--vscode-charts-orange, #d1803b)",
                  marginBottom: "4px",
                  fontStyle: "italic",
                }}
              >
                Renamed from: <code>{node.rename.fromName}</code> &rarr;{" "}
                <code>{node.rename.toName}</code>
              </div>
            )}

            <div
              style={{
                fontSize: "11px",
                opacity: 0.8,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                {filename}:{node.location.line}:{node.location.column}
              </span>
            </div>
          </div>
        </div>

        {node.children.length > 0 && (
          <ul
            className="tree-node-children-ul"
            style={{
              listStyleType: "none",
              paddingLeft: "30px",
              borderLeft: "1px dashed rgba(255, 255, 255, 0.1)",
              marginLeft: "20px",
            }}
          >
            {node.children.map((childId) => renderNode(childId))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div
      className="tree-view-container"
      style={{ padding: "16px", overflowY: "auto", height: "100%" }}
    >
      <ul style={{ listStyleType: "none", padding: 0, margin: 0 }}>{renderNode(rootNodeId)}</ul>
    </div>
  );
};
