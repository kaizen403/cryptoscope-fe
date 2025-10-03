"use client";

import dynamic from "next/dynamic";
import React, { useMemo } from "react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

function detectLanguageFromExtension(ext?: string) {
  switch ((ext || "").toLowerCase()) {
    case ".py":
      return "python";
    case ".js":
      return "javascript";
    case ".ts":
      return "typescript";
    case ".java":
      return "java";
    case ".c":
    case ".h":
      return "c";
    case ".cpp":
      return "cpp";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".php":
      return "php";
    case ".rb":
      return "ruby";
    case ".kt":
      return "kotlin";
    case ".scala":
      return "scala";
    case ".swift":
      return "swift";
    default:
      return "plaintext";
  }
}

type Highlight = { startLine: number; endLine?: number; severity?: string; message?: string };

export default function CodeViewer({
  value,
  extension,
  minHeight = 140,
  maxHeight = 480,
  highlights = [],
  onMount,
  connectedTop = false,
}: {
  value: string;
  extension?: string;
  minHeight?: number;
  maxHeight?: number;
  highlights?: Highlight[];
  onMount?: (editor: any) => void;
  connectedTop?: boolean;
}) {
  const lines = useMemo(() => value.split("\n").length, [value]);
  const height = useMemo(() => {
    const lineHeight = 18; // px
    const padding = 32; // px
    const raw = lines * lineHeight + padding;
    return Math.max(minHeight, Math.min(maxHeight, raw));
  }, [lines, minHeight, maxHeight]);

  const language = detectLanguageFromExtension(extension);

  // Manage line decorations for findings
  const decorationsRef = React.useRef<string[] | null>(null);
  const editorRef = React.useRef<any>(null);

  const applyDecorations = React.useCallback(() => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    const decos = (highlights || []).map(h => {
      const start = Math.max(1, Number(h.startLine || 1));
      const end = Math.max(start, Number(h.endLine || h.startLine || start));
      const sev = String(h.severity || 'info').toLowerCase();
      const cls = sev === 'error' ? 'dec-error' : sev === 'warning' ? 'dec-warning' : 'dec-info';
      return {
        range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: cls,
          inlineClassName: cls,
          glyphMarginClassName: cls,
          linesDecorationsClassName: cls,
          hoverMessage: h.message ? { value: h.message } : undefined,
        },
      } as any;
    });
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current || [], decos);
  }, [highlights]);

  React.useEffect(() => {
    applyDecorations();
  }, [applyDecorations]);

  const containerStyle = React.useMemo<React.CSSProperties>(() => ({
    borderRadius: connectedTop ? "0 0 12px 12px" : "12px",
    overflow: "hidden",
    border: "1px solid rgba(68,94,148,0.35)",
    borderTop: connectedTop ? "none" : undefined,
  }), [connectedTop]);

  return (
    <div style={containerStyle}>
      <MonacoEditor
        theme="vs-dark"
        language={language}
        value={value}
        options={{
          readOnly: true,
          domReadOnly: true,
          scrollBeyondLastLine: false,
          lineNumbers: "on",
          minimap: { enabled: false },
          padding: { top: 8, bottom: 8 },
        }}
        height={height}
        onMount={(editor) => {
          editorRef.current = editor;
          if (onMount) onMount(editor);
          applyDecorations();
        }}
      />
    </div>
  );
}
