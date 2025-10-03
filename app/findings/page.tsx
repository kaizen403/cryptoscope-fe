"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import CodeViewer from "../../components/CodeViewer";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false }) as unknown as React.ComponentType<any>;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

type Finding = {
  id?: string;
  ruleId?: string;
  category?: string;
  severity?: string;
  description?: string;
  recommendation?: string;
  line?: number;
  column?: number;
  match?: string;
  rankedSeverity?: string;
};

type ScanFile = {
  path: string;
  language?: string;
  findings: Finding[];
};

type RepoPayload = {
  repo?: { id?: string | null; versionId?: string | null };
  files?: ScanFile[];
  summary?: any;
};

const severityOrder: Array<{ key: string; label: string }> = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
  { key: "info", label: "Info" },
];

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
};

const SEVERITY_OPTIONS = [
  { key: "high", label: "High", badge: "severity-high" },
  { key: "medium", label: "Medium", badge: "severity-medium" },
  { key: "low", label: "Low", badge: "severity-low" },
  { key: "info", label: "Informational", badge: "severity-info" },
];

const CATEGORY_OPTIONS = [
  { key: "cipher", label: "Ciphers" },
  { key: "mode", label: "Modes" },
  { key: "hash", label: "Hashes" },
  { key: "mac", label: "MAC" },
  { key: "random", label: "Randomness" },
  { key: "kdf", label: "KDF" },
  { key: "keygen", label: "Keygen" },
  { key: "signature", label: "Signatures" },
  { key: "primitive", label: "Primitives" },
  { key: "other", label: "Other" },
];

function buildTreeFromPaths(paths: string[]): TreeNode[] {
  const root: Record<string, any> = {};
  for (const full of paths) {
    if (!full) continue;
    const parts = full.split("/").filter(Boolean);
    if (!parts.length) continue;
    let cursor = root;
    let agg = "";
    parts.forEach((segment, idx) => {
      agg = agg ? `${agg}/${segment}` : segment;
      cursor.children ||= {};
      if (!cursor.children[segment]) {
        cursor.children[segment] = {
          name: segment,
          path: agg,
          type: idx === parts.length - 1 ? "file" : "folder",
          children: {},
        };
      }
      cursor = cursor.children[segment];
    });
  }

  function toNodes(node: any): TreeNode[] {
    const entries: TreeNode[] = [];
    const keys = Object.keys(node.children || {}).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const child = node.children[key];
      const entry: TreeNode = {
        name: child.name,
        path: child.path,
        type: child.type,
      };
      if (child.type === "folder") {
        entry.children = toNodes(child);
      }
      entries.push(entry);
    }
    return entries;
  }

  return toNodes(root);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function renderInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  const placeholders: string[] = [];
  const withCode = escaped.replace(/`([^`]+)`/g, (_, code: string) => {
    const idx = placeholders.push(code) - 1;
    return `@@CODE${idx}@@`;
  });
  const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const withItalic = withBold.replace(/\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
  const restored = withItalic.replace(/@@CODE(\d+)@@/g, (_, rawIdx: string) => {
    const code = placeholders[Number(rawIdx)] || "";
    return `<code>${code}</code>`;
  });
  return restored;
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        out.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(`${escapeHtml(rawLine)}\n`);
      continue;
    }
    if (!trimmed && inList) {
      out.push("</ul>");
      inList = false;
    }
    if (!trimmed) {
      out.push("<br />");
      continue;
    }
    if (trimmed.startsWith("- ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${renderInlineMarkdown(trimmed.replace(/^\-\s+/, ""))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (trimmed.startsWith("### ")) {
      out.push(`<h4>${renderInlineMarkdown(trimmed.slice(4))}</h4>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      out.push(`<h3>${renderInlineMarkdown(trimmed.slice(3))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      out.push(`<h2>${renderInlineMarkdown(trimmed.slice(2))}</h2>`);
      continue;
    }
    out.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</code></pre>");
  return out.join("");
}

function canonicalSeverity(finding: Finding): string {
  const raw = (finding.rankedSeverity || finding.severity || "info").toLowerCase();
  if (raw === "critical" || raw === "error" || raw === "high") return "high";
  if (raw === "warning" || raw === "medium") return "medium";
  if (raw === "info" || raw === "informational") return "info";
  return "low";
}

type AggregatedFinding = { file: string; f: Finding };

function usePlotTheme() {
  const [theme, setTheme] = useState({
    text: "#f5f7ff",
    secondary: "#a8b6d6",
    muted: "#7b88aa",
    border: "rgba(96, 128, 184, 0.18)",
    surface: "rgba(12, 24, 50, 0.92)",
    accent: "#4f7cf5",
    accentBright: "#6ea0ff",
    success: "#3ecf8e",
    danger: "#f97066",
    warning: "#f7b955",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      (styles.getPropertyValue(name) || fallback).trim() || fallback;
    setTheme((prev) => ({
      text: read("--text-primary", prev.text),
      secondary: read("--text-secondary", prev.secondary),
      muted: read("--text-muted", prev.muted),
      border: read("--border-light", prev.border),
      surface: read("--surface-elevated", prev.surface),
      accent: read("--accent", prev.accent),
      accentBright: read("--accent-bright", prev.accentBright),
      success: read("--success", prev.success),
      danger: read("--danger", prev.danger),
      warning: read("--warning", prev.warning),
    }));
  }, []);

  return theme;
}

function AnalyticsPanel({ files, findings, onClose }: { files: ScanFile[]; findings: AggregatedFinding[]; onClose: () => void }) {
  const theme = usePlotTheme();

  const countsByFile = useMemo(() => {
    const map = new Map<string, number>();
    for (const { file } of findings) {
      map.set(file, (map.get(file) || 0) + 1);
    }
    return map;
  }, [findings]);

  const severityCounts = useMemo(() => {
    const base: Record<string, number> = { high: 0, medium: 0, low: 0, info: 0 };
    for (const { f } of findings) {
      const key = canonicalSeverity(f);
      base[key] = (base[key] || 0) + 1;
    }
    return base;
  }, [findings]);

  const severityHeadline = severityCounts.high
    ? "High"
    : severityCounts.medium
    ? "Medium"
    : severityCounts.low
    ? "Low"
    : "Info";

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const { f } of findings) {
      const key = (f.category || "other").toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [findings]);

  const ruleCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const { f } of findings) {
      const key = (f.ruleId || f.description || "unknown rule").slice(0, 60);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [findings]);

  const languageCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of files) {
      const count = countsByFile.get(file.path) || 0;
      if (!count) continue;
      const lang = (file.language || "unknown").toLowerCase();
      map.set(lang, (map.get(lang) || 0) + count);
    }
    return map;
  }, [files, countsByFile]);

  const totalFindings = findings.length;
  const affectedFiles = countsByFile.size;
  const distinctRules = ruleCounts.size;

  const severityChart = useMemo(() => {
    const entries = severityOrder
      .map(({ key, label }) => ({ key, label, value: severityCounts[key] || 0 }))
      .filter((entry) => entry.value > 0);
    if (!entries.length) return null;
    const slices = entries.map((e) => e.value);
    const labels = entries.map((e) => e.label);
    const colors = entries.map((entry) => {
      if (entry.key === "high") return theme.danger;
      if (entry.key === "medium") return theme.warning;
      if (entry.key === "low") return theme.accent;
      return theme.muted;
    });
    return (
      <Plot
        data={[{
          values: slices,
          labels,
          type: "pie",
          hole: 0.45,
          marker: { colors, line: { color: theme.surface, width: 2 } },
          hovertemplate: "%{label}: <b>%{value}</b> findings<extra></extra>",
        }]}
        layout={{
          height: 320,
          margin: { t: 10, l: 10, r: 10, b: 10 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          showlegend: true,
          legend: { orientation: "h", font: { color: theme.secondary }, y: -0.15 },
          font: { color: theme.text },
        }}
        config={{ displayModeBar: false, responsive: true }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    );
  }, [severityCounts, theme]);

  const topCategories = useMemo(() => {
    return Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [categoryCounts]);

  const categoryChart = useMemo(() => {
    if (!topCategories.length) return null;
    const labels = topCategories.map(([label]) => label);
    const values = topCategories.map(([, value]) => value);
    return (
      <Plot
        data={[{
          type: "bar",
          orientation: "h",
          x: values.reverse(),
          y: labels.map((label) => label.toUpperCase()).reverse(),
          marker: { color: theme.accentBright, line: { color: theme.border, width: 1 } },
          hovertemplate: "%{y}: <b>%{x}</b> findings<extra></extra>",
        }]}
        layout={{
          height: 320,
          margin: { t: 10, l: 80, r: 20, b: 40 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: theme.text },
          xaxis: { gridcolor: theme.border, zerolinecolor: theme.border },
          yaxis: { automargin: true },
        }}
        config={{ displayModeBar: false, responsive: true }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    );
  }, [topCategories, theme]);

  const topRules = useMemo(() => {
    return Array.from(ruleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [ruleCounts]);

  const rulesChart = useMemo(() => {
    if (!topRules.length) return null;
    const labels = topRules.map(([label]) => label);
    const values = topRules.map(([, value]) => value);
    return (
      <Plot
        data={[{
          type: "bar",
          x: values,
          y: labels,
          marker: { color: theme.success, line: { color: theme.border, width: 1 } },
          hovertemplate: "%{y}: <b>%{x}</b><extra></extra>",
        }]}
        layout={{
          height: 340,
          margin: { t: 10, l: 140, r: 20, b: 40 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: theme.text },
          xaxis: { gridcolor: theme.border, zerolinecolor: theme.border },
          yaxis: { automargin: true },
        }}
        config={{ displayModeBar: false, responsive: true }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    );
  }, [topRules, theme]);

  const topFiles = useMemo(() => {
    return Array.from(countsByFile.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [countsByFile]);

  const fileChart = useMemo(() => {
    if (!topFiles.length) return null;
    const labels = topFiles.map(([label]) => label);
    const values = topFiles.map(([, value]) => value);
    return (
      <Plot
        data={[{
          type: "bar",
          x: values.reverse(),
          y: labels.map((label) => label.split("/").slice(-2).join("/"))
            .map((label) => (label.length > 36 ? `${label.slice(0, 33)}…` : label))
            .reverse(),
          marker: { color: theme.accent, line: { color: theme.border, width: 1 } },
          orientation: "h",
          hovertemplate: "%{y}: <b>%{x}</b> findings<extra></extra>",
        }]}
        layout={{
          height: 320,
          margin: { t: 10, l: 160, r: 20, b: 40 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: theme.text },
          xaxis: { gridcolor: theme.border, zerolinecolor: theme.border },
          yaxis: { automargin: true },
        }}
        config={{ displayModeBar: false, responsive: true }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    );
  }, [topFiles, theme]);

  const languageBreakdown = useMemo(() => {
    return Array.from(languageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [languageCounts]);

  const languageChart = useMemo(() => {
    if (!languageBreakdown.length) return null;
    const labels = languageBreakdown.map(([label]) => label.toUpperCase());
    const values = languageBreakdown.map(([, value]) => value);
    return (
      <Plot
        data={[{
          type: "bar",
          x: labels,
          y: values,
          marker: { color: theme.warning, line: { color: theme.border, width: 1 } },
          hovertemplate: "%{x}: <b>%{y}</b><extra></extra>",
        }]}
        layout={{
          height: 320,
          margin: { t: 10, l: 40, r: 20, b: 60 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: theme.text },
          xaxis: { tickangle: -25 },
          yaxis: { gridcolor: theme.border },
        }}
        config={{ displayModeBar: false, responsive: true }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    );
  }, [languageBreakdown, theme]);

  if (!totalFindings) {
    return (
      <div className="panel fade-in" style={{ marginBottom: "1rem" }}>
        <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>analytics</h3>
          <button className="secondary-button" onClick={onClose}>close</button>
        </div>
        <div className="panel-body">
          <div className="empty-state">no findings to visualise for the current filters.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel fade-in" style={{ marginBottom: "1rem" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0 }}>analytics</h3>
          <p style={{ margin: "0.45rem 0 0", color: theme.secondary }}>Visual summary of the current findings set.</p>
        </div>
        <button className="secondary-button" onClick={onClose}>close</button>
      </div>
      <div className="panel-body">
        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-label">findings</span>
            <span className="metric-value">{totalFindings}</span>
            <span className="metric-help">across {affectedFiles} files</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">rules</span>
            <span className="metric-value">{distinctRules}</span>
            <span className="metric-help">top rule: {topRules[0]?.[0] || "n/a"}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">highest severity</span>
            <span className="metric-value">{severityHeadline}</span>
            <span className="metric-help">{severityCounts.high} high · {severityCounts.medium} medium</span>
          </div>
        </div>
        <div className="charts-grid">
          <div className="chart-card">
            <div className="chart-card-header">
              <h4>Severity mix</h4>
              <span>{totalFindings} findings</span>
            </div>
            <div className="chart-card-body">{severityChart}</div>
          </div>
          <div className="chart-card">
            <div className="chart-card-header">
              <h4>Top categories</h4>
              <span>{topCategories.length || "0"} groups</span>
            </div>
            <div className="chart-card-body">{categoryChart}</div>
          </div>
          <div className="chart-card">
            <div className="chart-card-header">
              <h4>Top rules</h4>
              <span>{topRules.length || "0"} highlighted</span>
            </div>
            <div className="chart-card-body">{rulesChart}</div>
          </div>
          <div className="chart-card">
            <div className="chart-card-header">
              <h4>Findings by file</h4>
              <span>{topFiles.length || "0"} files</span>
            </div>
            <div className="chart-card-body">{fileChart}</div>
          </div>
          <div className="chart-card">
            <div className="chart-card-header">
              <h4>Language breakdown</h4>
              <span>{languageBreakdown.length || "0"} languages</span>
            </div>
            <div className="chart-card-body">{languageChart}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function useRepo(): { repoId: string | null; versionId: string | null; files: ScanFile[] } {
  const [payload, setPayload] = useState<RepoPayload | null>(null);
  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        // Try to read versionId from location (passed via redirect) or fall back to last repo meta
        const u = new URL(window.location.href);
        const v = u.searchParams.get('versionId');
        if (v) {
          const res = await fetch(`${API_BASE_URL}/scan-result?versionId=${encodeURIComponent(v)}`).catch(()=>null as any);
          if (res?.ok) {
            const data = await res.json();
            if (!cancel) setPayload({ repo: { id: v, versionId: v }, files: data.files, summary: data.summary });
            return;
          }
        }
        // as fallback, no-op
      } catch {}
    }
    load();
    return () => { cancel = true; };
  }, []);
  const repoId = payload?.repo?.id || null;
  const versionId = payload?.repo?.versionId || null;
  const files = useMemo(() => (Array.isArray(payload?.files) ? payload!.files : []), [payload]);
  return { repoId, versionId, files };
}

function Filters({
  value,
  onChange,
  onReset,
}: {
  value: { severity: Set<string>; category: Set<string>; cryptoOnly: boolean };
  onChange: (v: { severity: Set<string>; category: Set<string>; cryptoOnly: boolean }) => void;
  onReset: () => void;
}) {
  const toggleSeverity = (key: string) => {
    const severity = new Set(value.severity);
    if (severity.has(key)) severity.delete(key); else severity.add(key);
    onChange({ severity, category: new Set(value.category), cryptoOnly: value.cryptoOnly });
  };

  const toggleCategory = (key: string) => {
    const category = new Set(value.category);
    if (category.has(key)) category.delete(key); else category.add(key);
    onChange({ severity: new Set(value.severity), category, cryptoOnly: value.cryptoOnly });
  };

  const toggleCryptoOnly = () => {
    onChange({ severity: new Set(value.severity), category: new Set(value.category), cryptoOnly: !value.cryptoOnly });
  };

  return (
    <div className="panel filter-panel">
      <div className="panel-header filter-header">
        <h3>filters</h3>
        <button type="button" className="text-button" onClick={onReset}>reset</button>
      </div>
      <div className="panel-body filter-body">
        <div className="filter-group">
          <span className="filter-label">severity</span>
          <div className="toggle-collection">
            {SEVERITY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`toggle-pill ${value.severity.has(opt.key) ? 'active' : ''}`}
                onClick={() => toggleSeverity(opt.key)}
              >
                <span className="toggle-meta">
                  <span className={`toggle-dot ${opt.badge}`} aria-hidden />
                  {opt.label}
                </span>
                <span className="toggle-switch" aria-hidden>
                  <span className="toggle-knob" />
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">category</span>
          <div className="toggle-collection">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`toggle-pill subtle ${value.category.has(opt.key) ? 'active' : ''}`}
                onClick={() => toggleCategory(opt.key)}
              >
                <span className="toggle-meta">{opt.label}</span>
                <span className="toggle-switch" aria-hidden>
                  <span className="toggle-knob" />
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">focus</span>
          <div className="toggle-collection single">
            <button
              type="button"
              className={`toggle-pill prominent ${value.cryptoOnly ? 'active' : ''}`}
              onClick={toggleCryptoOnly}
            >
              <span className="toggle-meta">crypto files only</span>
              <span className="toggle-switch" aria-hidden>
                <span className="toggle-knob" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FindingsPage() {
  const { repoId, versionId, files } = useRepo();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<{ startLine: number; message?: string; severity?: string }[]>([]);
  const [filters, setFilters] = useState<{ severity: Set<string>; category: Set<string>; cryptoOnly: boolean }>({ severity: new Set(), category: new Set(), cryptoOnly: false });
  const [askBusy, setAskBusy] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [showGraphs, setShowGraphs] = useState(false);
  const [showCodebase, setShowCodebase] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  const filteredFiles = useMemo(() => {
    const sev = filters.severity;
    const cat = filters.category;
    return (files || []).filter(f => {
      const hasFindings = (f.findings || []).length > 0;
      if (filters.cryptoOnly && !hasFindings) return false;
      if (!sev.size && !cat.size) return true;
      const pass = (f.findings || []).some(fi =>
        (!sev.size || sev.has(canonicalSeverity(fi))) &&
        (!cat.size || cat.has((fi.category || 'other').toLowerCase()))
      );
      return pass;
    });
  }, [files, filters]);

  const allFindings = useMemo(() => {
    const out: AggregatedFinding[] = [];
    for (const f of filteredFiles) {
      for (const fi of (f.findings || [])) {
        if (filters.severity.size && !filters.severity.has(canonicalSeverity(fi))) continue;
        if (filters.category.size && !filters.category.has((fi.category || 'other').toLowerCase())) continue;
        out.push({ file: f.path, f: fi });
      }
    }
    return out;
  }, [filteredFiles, filters]);

  const severityTotals = useMemo(() => {
    const base: Record<string, number> = { high: 0, medium: 0, low: 0, info: 0 };
    for (const { f } of allFindings) {
      const sev = canonicalSeverity(f);
      base[sev] = (base[sev] || 0) + 1;
    }
    return base;
  }, [allFindings]);

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const { f } of allFindings) {
      const key = (f.category || 'other').toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [allFindings]);

  const languageTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of files) {
      const lang = (file.language || 'unknown').toLowerCase();
      map.set(lang, (map.get(lang) || 0) + (file.findings?.length || 0));
    }
    return map;
  }, [files]);

  const loadFile = useCallback(async (file: string) => {
    setSelectedFile(file);
    setExplanation(null);
    setHighlights([]);
    try {
      if (versionId) {
        const rf = await fetch(`/api/scan-file?versionId=${encodeURIComponent(String(versionId))}&path=${encodeURIComponent(file)}`);
        if (rf.ok) { const jj = await rf.json(); setFileContent(String(jj?.content || '')); } else { setFileContent(null); }
      }
      if (versionId) {
        const r = await fetch(`/api/file-primitives?versionId=${encodeURIComponent(versionId)}&path=${encodeURIComponent(file)}`);
        if (r.ok) {
          const j = await r.json();
          const hl = Array.isArray(j?.items) ? j.items.map((it: any) => ({ startLine: Number(it?.finding?.line || 1), severity: String(it?.finding?.severity || 'info'), message: String(it?.finding?.description || it?.finding?.ruleId || 'crypto finding') })) : [];
          setHighlights(hl);
        }
      }
    } catch {
      setFileContent(null);
    }
  }, [versionId]);

  useEffect(() => {
    if (showGraphs && allFindings.length === 0) {
      setShowGraphs(false);
    }
  }, [showGraphs, allFindings.length]);

  const codeTree = useMemo(() => buildTreeFromPaths(files.map((f) => f.path)), [files]);

  useEffect(() => {
    if (!codeTree.length) {
      setExpandedNodes((prev) => {
        // Avoid unnecessary updates when already empty
        return Object.keys(prev).length ? {} : prev;
      });
      return;
    }
    setExpandedNodes((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const node of codeTree) {
        if (!(node.path in next)) {
          next[node.path] = true;
          changed = true;
        }
      }
      // Only update state if something actually changed
      return changed ? next : prev;
    });
  }, [codeTree]);

  useEffect(() => {
    if (!showCodebase) return;
    if (selectedFile) return;
    const first = files[0]?.path;
    if (first) {
      loadFile(first);
    }
  }, [showCodebase, files, selectedFile, loadFile]);

  const onAskAI = useCallback(async (finding: Finding) => {
    if (!versionId || !selectedFile) return;
    setAskBusy(true); setExplanation(null);
    try {
      const body = { versionId, filePath: selectedFile, finding, snippet: finding.match };
      const res = await fetch(`/api/explain-finding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        const data = await res.json();
        setExplanation(String(data?.explanation || ''));
      } else {
        setExplanation('Explanation failed.');
      }
    } catch {
      setExplanation('Explanation failed.');
    } finally { setAskBusy(false); }
  }, [versionId, selectedFile]);

  const toggleNode = (path: string) => {
    setExpandedNodes((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const renderTree = (nodes: TreeNode[], depth = 0): React.ReactNode => {
    return nodes.map((node) => {
      const isFolder = node.type === "folder";
      const isExpanded = expandedNodes[node.path] ?? depth === 0;
      const isActive = selectedFile === node.path;
      const indent = 12 + Math.min(depth, 6) * 14;
      return (
        <div key={node.path} className={`tree-row ${isActive ? "active" : ""}`} style={{ paddingLeft: indent }}>
          {isFolder ? (
            <button
              type="button"
              className="tree-toggle"
              onClick={() => toggleNode(node.path)}
              aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="tree-spacer">•</span>
          )}
          <button
            type="button"
            className={`tree-label ${isFolder ? "folder" : "file"}`}
            onClick={() => {
              if (isFolder) {
                toggleNode(node.path);
              } else {
                loadFile(node.path);
              }
            }}
          >
            {node.name}
          </button>
          {isFolder && isExpanded && node.children?.length ? (
            <div className="tree-children">
              {renderTree(node.children, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  };

  const resetFilters = useCallback(() => {
    setFilters({ severity: new Set(), category: new Set(), cryptoOnly: false });
  }, []);

  const codePane = !selectedFile ? (
    <div className="empty-state" style={{ border: '1px dashed rgba(111,138,190,0.35)', padding: '2rem' }}>select a file from the left to preview</div>
  ) : (
    <div>
      <div className="filename-bar">
        <span className="name">{selectedFile}</span>
        {explanation ? <button className="secondary-button" onClick={()=>setExplanation(null)}>clear</button> : null}
      </div>
      {fileContent ? (
        <CodeViewer connectedTop value={fileContent} extension={'.'+String(selectedFile.split('.').pop()||'')} highlights={highlights} minHeight={320} maxHeight={720} />
      ) : (
        <div className="empty-state">loading file…</div>
      )}
      <div style={{ marginTop: '.75rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '.25rem' }}>findings in this file</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {(files.find(f=>f.path===selectedFile)?.findings || []).map((f, i) => (
            <li key={i} style={{ display: 'flex', gap: '.5rem', padding: '.35rem 0', borderBottom: '1px solid rgba(111,138,190,0.25)' }}>
              <span className={`badge severity-${(f.rankedSeverity||f.severity||'info').toLowerCase()}`}>{(f.rankedSeverity||f.severity||'info')}</span>
              <span style={{ flex: 1 }}>{f.ruleId || f.category || f.description}</span>
              {typeof f.line === 'number' ? <span style={{ color: 'var(--text-muted)' }}>line {f.line}</span> : null}
              <button className="secondary-button" disabled={askBusy} onClick={()=>onAskAI(f)}>ask ai</button>
            </li>
          ))}
        </ul>
      </div>
      {explanation ? (
        <div className="panel" style={{ marginTop: '.75rem' }}>
          <div className="panel-header"><h3>ai explanation</h3></div>
          <div className="panel-body">
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation) }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <main className="page" style={{ paddingTop: 0 }}>
      <div className="editor-grid" style={{ gridTemplateColumns: '360px 1fr', alignItems: 'stretch', minHeight: 'calc(100vh - 40px)' }}>
        <aside
          className="editor-sidebar panel findings-sidebar"
          style={{ width: 360, position: 'sticky', top: 0, alignSelf: 'start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}
        >
          <div className="sidebar-stack">
            <Filters value={filters} onChange={setFilters} onReset={resetFilters} />
            <div className="panel stats-panel">
              <div className="panel-header"><h3>overview</h3><p>Quick glance at the current findings.</p></div>
              <div className="panel-body compact">
                <div className="stats-grid">
                  {SEVERITY_OPTIONS.map((opt) => (
                    <div key={opt.key} className="stat-chip">
                      <span className="stat-label">
                        <span className={`toggle-dot ${opt.badge}`} aria-hidden />
                        {opt.label}
                      </span>
                      <span className="stat-value">{severityTotals[opt.key as keyof typeof severityTotals] || 0}</span>
                    </div>
                  ))}
                </div>
                {categoryTotals.size ? (
                  <div>
                    <span className="mini-heading">top categories</span>
                    <div className="badge-cloud">
                      {Array.from(categoryTotals.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6)
                        .map(([cat, count]) => (
                          <span key={cat} className="soft-badge">{cat} <span className="badge-count">{count}</span></span>
                        ))}
                    </div>
                  </div>
                ) : <div className="empty-note">No findings yet.</div>}
                {Array.from(languageTotals.entries()).some(([, val]) => val > 0) ? (
                  <div>
                    <span className="mini-heading">languages</span>
                    <div className="badge-cloud subtle">
                      {Array.from(languageTotals.entries())
                        .filter(([, count]) => count > 0)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6)
                        .map(([lang, count]) => (
                          <span key={lang} className="soft-badge">{lang} <span className="badge-count">{count}</span></span>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header"><h3>files</h3></div>
              <div className="panel-body" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {filteredFiles.map(f => (
                    <li key={f.path} className="file-entry" onClick={() => loadFile(f.path)}>
                      <span className="tree-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 3.75A1.75 1.75 0 0 1 8.75 2h4.69c.464 0 .909.185 1.237.513l3.81 3.81c.328.328.513.773.513 1.237v12.69A1.75 1.75 0 0 1 17.25 22H8.75A1.75 1.75 0 0 1 7 20.25V3.75z" stroke="currentColor" fill="none"/><path d="M14 2.5v3.25A1.25 1.25 0 0 0 15.25 7H18.5" stroke="currentColor"/></svg></span>
                      <span className="file-name">{f.path}</span>
                      <span className="badge soft">{f.findings.length}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </aside>
        <div className="editor-view" style={{ padding: '1rem 1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginBottom: (showGraphs || showCodebase) ? '0.75rem' : '.25rem' }}>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowGraphs((v) => !v)}
                  disabled={!allFindings.length}
                >
                  {showGraphs ? 'hide graphs' : 'show graphs'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowCodebase((v) => !v)}
                  disabled={!files.length}
                >
                  {showCodebase ? 'hide codebase' : 'show codebase'}
                </button>
              </div>
              {showGraphs ? (
                <AnalyticsPanel files={filteredFiles} findings={allFindings} onClose={() => setShowGraphs(false)} />
              ) : null}
              {showCodebase ? (
                <div className="codebase-layout">
                  <div className="codebase-tree" role="tree">
                    {codeTree.length ? renderTree(codeTree) : <div className="empty-state">no files available</div>}
                  </div>
                  <div className="codebase-viewer">
                    {codePane}
                  </div>
                </div>
              ) : (
                codePane
              )}
        </div>
      </div>
    </main>
  );
}
