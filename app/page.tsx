"use client";

import { useRouter } from "next/navigation";
import React from "react";

export default function Home() {
  const router = useRouter();
  const [qsGitUrl, setQsGitUrl] = React.useState("");

  return (
    <main className="page">
      <nav className="navbar">
        <div className="navbar-inner">
          <div className="brand">Digital Fortress</div>
        </div>
      </nav>

      <section className="hero-section">
        <div className="hero-inner">
          <div className="status-chip">Ready to Scan</div>
          <h1 className="hero-heading">Cryptoscope</h1>
          <p className="hero-subheading">
            AI‑assisted cryptography scanner for codebases. Automatically detect weak algorithms, risky modes, insecure randomness,
            and more across Java, C/C++, JS/TS and other languages. Stream live progress and review findings with context.
          </p>

          <div className="hero-quickstart" aria-label="Quick start with Git URL">
            <div className="input-row">
              <input
                className="input-grow"
                placeholder="Paste a Git URL (https://github.com/org/repo.git)"
                value={qsGitUrl}
                onChange={(e) => setQsGitUrl(e.target.value)}
              />
              <button
                className="primary-button"
                onClick={() => {
                  if (!qsGitUrl.trim()) return;
                  router.push(`/analyzer?git_url=${encodeURIComponent(qsGitUrl.trim())}`);
                }}
                disabled={!qsGitUrl.trim()}
              >
                Analyze now
              </button>
            </div>
            <div className="cta-note">Or use the options below to scan local folders or upload files.</div>
          </div>

          <div className="hero-actions">
            <button
              onClick={() => router.push('/analyzer')}
              className="primary-button hero-button"
            >
              Open Analyzer
            </button>
            <button
              onClick={() => router.push('/editor')}
              className="secondary-button hero-button"
            >
              Code Editor
            </button>
          </div>

          <div className="hero-stats">
            <div className="hero-stat"><span className="value">10+</span><span className="label">languages</span></div>
            <div className="hero-stat"><span className="value">Semgrep</span><span className="label">rules engine</span></div>
            <div className="hero-stat"><span className="value">AI</span><span className="label">explanations</span></div>
          </div>

          <div className="terminal-card" aria-hidden>
            <code>$ start scan → live SSE updates · findings enriched with context</code>
          </div>
        </div>
      </section>

      <section id="features" className="page-shell">
        <h2 className="section-title">Features</h2>
        <p className="section-subtitle">A streamlined workspace with smart detection, clear visuals, and helpful summaries.</p>
        
        <div className="card-grid">
          <article className="panel">
            <div className="panel-body">
              <div className="feature-grid">
                <div className="feature-card">
                  <div className="feature-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 4h7l2 2h7v12a2 2 0 0 1-2 2H4V4z" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                  </div>
                  <h3>Scan any source</h3>
                  <p>Analyze local directories, uploaded ZIPs, or remote Git repositories.</p>
                </div>
                
                <div className="feature-card">
                  <div className="feature-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                  </div>
                  <h3>Detect crypto usage</h3>
                  <p>Identify imports, functions, patterns, and algorithms across languages.</p>
                </div>
                
                <div className="feature-card">
                  <div className="feature-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                  </div>
                  <h3>AI summaries</h3>
                  <p>Consolidated findings with vulnerabilities and recommendations.</p>
                </div>
                
                <div className="feature-card">
                  <div className="feature-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M7 8h10M7 12h6" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                  </div>
                  <h3>Code preview</h3>
                  <p>Read-only editor with inline highlighting and quick navigation.</p>
                </div>
                
                <div className="feature-card">
                  <div className="feature-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M4 7l2-3h12l2 3" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                  </div>
                  <h3>Store or analyze on the fly</h3>
                  <p>Keep datasets for later or run quick one-off scans.</p>
                </div>
                
                <div className="feature-card">
                  <div className="feature-icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M3 12h18M12 3c3 3.5 3 9.5 0 15M12 3c-3 3.5-3 9.5 0 15" stroke="currentColor" strokeWidth="1.1"/>
                    </svg>
                  </div>
                  <h3>Multi-language support</h3>
                  <p>Works across Python, JS/TS, C/C++, Java, and more.</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <footer className="footer">© Digital Fortress</footer>
    </main>
  );
}