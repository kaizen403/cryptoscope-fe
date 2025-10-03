# Cryptoscope Frontend

Next.js interface for exploring crypto scanner results in real time.

## Getting Started

```bash
cd frontend
npm install
npm run dev
```

## Connecting to the Backend

The dev server proxies the backend API when it knows where it lives:

- By default it targets `http://localhost:5050` (matching the Express service).
- Override the target by setting `BACKEND_URL` before `npm run dev`/`npm run build`.
- Alternatively set `NEXT_PUBLIC_API_BASE` to a fully-qualified URL; the UI will call it directly and skip the proxy.

When the proxy is active, requests such as `/api/scan`, `/api/scan-repo-sse`, and `/api/generate-report` are transparently forwarded to the backend, so no CORS configuration is required during local development.

## Features

- Tabs for single-file scans, inline paste, GitHub repository (SSE) scans, and ZIP uploads.
- Monaco-based code viewer with inline severity decorations and line jumps.
- File tree summarising findings per directory/file with counts and quick navigation.
- Severity filters, search, and enrichment metadata (primitive, algorithm, key/IV usage).
- AI report generation (requires backend Groq key) for both single files and repositories.

## Notes

- Repository scans stream incremental results; cached runs are detected via commit hash or ZIP sha256.
- ZIP uploads are kept local and referenced through a generated workspace id so file previews continue to work.
- For large scans the UI may receive enrichment events after the initial file list; the tree updates automatically.
