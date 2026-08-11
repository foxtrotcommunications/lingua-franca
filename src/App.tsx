import { useState } from 'react';
import type { Scene } from './types';
import { Builder } from './components/Builder';
import { Play } from './components/Play';

export interface SceneBundle {
  scene: Scene;
  backdrop: string;
  portraits: Record<string, string>;
}

export function App() {
  const [bundle, setBundle] = useState<SceneBundle | null>(null);
  // Stable across reloads so the client-held ledger keeps a consistent identity.
  const [learnerId] = useState(() => {
    try {
      const existing = localStorage.getItem('lf:learnerId');
      if (existing) return existing;
      const fresh = 'learner-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('lf:learnerId', fresh);
      return fresh;
    } catch {
      return 'learner-' + Math.random().toString(36).slice(2, 10);
    }
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🗺️</span>
          <div>
            <div className="brand-name">Lingua Franca</div>
            <div className="brand-tag">Learn a language by making yourself understood</div>
          </div>
        </div>
        {bundle && (
          <button className="ghost" onClick={() => setBundle(null)}>
            ← New scenario
          </button>
        )}
      </header>

      {bundle ? (
        <Play bundle={bundle} learnerId={learnerId} onExit={() => setBundle(null)} />
      ) : (
        <Builder onReady={setBundle} />
      )}
    </div>
  );
}
