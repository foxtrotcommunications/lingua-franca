import { useState } from 'react';
import type { Scene } from '../types';
import { api } from '../api';
import type { SceneBundle } from '../App';

const PRESETS = [
  'A train station in Madrid where I need to buy a ticket to Toledo for tomorrow morning.',
  'A tapas bar in Sevilla where I want to order two dishes and ask what the waiter recommends.',
  'A pharmacy in Barcelona where I need something for a headache and to ask how often to take it.',
];

const DIFFICULTIES = [
  { level: 1, label: 'Very easy', blurb: '1 person · just make yourself understood' },
  { level: 2, label: 'Easy', blurb: '1–2 people · valid attempts, grammar forgiven' },
  { level: 3, label: 'Proficient', blurb: '2 people · well-formed sentences expected' },
  { level: 4, label: 'Fluent', blurb: '2–3 people · correct grammar, complex interaction' },
  { level: 5, label: 'Advanced', blurb: '2–3 people · near-native, abstract goals' },
];

type Phase = 'describe' | 'art' | 'ready';

export function Builder({ onReady }: { onReady: (b: SceneBundle) => void }) {
  const [description, setDescription] = useState(PRESETS[0]);
  const [difficulty, setDifficulty] = useState(2);
  const [phase, setPhase] = useState<Phase>('describe');
  const [scene, setScene] = useState<Scene | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    setBusy('Designing the scene…');
    try {
      const s = await api.generateScenario(description, difficulty);
      setScene(s);
      setPhase('art');

      // Art is decoration, not a dependency: the scene must stay playable even
      // when image generation is rate-limited. Every failure below degrades to
      // a placeholder instead of stranding a fully-generated scene.
      let bg = '';
      setBusy('Painting the scene…');
      try {
        bg = await api.sceneImage(s.location, s.banner, undefined);
        setBackdrop(bg);
      } catch {
        setError('Couldn’t paint the backdrop just now — the scene is still playable.');
      }

      // Portraits are independent of each other — generate them concurrently so
      // a 3-character cast costs one image's wall-clock, not three. Each resolves
      // into the grid as it lands.
      setBusy(`Bringing the cast to life…`);
      const shots: Record<string, string> = {};
      const results = await Promise.allSettled(
        s.characters.map((c) =>
          api.characterImage(c.name, c.persona, bg || undefined).then((url) => {
            shots[c.characterId] = url;
            setPortraits({ ...shots });
          }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        setError(
          `${failed === s.characters.length ? 'Portraits' : `${failed} portrait${failed > 1 ? 's' : ''}`} couldn’t be generated (the image service is busy) — the scene is still playable.`,
        );
      }
      setPhase('ready');
    } catch (e) {
      // Only a failed *scene* generation is fatal — without it there is nothing to play.
      setError((e as Error).message || 'Could not generate that scene. Try again.');
      setPhase('describe');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="builder">
      <div className="builder-panel">
        <h1>Build a scene</h1>
        <p className="muted">
          Describe a situation in a place you want to practice. We’ll cast the characters, give
          each one their own knowledge, and paint the world.
        </p>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe a scene…"
          disabled={phase !== 'describe'}
        />
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} className="chip" onClick={() => setDescription(p)} disabled={phase !== 'describe'}>
              {p.split(' where ')[0]}
            </button>
          ))}
        </div>

        <div className="build-controls">
          <div className="ctrl">
            <span className="ctrl-label">Difficulty</span>
            <div className="difficulty">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.level}
                  className={`diff ${difficulty === d.level ? 'on' : ''}`}
                  onClick={() => setDifficulty(d.level)}
                  disabled={phase !== 'describe'}
                  title={d.blurb}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <span className="diff-blurb">
              {DIFFICULTIES.find((d) => d.level === difficulty)?.blurb}
            </span>
          </div>
        </div>

        {phase === 'describe' && (
          <button className="primary" onClick={generate} disabled={!!busy || !description.trim()}>
            Generate scenario →
          </button>
        )}
        {busy && (
          <div className="busy">
            <span className="spinner" />
            {busy}
          </div>
        )}
        {error && <div className="error">{error}</div>}

        {scene && (
          <div className="scene-summary">
            <div className="objective-line">
              <span className="banner">{scene.banner}</span>
              <span className="objective">🎯 {scene.objective.description}</span>
            </div>
            <div className="cast">
              {scene.characters.map((c) => (
                <div key={c.characterId} className="cast-card">
                  {portraits[c.characterId] ? (
                    <img src={portraits[c.characterId]} alt={c.name} />
                  ) : (
                    <div className={`portrait-skel ${busy ? '' : 'static'}`}>
                      {busy ? '…' : c.name[0]}
                    </div>
                  )}
                  <div className="cast-name">{c.name}</div>
                  <div className="cast-persona">{c.persona}</div>
                  <div className="cast-knows">knows: {c.knows.slice(0, 3).join(', ')}</div>
                </div>
              ))}
            </div>
            {phase === 'ready' && (
              <button
                className="primary"
                onClick={() => onReady({ scene, backdrop: backdrop ?? '', portraits })}
              >
                Enter the scene →
              </button>
            )}
          </div>
        )}
      </div>

      {backdrop ? (
        <div className="builder-preview" style={{ backgroundImage: `url(${backdrop})` }} />
      ) : (
        <div className="builder-preview empty">
          <span className="preview-hint">Your scene will appear here</span>
        </div>
      )}
    </div>
  );
}
