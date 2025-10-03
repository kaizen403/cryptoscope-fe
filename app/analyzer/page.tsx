"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState, useRef, Suspense } from "react";
// Auth removed
import CodeViewer from "../../components/CodeViewer";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
const isProd = process.env.NODE_ENV === 'production';
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || (isProd ? "https://cryptoscope-be-latest.onrender.com" : "http://localhost:5050");

type Mode = "local" | "upload" | "git" | "stored";

type DirectoryEntry = { type: "folder" | "file"; name: string; path: string; level: number; supported?: boolean };
type TreeNode = { name: string; path: string; type: "folder" | "file"; level: number; supported?: boolean; children?: TreeNode[] };

type CryptoFunction = { name?: string; line_start?: number; content?: string; type?: string };
type CryptoSnippet = { name?: string; line_start?: number; code?: string; type?: string };
type BasicCryptoAnalysis = {
  file_path: string; file_name: string; file_extension: string; has_crypto: boolean;
  crypto_imports?: string[]; crypto_functions?: CryptoFunction[]; crypto_patterns_found?: string[];
  crypto_algorithms_detected?: Array<Record<string, unknown>>; code_snippets?: CryptoSnippet[];
};
type GeminiReview = { original_analysis?: BasicCryptoAnalysis; gemini_analysis?: string; crypto_summary?: any };
type RepoMeta = { id?: string | null; versionId?: string | null; [key: string]: any };
type AnalysisResult = {
  status?: string;
  total_files?: number;
  crypto_files_found?: number;
  message?: string;
  basic_analysis?: BasicCryptoAnalysis[];
  detailed_reviews?: GeminiReview[];
  versionId?: string | null;
  repo?: RepoMeta;
};

function buildTree(entries: DirectoryEntry[]): TreeNode[] {
  const tree: TreeNode[] = [];
  const stack: TreeNode[] = [];
  const addUnique = (arr: TreeNode[], node: TreeNode): TreeNode => {
    const existing = arr.find(n => n.path === node.path && n.type === node.type);
    if (existing) {
      return existing;
    }
    arr.push(node);
    return node;
  };
  for (const entry of entries) {
    const node: TreeNode = {
      name: entry.name,
      path: entry.path,
      type: entry.type,
      level: entry.level,
      supported: entry.supported,
      children: entry.type === 'folder' ? [] : undefined
    };
    while (stack.length && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }
    if (!stack.length) {
      const added = addUnique(tree, node);
      if (entry.type === 'folder') stack.push(added);
    } else {
      const parent = stack[stack.length - 1];
      parent.children ||= [];
      const added = addUnique(parent.children, node);
      if (entry.type === 'folder') stack.push(added);
    }
  }
  return tree;
}

function getFilesCollection(result: AnalysisResult | null) {
  if (!result) return [] as { analysis: BasicCryptoAnalysis; review?: GeminiReview }[];
  if (result.detailed_reviews?.length) return result.detailed_reviews.map(r => ({ analysis: r.original_analysis || (r as unknown as BasicCryptoAnalysis), review: r })).filter(x => x.analysis);
  if (result.basic_analysis?.length) return result.basic_analysis.map(a => ({ analysis: a }));
  return [];
}

function EditorContent({ selectedPath, files, versionId, repoId }: { selectedPath: string; files: { analysis: BasicCryptoAnalysis; review?: GeminiReview }[]; versionId?: string | null; repoId?: string | null }) {
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<{ startLine: number; endLine?: number; severity?: string; message?: string }[]>([]);
  const [ext, setExt] = useState<string | undefined>(undefined);
  
  const entry = files.find(f => f.analysis.file_path === selectedPath);
  const a = entry?.analysis;
  useEffect(() => {
    const e = (selectedPath.match(/\.[a-z0-9]+$/i)?.[0] || a?.file_extension || '').toLowerCase();
    setExt(e.startsWith('.') ? e : (e ? `.${e}` : undefined));
  }, [selectedPath, a?.file_extension]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // highlights from findings for this file
        if (versionId) {
          const r = await fetch(`/api/file-primitives?versionId=${encodeURIComponent(versionId)}&path=${encodeURIComponent(selectedPath)}`);
          if (r.ok) {
            const j = await r.json();
            const hl = Array.isArray(j?.items) ? j.items.map((it: any) => ({
              startLine: Number(it?.finding?.line || 1),
              severity: String(it?.finding?.severity || 'info'),
              message: String(it?.finding?.description || it?.finding?.ruleId || 'crypto finding'),
            })) : [];
            if (!cancelled) setHighlights(hl);
          }
        }
      } catch {}
      try {
        const id = repoId || versionId;
        if (id) {
          const rf = await fetch(`/api/repo-file?id=${encodeURIComponent(String(id))}&path=${encodeURIComponent(selectedPath)}`);
          if (rf.ok) {
            const jj = await rf.json();
            if (!cancelled) setFileContent(String(jj?.content || ''));
          } else {
            if (!cancelled) setFileContent(null);
          }
        } else {
          setFileContent(null);
        }
      } catch {
        if (!cancelled) setFileContent(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedPath, versionId, repoId]);
  
  // Early return after all hooks
  if (!entry) return <div className="empty-state">No analysis available for {selectedPath}.</div>;
  
  if (fileContent) {
    return (
      <div>
        <CodeViewer value={fileContent} extension={ext} highlights={highlights} minHeight={280} maxHeight={680} />
      </div>
    );
  }
  if (a?.code_snippets?.length) {
    const hl = (a.crypto_functions || []).map((fn) => ({ startLine: Number(fn.line_start || 0) || 1, severity: 'info', message: fn.type || fn.name || 'crypto usage' }));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {a.code_snippets.map((snip, i) => (
          <div key={`snip-${i}`}>
            <strong>{snip.name || snip.type || 'Snippet'}{snip.line_start ? ` (line ${snip.line_start})` : ''}</strong>
            {snip.code ? <CodeViewer value={snip.code} extension={a.file_extension} highlights={hl} /> : null}
          </div>
        ))}
      </div>
    );
  }
  return <div className="empty-state">No code or snippets available for this file.</div>;
}

function AnalyzerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>('git');
  const [directoryPath, setDirectoryPath] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [treeEntries, setTreeEntries] = useState<DirectoryEntry[]>([]);
  const treeData = useMemo(() => buildTree(treeEntries), [treeEntries]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeJob, setActiveJob] = useState<Mode | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [progressMsg, setProgressMsg] = useState('initializing...');
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Backend health check state
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null); // null = checking, true = healthy, false = unhealthy
  const [backendStarting, setBackendStarting] = useState(false);
  const healthCheckRef = useRef<NodeJS.Timeout | null>(null);
  const logMsg = useCallback((msg: string) => {
    // logs suppressed during analysis per UX feedback
  }, []);

  const files = useMemo(() => getFilesCollection(analysisResult), [analysisResult]);
  const versionId = useMemo(() => analysisResult?.versionId || analysisResult?.repo?.versionId || null, [analysisResult]);
  const repoId = useMemo(() => analysisResult?.repo?.id || analysisResult?.versionId || null, [analysisResult]);

  // Backend health check function
  const checkBackendHealth = useCallback(async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(`${BACKEND_URL}/healthz`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        return data.ok === true;
      }
      return false;
    } catch (error) {
      console.log('Backend health check failed:', error);
      return false;
    }
  }, []);

  // Start health monitoring
  const startHealthMonitoring = useCallback(() => {
    const performHealthCheck = async () => {
      const isHealthy = await checkBackendHealth();
      
      if (isHealthy) {
        setBackendHealthy(true);
        setBackendStarting(false);
        // Schedule next check in 30 seconds (normal monitoring)
        healthCheckRef.current = setTimeout(performHealthCheck, 30000);
      } else {
        if (backendHealthy === true) {
          // Backend just went down
          setBackendStarting(true);
        }
        setBackendHealthy(false);
        // Retry in 5 seconds when backend is down
        healthCheckRef.current = setTimeout(performHealthCheck, 5000);
      }
    };

    performHealthCheck();
  }, [checkBackendHealth, backendHealthy]);

  // Handle git_url parameter from hero page
  useEffect(() => {
    const gitUrlParam = searchParams.get('git_url');
    if (gitUrlParam) {
      setGitUrl(gitUrlParam);
      setMode('git');
    }
  }, [searchParams]);

  // Start health monitoring on component mount
  useEffect(() => {
    startHealthMonitoring();
    
    return () => {
      if (healthCheckRef.current) {
        clearTimeout(healthCheckRef.current);
      }
    };
  }, [startHealthMonitoring]);

  const startProgress = () => {
    // No longer needed - real progress is set by SSE events
    if (timerRef.current) clearInterval(timerRef.current);
  };
  const stopProgress = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgressPct(100);
    // Keep at 100% briefly to show completion, then reset
    setTimeout(() => {
      setProgressPct(0);
      setProgressMsg('initializing...');
    }, 1000);
  };

  const fetchDirectoryTree = useCallback(async (p: string) => {
    try {
      logMsg(`fetching directory structure for ${p}`);
      const res = await fetch(`/api/directory-structure?path=${encodeURIComponent(p)}`);
      if (!res.ok) return;
      const payload = await res.json();
      const entries = (payload?.entries || []) as DirectoryEntry[];
      setTreeEntries(entries);
      const defaults: Record<string, boolean> = {};
      entries.forEach(e => { if (e.type === 'folder' && e.level <= 1) defaults[e.path] = true; });
      setExpanded(defaults);
      logMsg(`loaded ${entries.length} directory entries`);
    } catch {}
  }, [logMsg]);

  const onAnalyzeLocal = async () => {
    if (!directoryPath.trim()) return;
    
    // Check backend health before proceeding
    if (backendHealthy !== true) {
      console.log('Backend not healthy, checking status...');
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        alert('Backend is starting up. Please wait a moment and try again.');
        return;
      }
    }
    
    setActiveJob('local');
    setLoading(true);
    setProgressPct(1);
    setProgressMsg('initializing...');
    try {
      // Connect directly to backend to avoid Next.js proxy buffering
      const url = `${BACKEND_URL}/api/analyze-sse?path=${encodeURIComponent(directoryPath.trim())}`;
      console.log('[SSE] Connecting to:', url);
      logMsg(`connecting SSE: ${directoryPath.trim()}`);
      const es = new EventSource(url);
      let finished = false;
      let eventCount = 0;
      let safetyTimer: NodeJS.Timeout | null = null;
      const resetSafety = () => {
        if (safetyTimer) clearTimeout(safetyTimer);
        // 15 minutes inactivity warning (do not auto-finalize)
        safetyTimer = setTimeout(() => {
          if (!finished) {
            console.warn('[SSE] Inactivity timeout (15m) - still waiting for events...');
            setProgressMsg('still working...');
          }
        }, 15 * 60 * 1000);
      };
      resetSafety();
      
      const finalize = (data?: any) => {
        if (finished) return;
        finished = true;
        console.log('[SSE] Finalizing, total events received:', eventCount);
        try { es.close(); } catch {}
        if (safetyTimer) { try { clearTimeout(safetyTimer); } catch {} safetyTimer = null; }
        setLoading(false);
        setActiveJob(null);
        
        if (data) {
          setProgressMsg('analysis complete!');
          setProgressPct(100);
          setTimeout(() => {
            stopProgress();
            const targetVersion = data?.versionId || null;
            if (targetVersion) {
              router.push(`/findings?versionId=${encodeURIComponent(String(targetVersion))}`);
            } else {
              router.push('/findings');
            }
          }, 500);
        } else {
          stopProgress();
        }
      };
      
      es.onopen = () => {
        console.log('[SSE] Connection opened, readyState:', es.readyState);
        setProgressMsg('connected...');
        setProgressPct(2);
        resetSafety();
      };
      
      es.onmessage = (ev: MessageEvent) => {
        eventCount++;
        console.log('[SSE] Generic message event:', ev.data);
        resetSafety();
      };
      
      es.onerror = (ev: any) => {
        console.error('[SSE] Error event, readyState:', es.readyState, 'finished:', finished, ev);
        if (finished) return;
        if (es.readyState === EventSource.CLOSED) {
          console.error('[SSE] Connection closed unexpectedly');
          finalize();
        } else if (es.readyState === EventSource.CONNECTING) {
          console.log('[SSE] Reconnecting...');
          setProgressMsg('reconnecting...');
        }
        resetSafety();
      };
      
      es.addEventListener('collecting', (ev: MessageEvent) => {
        eventCount++;
        console.log('[SSE] Event: collecting', ev.data);
        try {
          const d = JSON.parse(ev.data);
          const msg = d?.message || 'collecting files…';
          setProgressMsg(msg);
          setProgressPct(5);
        } catch (e) {
          console.error('[SSE] Error parsing collecting:', e);
        }
        resetSafety();
      });
      
      es.addEventListener('start', (ev: MessageEvent) => {
        eventCount++;
        console.log('[SSE] Event: start', ev.data);
        try {
          const d = JSON.parse(ev.data);
          setProgressMsg(`scanning ${d?.total||0} files`);
          setProgressPct(10);
        } catch (e) {
          console.error('[SSE] Error parsing start:', e);
        }
        resetSafety();
      });
      
      es.addEventListener('scanning', (ev: MessageEvent) => {
        eventCount++;
        try {
          const d = JSON.parse(ev.data);
          const done = Number(d?.done||0), total = Number(d?.total||0);
          const pct = total > 0 ? Math.min(90, 10 + Math.round((done/total)*75)) : 15;
          console.log(`[SSE] Event: scanning ${done}/${total} (${pct}%)`);
          setProgressPct(pct);
          setProgressMsg(`scanning files: ${done}/${total}`);
        } catch (e) {
          console.error('[SSE] Error parsing scanning:', e);
        }
        resetSafety();
      });
      
      es.addEventListener('indexing', (ev: MessageEvent) => {
        eventCount++;
        console.log('[SSE] Event: indexing', ev.data);
        try {
          const d = JSON.parse(ev.data);
          const msg = d?.message || 'indexing…';
          setProgressMsg(msg);
        } catch (e) {
          console.error('[SSE] Error parsing indexing:', e);
        }
        resetSafety();
      });
      
      es.addEventListener('enriching', (ev: MessageEvent) => {
        eventCount++;
        console.log('[SSE] Event: enriching', ev.data);
        try {
          const d = JSON.parse(ev.data);
          const msg = d?.message || 'enriching findings…';
          setProgressMsg(msg);
          setProgressPct(92);
        } catch (e) {
          console.error('[SSE] Error parsing enriching:', e);
        }
        resetSafety();
      });
      
      es.addEventListener('done', (ev: MessageEvent) => {
        eventCount++;
        console.log('[SSE] Event: done', ev.data);
        try {
          if (finished) return;
          const data = JSON.parse(ev.data);
          setAnalysisResult(data);
          console.log('[SSE] Analysis complete, files:', data?.total_files, 'crypto:', data?.crypto_files_found);
          finalize(data);
        } catch (e:any) {
          console.error('[SSE] Error parsing done event:', e);
          finalize();
        }
      });
      es.addEventListener('ping', () => { resetSafety(); });
      // Remove short safety timeout; rely on resettable long inactivity timer
    } catch (e: any) {
      console.error('[SSE] Exception:', e);
      setLoading(false);
      setActiveJob(null);
      stopProgress();
    }
  };
  const onAnalyzeGit = async () => {
    if (!gitUrl.trim()) return;
    
    // Check backend health before proceeding
    if (backendHealthy !== true) {
      console.log('Backend not healthy, checking status...');
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        alert('Backend is starting up. Please wait a moment and try again.');
        return;
      }
    }
    
    setActiveJob('git');
    setLoading(true);
    setProgressPct(1);
    setProgressMsg('connecting...');
    try {
      // Connect directly to backend to avoid Next.js proxy buffering
      const url = `${BACKEND_URL}/api/scan-repo-sse?url=${encodeURIComponent(gitUrl.trim())}&force=true`;
      console.log('[SSE] Connecting to:', url);
      logMsg(`connecting SSE: ${gitUrl.trim()}`);
      const es = new EventSource(url);
      let finished = false;
      let safetyTimer: NodeJS.Timeout | null = null;
      const resetSafety = () => {
        if (safetyTimer) clearTimeout(safetyTimer);
        safetyTimer = setTimeout(() => {
          if (!finished) {
            console.warn('[SSE] Inactivity timeout (15m) - still working...');
            setProgressMsg('still working...');
          }
        }, 15 * 60 * 1000);
      };
      resetSafety();
      const finalize = (data?: any) => {
        if (finished) return;
        finished = true;
        try { es.close(); } catch {}
        if (safetyTimer) { try { clearTimeout(safetyTimer); } catch {} safetyTimer = null; }
        setLoading(false);
        setActiveJob(null);
        
        if (data) {
          setProgressMsg('analysis complete!');
          setProgressPct(100);
          // Small delay to show completion before redirecting
          setTimeout(() => {
            stopProgress();
            const targetVersion = data?.repo?.versionId || data?.versionId || null;
            if (targetVersion) {
              router.push(`/findings?versionId=${encodeURIComponent(String(targetVersion))}`);
            } else {
              router.push('/findings');
            }
          }, 500);
        } else {
          stopProgress();
        }
      };
      es.addEventListener('open', () => { logMsg('connected to analysis stream'); resetSafety(); });
      es.addEventListener('cloning', (ev: MessageEvent) => {
        try { const d = JSON.parse(ev.data); const msg = d?.message || 'cloning…'; logMsg(msg); setProgressMsg(msg); } catch { logMsg('cloning…'); setProgressMsg('cloning…'); }
        resetSafety();
      });
      es.addEventListener('collecting', (ev: MessageEvent) => {
        try { const d = JSON.parse(ev.data); const msg = d?.message || 'collecting files…'; logMsg(msg); setProgressMsg(msg); } catch { logMsg('collecting files…'); setProgressMsg('collecting files…'); }
        resetSafety();
      });
      es.addEventListener('start', (ev: MessageEvent) => {
        try { const d = JSON.parse(ev.data); const msg = `scanning ${d?.total||0} files`; logMsg(`scan start: ${d?.total||0} files`); setProgressMsg(msg); } catch { logMsg('scan start'); setProgressMsg('scanning files...'); }
        resetSafety();
      });
      es.addEventListener('scanning', (ev: MessageEvent) => {
        try { const d = JSON.parse(ev.data); const done = Number(d?.done||0), total = Number(d?.total||0); setProgressPct(total>0? Math.min(90, Math.round((done/total)*90)) : 10); setProgressMsg(`scanning files: ${done}/${total}`); } catch {}
        resetSafety();
      });
      es.addEventListener('indexing', (ev: MessageEvent) => {
        try { const d = JSON.parse(ev.data); const msg = d?.message || 'indexing…'; logMsg(msg); setProgressMsg(msg); } catch { logMsg('indexing…'); setProgressMsg('indexing…'); }
        resetSafety();
      });
      es.addEventListener('enriching', (ev: MessageEvent) => {
        try { const d = JSON.parse(ev.data); const msg = d?.message || 'enriching findings…'; logMsg(msg); setProgressMsg(msg); } catch { logMsg('enriching findings…'); setProgressMsg('enriching findings…'); }
        resetSafety();
      });
      es.addEventListener('cached', (ev: MessageEvent) => {
        try {
          if (finished) return;
          const data = JSON.parse(ev.data);
          setAnalysisResult(data);
          logMsg(`using cached analysis: files=${data?.total_files||0}, crypto_files=${data?.crypto_files_found||0}`);
          const paths = getFilesCollection(data).map(f => f.analysis.file_path);
          const entries: DirectoryEntry[] = [];
          paths.forEach(p=>{ const parts=p.split('/').filter(Boolean); let agg=''; parts.forEach((seg,i)=>{ agg = agg ? `${agg}/${seg}` : seg; entries.push({ type: i===parts.length-1?'file':'folder', name: seg, path: agg, level: i, supported: true }); }); });
          setTreeEntries(entries);
          finalize(data);
        } catch (e:any) { logMsg(`cached parse failed: ${e?.message||e}`); }
        resetSafety();
      });
      es.addEventListener('done', (ev: MessageEvent) => {
        try {
          if (finished) return;
          const data = JSON.parse(ev.data);
          setAnalysisResult(data);
          logMsg(`analysis complete: files=${data?.total_files||0}, crypto_files=${data?.crypto_files_found||0}`);
          const paths = getFilesCollection(data).map(f => f.analysis.file_path);
          const entries: DirectoryEntry[] = [];
          paths.forEach(p=>{ const parts=p.split('/').filter(Boolean); let agg=''; parts.forEach((seg,i)=>{ agg = agg ? `${agg}/${seg}` : seg; entries.push({ type: i===parts.length-1?'file':'folder', name: seg, path: agg, level: i, supported: true }); }); });
          setTreeEntries(entries);
          finalize(data);
        } catch (e:any) {
          console.error('Error parsing done event:', e);
          logMsg(`done parse failed: ${e?.message||e}`);
          finalize();
        }
        resetSafety();
      });
      es.addEventListener('ping', () => { resetSafety(); });
      es.addEventListener('error', (ev: any) => {
        if (finished) return;
        console.error('SSE error event:', ev);
        logMsg('stream error');
        // Only finalize if the connection is actually closed
        if (es.readyState === EventSource.CLOSED) {
          finalize();
        }
        resetSafety();
      });
      // Removed short safety timeout; rely on resettable inactivity timer
    } catch (e:any) {
      logMsg(`git analysis failed: ${e?.message || e}`);
      setLoading(false);
      setActiveJob(null);
      stopProgress();
    }
  };
  const onAnalyzeZip = async () => {
    if (!zipFile) return;
    
    // Check backend health before proceeding
    if (backendHealthy !== true) {
      console.log('Backend not healthy, checking status...');
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        alert('Backend is starting up. Please wait a moment and try again.');
        return;
      }
    }
    
    setActiveJob('upload');
    setLoading(true);
    setProgressPct(1);
    try {
      logMsg(`uploading ZIP (${zipFile.name}), analyzing...`);
      const fd = new FormData(); fd.append('file', zipFile);
      
      // For SSE with file upload, we need to use XMLHttpRequest
      // Connect directly to backend to avoid Next.js proxy buffering
      const xhr = new XMLHttpRequest();
      const uploadUrl = `${BACKEND_URL}/api/upload-zip-sse`;
      console.log('[ZIP-SSE] Uploading to:', uploadUrl);
      xhr.open('POST', uploadUrl, true);
      
      let finished = false;
      const finalize = (data?: any) => {
        if (finished) return;
        finished = true;
        setLoading(false);
        setActiveJob(null);
        
        if (data) {
          setProgressMsg('analysis complete!');
          setProgressPct(100);
          // Small delay to show completion before redirecting
          setTimeout(() => {
            stopProgress();
            const targetVersion = data?.versionId || null;
            router.push(targetVersion ? `/findings?versionId=${encodeURIComponent(String(targetVersion))}` : '/findings');
          }, 500);
        } else {
          stopProgress();
        }
      };

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const uploadPct = Math.round((e.loaded / e.total) * 5); // Upload is 0-5%
          setProgressPct(Math.max(1, uploadPct));
        }
      });

      xhr.addEventListener('readystatechange', () => {
        if (xhr.readyState === 3) { // LOADING - receiving response
          const text = xhr.responseText;
          const lines = text.split('\n\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            const eventMatch = line.match(/^event: (.+)$/);
            const dataMatch = line.match(/^data: (.+)$/m);
            
            if (eventMatch && dataMatch) {
              const event = eventMatch[1];
              try {
                const data = JSON.parse(dataMatch[1]);
                
                switch (event) {
                  case 'extracting':
                    const extractMsg = data?.message || 'extracting archive…';
                    logMsg(extractMsg);
                    setProgressMsg(extractMsg);
                    setProgressPct(6);
                    break;
                  case 'collecting':
                    const collectMsg = data?.message || 'collecting files…';
                    logMsg(collectMsg);
                    setProgressMsg(collectMsg);
                    setProgressPct(8);
                    break;
                  case 'start':
                    logMsg(`scan start: ${data?.total||0} files`);
                    setProgressMsg(`scanning ${data?.total||0} files`);
                    setProgressPct(10);
                    break;
                  case 'scanning':
                    const done = Number(data?.done||0), total = Number(data?.total||0);
                    setProgressPct(total>0? Math.min(90, 10 + Math.round((done/total)*75)) : 15);
                    setProgressMsg(`scanning files: ${done}/${total}`);
                    break;
                  case 'indexing':
                    const indexMsg = data?.message || 'indexing…';
                    logMsg(indexMsg);
                    setProgressMsg(indexMsg);
                    break;
                  case 'enriching':
                    const enrichMsg = data?.message || 'enriching findings…';
                    logMsg(enrichMsg);
                    setProgressMsg(enrichMsg);
                    setProgressPct(92);
                    break;
                  case 'cached':
                    setAnalysisResult(data);
                    logMsg(`using cached analysis: files=${data?.total_files||0}, crypto_files=${data?.crypto_files_found||0}`);
                    finalize(data);
                    break;
                  case 'done':
                    setAnalysisResult(data);
                    logMsg(`zip analysis complete: files=${data?.total_files||0}, crypto_files=${data?.crypto_files_found||0}`);
                    finalize(data);
                    break;
                  case 'error':
                    logMsg(`error: ${data?.message || 'unknown error'}`);
                    console.error('SSE error received:', data);
                    finalize();
                    break;
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
            }
          }
        } else if (xhr.readyState === 4) { // DONE
          if (!finished) {
            if (xhr.status === 200) {
              logMsg('upload completed');
            } else {
              logMsg('upload failed');
            }
            finalize();
          }
        }
      });

      xhr.addEventListener('error', () => {
        if (!finished) {
          logMsg('upload error');
          finalize();
        }
      });

      xhr.send(fd);

      // Safety timeout (180s for ZIP upload which takes longer)
      setTimeout(() => {
        if (!finished) {
          logMsg('upload timeout');
          finalize();
        }
      }, 180000);
    } catch (e: any) {
      logMsg(`zip analysis failed: ${e?.message || e}`);
      setLoading(false);
      setActiveJob(null);
      stopProgress();
    }
  };

  const toggle = (p: string) => setExpanded(prev => ({ ...prev, [p]: !prev[p] }));
  const renderNodes = (nodes: TreeNode[], depth = 0): JSX.Element => (
    <ul className={`tree-level ${depth===0? 'root':''}`}>
      {nodes.map(node => {
        const isFolder = node.type === 'folder';
        const isExpanded = isFolder ? expanded[node.path] ?? node.level <= 1 : false;
        return (
          <li key={`${node.type}:${node.path}`} className={`tree-item ${isFolder ? 'folder':'file'}`} data-depth={node.level}>
            <div className={`tree-row ${selectedPath === node.path ? 'selected':''}`} onClick={() => { if (!isFolder) setSelectedPath(node.path); }} role={!isFolder ? 'button': undefined}>
              {isFolder ? (
                <button type="button" className={`tree-toggle ${isExpanded ? 'expanded':''}`} onClick={() => toggle(node.path)} aria-label={`${isExpanded?'Collapse':'Expand'} folder ${node.name}`} />
              ) : <span className="tree-toggle placeholder" aria-hidden="true" />}
              <span className="tree-icon" aria-hidden="true">{isFolder ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6.75A2.75 2.75 0 0 1 5.75 4h4.086a1.75 1.75 0 0 1 1.237.513l1.414 1.414c.328.328.773.513 1.237.513H18.25A2.75 2.75 0 0 1 21 9.19v8.06A2.75 2.75 0 0 1 18.25 20H5.75A2.75 2.75 0 0 1 3 17.25V6.75z" fill="currentColor"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 3.75A1.75 1.75 0 0 1 8.75 2h4.69c.464 0 .909..185 1.237.513l3.81 3.81c.328.328.513.773.513 1.237v12.69A1.75 1.75 0 0 1 17.25 22H8.75A1.75 1.75 0 0 1 7 20.25V3.75z" stroke="currentColor" fill="none"/><path d="M14 2.5v3.25A1.25 1.25 0 0 0 15.25 7H18.5" stroke="currentColor"/></svg>
              )}</span>
              <span className={`tree-label ${!isFolder ? 'supported':''}`}>{node.name}</span>
            </div>
            {isFolder && isExpanded && node.children?.length ? renderNodes(node.children, depth+1) : null}
          </li>
        );
      })}
    </ul>
  );

  // Auth removed: always render analyzer UI

  const overlayVisible = loading || progressPct > 0;
  const localBusy = activeJob === 'local' && loading;
  const gitBusy = activeJob === 'git' && loading;
  const zipBusy = activeJob === 'upload' && loading;

  return (
    <main className={`page started ${overlayVisible ? 'blurred' : ''}`}>
      {overlayVisible && (
        <div className="analysis-overlay">
          <div className="overlay-card">
            <div className="spinner" aria-hidden="true" />
            <div className="overlay-text">{progressMsg}</div>
            <div className="overlay-progress">
              <div className="overlay-bar" style={{ width: `${Math.max(progressPct, loading ? 5 : progressPct)}%` }} />
            </div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {progressPct > 0 ? `${Math.round(progressPct)}%` : ''}
            </div>
          </div>
        </div>
      )}
      <div className="page-shell analyzer-shell">
        <div className="analyzer-top">
          <div>
            <h2>analyzer</h2>
            <p>configure sources, run scans, and review cryptographic findings.</p>
          </div>
          <div className={`status-chip ${backendHealthy === null ? 'checking' : backendHealthy ? '' : 'offline'}`}>
            {backendHealthy === null ? 'Checking Backend' : 
             backendHealthy ? 'Backend Ready' : 
             backendStarting ? 'Backend Starting' : 'Backend Offline'}
          </div>
        </div>
        {(loading || progressPct>0) && (
          <div className="progress" style={{ marginBottom: '1rem' }}><div className="bar" style={{ width: `${progressPct}%` }} /></div>
        )}
        <section className="editor-shell fade-in" style={{ marginTop: 0 }}>
          <div className="editor-grid">
            {/* project files panel intentionally hidden to simplify analyzer UI */}
            <div className="editor-view" style={{ visibility: loading ? 'hidden' : 'visible' }}>
              {selectedPath ? (
                <>
                  <FindingsHeader versionId={versionId} path={selectedPath} />
                  <EditorContent selectedPath={selectedPath} files={files} versionId={versionId} repoId={repoId} />
                </>
              ) : null}
              {selectedPath && versionId && (
                <div className="panel" style={{ marginTop: '1rem' }}>
                  <div className="panel-header"><h3>primitives</h3></div>
                  <div className="panel-body">
                    <Primitives versionId={versionId} path={selectedPath} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className={`card-grid ${loading ? 'is-blurred' : ''}`}>
          <article className="panel">
            <div className="panel-header"><h2>analysis controls</h2><p>choose a source and run your scan.</p></div>
            <div className="panel-body">
              {mode==='git' && (
                <div className="highlight-block">
                  <div className="field-group">
                    <label htmlFor="git">repository url</label>
                    <input id="git" placeholder="https://github.com/org/repo.git" value={gitUrl} onChange={e=>setGitUrl(e.target.value)} />
                    <button className={`primary-button ${gitBusy ? 'is-loading' : ''}`} type="button" onClick={()=>onAnalyzeGit()} disabled={!gitUrl.trim() || loading || backendHealthy !== true}>
                      {gitBusy && <span className="btn-spinner" aria-hidden="true" />}
                      {backendHealthy === null && <span className="btn-spinner" aria-hidden="true" />}
                      <span>
                        {backendHealthy === null ? 'checking backend...' :
                         backendHealthy === false ? 'backend starting...' :
                         gitBusy ? 'analyzing…' : 'analyze repository'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
              <div className="mode-list">
                {(['git','local','upload','stored'] as Mode[]).map(m => (
                  <button key={m} className={`mode-button ${mode===m?'active':''}`} onClick={()=>setMode(m)}>
                    <div><div>{m==='local'?'Local directory':m==='upload'?'Upload ZIP':m==='git'?'Git repository':'Stored datasets'}</div><span>{m==='local'?'use a path on this machine':m==='upload'?'upload a zip to analyze':m==='git'?'clone and analyze a repo':'analyze previously stored items'}</span></div>
                    <span className="small-caps">{m}</span>
                  </button>
                ))}
              </div>

              {mode==='local' && (
                <div className="field-group">
                  <label htmlFor="path">directory path</label>
                  <input id="path" placeholder="/path/to/project" value={directoryPath} onChange={e=>setDirectoryPath(e.target.value)} />
                  <div style={{ display:'flex', gap:'.75rem' }}>
                    <button className="secondary-button" type="button" onClick={()=>fetchDirectoryTree(directoryPath)} disabled={!directoryPath.trim() || loading}>preview structure</button>
                    <button className={`primary-button ${localBusy ? 'is-loading' : ''}`} type="button" onClick={()=>onAnalyzeLocal()} disabled={!directoryPath.trim() || loading || backendHealthy !== true}>
                      {localBusy && <span className="btn-spinner" aria-hidden="true" />}
                      {backendHealthy === null && <span className="btn-spinner" aria-hidden="true" />}
                      <span>
                        {backendHealthy === null ? 'checking backend...' :
                         backendHealthy === false ? 'backend starting...' :
                         localBusy ? 'analyzing…' : 'analyze'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
              {mode==='upload' && (
                <div className="field-group">
                  <label htmlFor="zip">zip archive</label>
                  <input id="zip" type="file" accept=".zip" onChange={e=>setZipFile(e.target.files?.[0] ?? null)} />
                  <button className={`primary-button ${zipBusy ? 'is-loading' : ''}`} type="button" onClick={()=>onAnalyzeZip()} disabled={!zipFile || loading || backendHealthy !== true}>
                    {zipBusy && <span className="btn-spinner" aria-hidden="true" />}
                    {backendHealthy === null && <span className="btn-spinner" aria-hidden="true" />}
                    <span>
                      {backendHealthy === null ? 'checking backend...' :
                       backendHealthy === false ? 'backend starting...' :
                       zipBusy ? 'analyzing…' : 'analyze zip'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </article>

          {analysisResult ? (
            <article className="panel">
              <div className="panel-header"><h2>summary</h2><p>high-level metrics from the latest scan.</p></div>
              <div className="panel-body">
                <div className="metrics-grid">
                  <div className="metric-card"><span className="metric-label">total files</span><span className="metric-value">{analysisResult.total_files ?? 0}</span></div>
                  <div className="metric-card"><span className="metric-label">crypto files</span><span className="metric-value">{analysisResult.crypto_files_found ?? 0}</span></div>
                  <div className="metric-card"><span className="metric-label">ai reviews</span><span className="metric-value">{analysisResult.detailed_reviews?.length ?? 0}</span></div>
                </div>
              </div>
            </article>
          ) : null}
        </div>
        <footer className="footer">© Digital Fortress</footer>
      </div>
    </main>
  );
}

export default function AnalyzerPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AnalyzerPageInner />
    </Suspense>
  );
}

function Primitives({ versionId, path }: { versionId: string; path: string }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    setItems(null); setError(null);
    const url = `/api/file-primitives?versionId=${encodeURIComponent(versionId)}&path=${encodeURIComponent(path)}`;
    fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    }).then((data) => { if (!cancel) setItems(data?.items || []); }).catch((e) => { if (!cancel) setError(e?.message || 'failed to load primitives'); });
    return () => { cancel = true; };
  }, [versionId, path]);
  if (error) return <div className="alert error">{error}</div> as any;
  if (!items) return <div className="empty-state">loading primitives…</div> as any;
  if (!items.length) return <div className="empty-state">no primitives found for this file</div> as any;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
      {items.map((it, idx) => (
        <div key={idx} className="file-card">
          <div className="file-meta">
            <span>line {it?.finding?.line}</span>
            <span>{it?.finding?.ruleId}</span>
            <span className={`badge severity-${(it?.finding?.severity || 'info')}`}>{it?.finding?.severity}</span>
          </div>
          <div>
            <strong>{it?.finding?.description}</strong>
            {it?.finding?.recommendation && (
              <div className="alert info" style={{ marginTop: '.5rem' }}>Fix: {it?.finding?.recommendation}</div>
            )}
          </div>
          {it?.enrichment && (
            <div className="badge-row" style={{ marginTop: '.5rem' }}>
              {it.enrichment.primitive && <span className="badge patterns">{it.enrichment.primitive}</span>}
              {it.enrichment.algorithm && <span className="badge algorithms">{it.enrichment.algorithm}</span>}
              {it.enrichment.mode && <span className="badge functions">{it.enrichment.mode}</span>}
            </div>
          )}
          {Array.isArray(it?.matches) && it.matches.length > 0 && (
            <div className="code-block" style={{ marginTop: '.6rem' }}>
              <CodeViewer
                value={it.matches[0]?.content || ''}
                extension={'.' + String(path.split('.').pop() || '')}
                highlights={[{ startLine: Number(it?.finding?.line || 1), severity: String(it?.finding?.severity || 'info'), message: it?.finding?.description }]}
                minHeight={120}
                maxHeight={320}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FindingsHeader({ versionId, path }: { versionId: string | null; path: string }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!versionId) return;
    let cancel = false; setItems(null);
    fetch(`/api/file-primitives?versionId=${encodeURIComponent(versionId)}&path=${encodeURIComponent(path)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('failed to load')))
      .then(j => { if (!cancel) setItems(Array.isArray(j?.items) ? j.items : []); })
      .catch(() => { if (!cancel) setItems([]); });
    return () => { cancel = true; };
  }, [versionId, path]);
  const total = items?.length || 0;
  return (
    <div className="panel" style={{ marginBottom: '0.75rem' }}>
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <h3 style={{ margin: 0 }}>findings</h3>
          <span className="badge" style={{ background: 'rgba(79,124,245,0.18)', border: '1px solid rgba(79,124,245,0.3)' }}>{total}</span>
        </div>
        <button type="button" className="secondary-button" onClick={() => setOpen(v => !v)} disabled={!total}>
          {open ? 'hide' : 'see all'}
        </button>
      </div>
      {open && total > 0 && (
        <div className="panel-body" style={{ maxHeight: 240, overflowY: 'auto' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items!.map((it, i) => (
              <li key={i} style={{ display: 'flex', gap: '.6rem', padding: '.35rem 0', borderBottom: '1px solid rgba(111,138,190,0.25)' }}>
                <span className={`badge severity-${String(it?.finding?.severity || 'info')}`}>{String(it?.finding?.severity || 'info')}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{String(it?.finding?.ruleId || it?.finding?.category || 'rule')}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>line {Number(it?.finding?.line || 1)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
