import React, { useState, useEffect } from "react";
import type {
  TraceResult,
  DrillMetrics,
  Suggestion,
  DrilledPropSummary,
  ExtensionToWebviewMessage,
} from "../types";
import { TreeView } from "./TreeView";
import { GraphView } from "./GraphView";
import { messaging } from "./messaging";

export const App: React.FC = () => {
  const [loading, setLoading] = useState<string | null>("Waiting for trace...");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [metrics, setMetrics] = useState<DrillMetrics | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Whole-file overview state
  const [overviewProps, setOverviewProps] = useState<DrilledPropSummary[] | null>(null);
  const [overviewFilePath, setOverviewFilePath] = useState<string | null>(null);

  // Tab mode: "tree" | "graph" | "overview"
  const [mode, setMode] = useState<"tree" | "graph" | "overview">("tree");

  useEffect(() => {
    // Listen to messages from the extension host
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;
      if (!message) return;

      switch (message.type) {
        case "loading":
          setLoading(message.payload.message);
          setError(null);
          break;

        case "error":
          setError(message.payload.message);
          setLoading(null);
          break;

        case "traceResult":
          setResult(message.payload.result);
          setMetrics(message.payload.metrics);
          setSuggestions(message.payload.suggestions);
          setOverviewProps(null); // clear overview when doing single trace
          setLoading(null);
          setError(null);
          setMode("tree"); // default to tree view on new trace
          break;

        case "allDrilledProps":
          setOverviewProps(message.payload.props);
          setOverviewFilePath(message.payload.filePath);
          setResult(null); // clear trace result when doing overview
          setLoading(null);
          setError(null);
          setMode("overview");
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    // Notify extension we are ready to receive data
    messaging.notifyReady();

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const handleRetrace = (prop: DrilledPropSummary) => {
    setLoading(`Retracing prop "${prop.propName}"...`);
    messaging.retrace(
      prop.propName,
      prop.location.filePath,
      prop.location.line,
      prop.location.column,
    );
  };

  const getMetricColor = (ratio: number) => {
    if (ratio >= 0.7) return "var(--vscode-charts-red, #c73c3c)";
    if (ratio >= 0.4) return "var(--vscode-charts-orange, #d1803b)";
    return "var(--vscode-charts-green, #388a34)";
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
        color: "var(--vscode-editor-foreground, #cccccc)",
        fontFamily: "var(--vscode-font-family, sans-serif)",
        boxSizing: "border-box",
      }}
    >
      {/* Top Header Panel */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          backgroundColor: "rgba(0, 0, 0, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>PropTrace</h2>
          {result && (
            <span
              style={{
                fontSize: "13px",
                opacity: 0.8,
                borderLeft: "1px solid rgba(255,255,255,0.2)",
                paddingLeft: "10px",
              }}
            >
              Traced: <code style={{ color: "#ff79c6" }}>{result.propName}</code> in{" "}
              <strong>{result.startComponentName}</strong>
            </span>
          )}
          {overviewFilePath && mode === "overview" && (
            <span
              style={{
                fontSize: "13px",
                opacity: 0.8,
                borderLeft: "1px solid rgba(255,255,255,0.2)",
                paddingLeft: "10px",
              }}
            >
              Overview: <strong>{overviewFilePath.split(/[/\\]/).pop()}</strong>
            </span>
          )}
        </div>

        {/* View Mode Toggle Buttons */}
        <div style={{ display: "flex", gap: "6px" }}>
          {(result || mode !== "overview") && (
            <>
              <button
                onClick={() => setMode("tree")}
                style={{
                  backgroundColor:
                    mode === "tree"
                      ? "var(--vscode-button-background, #0e639c)"
                      : "rgba(255,255,255,0.05)",
                  color:
                    mode === "tree"
                      ? "var(--vscode-button-foreground, #ffffff)"
                      : "var(--vscode-button-secondaryForeground, #cccccc)",
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 500,
                  transition: "all 0.15s ease",
                }}
              >
                Tree View
              </button>
              <button
                onClick={() => setMode("graph")}
                style={{
                  backgroundColor:
                    mode === "graph"
                      ? "var(--vscode-button-background, #0e639c)"
                      : "rgba(255,255,255,0.05)",
                  color:
                    mode === "graph"
                      ? "var(--vscode-button-foreground, #ffffff)"
                      : "var(--vscode-button-secondaryForeground, #cccccc)",
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 500,
                  transition: "all 0.15s ease",
                }}
              >
                Graph View
              </button>
            </>
          )}
          {overviewProps && (
            <button
              onClick={() => setMode("overview")}
              style={{
                backgroundColor:
                  mode === "overview"
                    ? "var(--vscode-button-background, #0e639c)"
                    : "rgba(255,255,255,0.05)",
                color:
                  mode === "overview"
                    ? "var(--vscode-button-foreground, #ffffff)"
                    : "var(--vscode-button-secondaryForeground, #cccccc)",
                border: "none",
                padding: "6px 12px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 500,
                transition: "all 0.15s ease",
              }}
            >
              Overview List
            </button>
          )}
        </div>
      </header>

      {/* Main Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        {/* Loading Spinner Overlays */}
        {loading && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(30, 30, 30, 0.75)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              className="spinner"
              style={{
                width: "40px",
                height: "40px",
                border: "4px solid rgba(255,255,255,0.1)",
                borderTop: "4px solid var(--vscode-button-background, #0e639c)",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                marginBottom: "12px",
              }}
            />
            <div style={{ fontSize: "14px", fontWeight: 500 }}>{loading}</div>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Error Notification Banner */}
        {error && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(30, 30, 30, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 90,
              padding: "20px",
            }}
          >
            <div
              style={{
                backgroundColor: "rgba(199, 60, 60, 0.15)",
                border: "1.5px solid var(--vscode-charts-red, #c73c3c)",
                padding: "20px 30px",
                borderRadius: "8px",
                maxWidth: "500px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              }}
            >
              <h3
                style={{
                  color: "var(--vscode-charts-red, #c73c3c)",
                  margin: "0 0 10px 0",
                  fontSize: "16px",
                }}
              >
                Trace Failed
              </h3>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5, opacity: 0.9 }}>
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Display Views */}
        <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
          {mode === "tree" && result && <TreeView result={result} />}
          {mode === "graph" && result && <GraphView result={result} />}

          {/* File Drill Overview Table Mode */}
          {mode === "overview" && overviewProps && (
            <div style={{ padding: "20px", overflowY: "auto", height: "100%" }}>
              <h3 style={{ marginTop: 0, fontSize: "15px", marginBottom: "15px" }}>
                Drilled Props in File
              </h3>
              {overviewProps.length === 0 ? (
                <div
                  style={{
                    padding: "40px",
                    textAlign: "center",
                    opacity: 0.6,
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                  }}
                >
                  No drilled props detected in this file.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "13px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    borderRadius: "6px",
                    overflow: "hidden",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "12px 16px" }}>Prop Name</th>
                      <th style={{ padding: "12px 16px" }}>Component</th>
                      <th style={{ padding: "12px 16px" }}>Max Drill Depth</th>
                      <th style={{ padding: "12px 16px" }}>Location</th>
                      <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewProps.map((p, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          backgroundColor: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        }}
                      >
                        <td style={{ padding: "12px 16px" }}>
                          <code style={{ color: "#ff79c6", fontSize: "12px", fontWeight: "bold" }}>
                            {p.propName}
                          </code>
                        </td>
                        <td style={{ padding: "12px 16px", fontWeight: 500 }}>{p.componentName}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span
                            style={{
                              backgroundColor:
                                p.drillDepth >= 3
                                  ? "rgba(209, 128, 59, 0.15)"
                                  : "rgba(255,255,255,0.05)",
                              color:
                                p.drillDepth >= 3
                                  ? "var(--vscode-charts-orange, #d1803b)"
                                  : "inherit",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              fontWeight: "bold",
                              fontSize: "12px",
                            }}
                          >
                            {p.drillDepth}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px", opacity: 0.8 }}>
                          <span
                            onClick={() => messaging.jumpToSource(p.location)}
                            style={{
                              cursor: "pointer",
                              textDecoration: "underline",
                              color: "var(--vscode-textLink-foreground, #3794ef)",
                            }}
                            title="Click to jump to definition"
                          >
                            Line {p.location.line}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <button
                            onClick={() => handleRetrace(p)}
                            style={{
                              backgroundColor: "var(--vscode-button-background, #0e639c)",
                              color: "var(--vscode-button-foreground, #ffffff)",
                              border: "none",
                              padding: "4px 10px",
                              borderRadius: "3px",
                              cursor: "pointer",
                              fontSize: "11px",
                            }}
                          >
                            Trace Graph
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Sidebar: Metrics & Suggestions (Only visible when single trace result is shown) */}
        {result && metrics && (
          <aside
            style={{
              width: "320px",
              borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
              backgroundColor: "rgba(0, 0, 0, 0.15)",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              padding: "20px",
              boxSizing: "border-box",
            }}
          >
            {/* Metrics Panel */}
            <section style={{ marginBottom: "25px" }}>
              <h3
                style={{
                  margin: "0 0 15px 0",
                  fontSize: "14px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  opacity: 0.8,
                }}
              >
                Drill Metrics
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* Metric Card: Depth */}
                <div
                  style={{
                    backgroundColor: "rgba(255,255,255,0.03)",
                    padding: "12px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      opacity: 0.7,
                      textTransform: "uppercase",
                      marginBottom: "4px",
                    }}
                  >
                    Drill Depth
                  </div>
                  <div
                    style={{
                      fontSize: "22px",
                      fontWeight: "bold",
                      color:
                        metrics.drillDepth >= 3
                          ? "var(--vscode-charts-orange, #d1803b)"
                          : "var(--vscode-charts-green, #388a34)",
                    }}
                  >
                    {metrics.drillDepth}
                  </div>
                  <div style={{ fontSize: "10px", opacity: 0.6, marginTop: "2px" }}>
                    Component layers traversed
                  </div>
                </div>

                {/* Metric Card: Ratio */}
                <div
                  style={{
                    backgroundColor: "rgba(255,255,255,0.03)",
                    padding: "12px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      opacity: 0.7,
                      textTransform: "uppercase",
                      marginBottom: "4px",
                    }}
                  >
                    Passthrough Ratio
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "22px",
                        fontWeight: "bold",
                        color: getMetricColor(metrics.passthroughRatio),
                      }}
                    >
                      {Math.round(metrics.passthroughRatio * 100)}%
                    </span>
                    <span style={{ fontSize: "11px", opacity: 0.6 }}>
                      ({metrics.passthroughCount}/{metrics.drillDepth})
                    </span>
                  </div>
                  <div
                    style={{
                      height: "4px",
                      backgroundColor: "rgba(255,255,255,0.1)",
                      borderRadius: "2px",
                      marginTop: "8px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${metrics.passthroughRatio * 100}%`,
                        backgroundColor: getMetricColor(metrics.passthroughRatio),
                        borderRadius: "2px",
                      }}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Suggestions Panel */}
            <section style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <h3
                style={{
                  margin: "0 0 15px 0",
                  fontSize: "14px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  opacity: 0.8,
                }}
              >
                Refactoring Suggestions
              </h3>

              {suggestions.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    opacity: 0.6,
                    fontSize: "12px",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: "6px",
                  }}
                >
                  No optimization smells detected for this prop. Structure is healthy!
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {suggestions.map((s, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: "rgba(255, 255, 255, 0.03)",
                        borderLeft: "4px solid var(--vscode-charts-orange, #d1803b)",
                        padding: "12px 14px",
                        borderRadius: "0 6px 6px 0",
                        borderTop: "1px solid rgba(255,255,255,0.03)",
                        borderRight: "1px solid rgba(255,255,255,0.03)",
                        borderBottom: "1px solid rgba(255,255,255,0.03)",
                      }}
                    >
                      <h4
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: "13px",
                          fontWeight: "bold",
                          color: "var(--vscode-editor-foregroundColor, #cccccc)",
                        }}
                      >
                        {s.title}
                      </h4>
                      <p
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: "12px",
                          lineHeight: 1.4,
                          opacity: 0.8,
                          whiteSpace: "pre-line",
                        }}
                      >
                        {s.detail}
                      </p>
                      {s.docUrl && (
                        <a
                          href={s.docUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "11px",
                            color: "var(--vscode-textLink-foreground, #3794ef)",
                            textDecoration: "none",
                            fontWeight: 500,
                          }}
                        >
                          Learn more &rarr;
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};
