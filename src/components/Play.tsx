import { useEffect, useRef, useState } from 'react';
import type { ChatTurn, LedgerBlob, SceneCharacter, TurnResponse } from '../types';
import { api } from '../api';
import type { SceneBundle } from '../App';

/**
 * The learner ledger lives client-side, keyed per target language, as an
 * opaque blob the server returns after every turn. The server is stateless
 * (Cloud Run scale-to-zero safe); it re-adjudicates every turn in code and the
 * client just keeps the accumulated state between requests.
 */
const ledgerKey = (language: string) => `lf:ledger:${language.toLowerCase()}`;

function loadLedger(language: string): LedgerBlob | undefined {
  try {
    const raw = localStorage.getItem(ledgerKey(language));
    return raw ? (JSON.parse(raw) as LedgerBlob) : undefined;
  } catch {
    return undefined;
  }
}

function saveLedger(language: string, state: LedgerBlob): void {
  try {
    localStorage.setItem(ledgerKey(language), JSON.stringify(state));
  } catch {
    // Storage full or blocked — play continues, progress just won't persist.
  }
}

const OUTCOME = {
  understood: { dot: '🟢', label: 'Understood' },
  repaired: { dot: '🟡', label: 'Repaired' },
  failed: { dot: '🔴', label: 'Not yet' },
} as const;

/** Scene difficulty → player-facing tier name + CEFR band. */
const TIER: Record<number, { label: string; cefr: string }> = {
  1: { label: 'Very easy', cefr: 'A1' },
  2: { label: 'Easy', cefr: 'A2' },
  3: { label: 'Proficient', cefr: 'B1' },
  4: { label: 'Fluent', cefr: 'B2' },
  5: { label: 'Advanced', cefr: 'C1' },
};
const tierOf = (d: number) => TIER[d] ?? TIER[2]!;

/**
 * The opening nudge has to match the grading bar. At tiers 1-3 errors are
 * forgiven and "just make yourself understood" is the whole point; at 4-5 the
 * Coach demands accuracy, so promising the opposite would be a lie.
 */
function nudgeFor(difficulty: number, language: string): string {
  if (difficulty >= 5) {
    return `Precision counts here — aim for near-native ${language} and the right register.`;
  }
  if (difficulty === 4) {
    return `Accuracy counts at this level — aim for correct, natural ${language}.`;
  }
  return `Say something — anything that works. You don’t need perfect ${language}.`;
}

/** Turn a machine fact id ("order:croquetas") into a readable checklist label. */
function prettyFact(f: string): string {
  const s = f.replace(/[:_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Play({
  bundle,
  learnerId,
  onExit,
}: {
  bundle: SceneBundle;
  learnerId: string;
  onExit: () => void;
}) {
  const { scene, backdrop, portraits } = bundle;
  const startChars = scene.characters.filter((c) => c.entersWhen === 'start');
  const [activeId, setActiveId] = useState(startChars[0]?.characterId ?? scene.characters[0]!.characterId);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [facts, setFacts] = useState<string[]>([]);
  // Per-exchange coach notes, accumulated so the completion card can walk the
  // learner back through everything they said.
  const [review, setReview] = useState<
    Array<{ said: string; outcome: TurnResponse['outcome']; upgrade: string | null }>
  >([]);
  const [done, setDone] = useState<TurnResponse | null>(null);
  const [coachNote, setCoachNote] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Cross-scene learning state (vocab/grammar mastery, CEFR) — persists per
  // language. Scene progress (`facts`) intentionally starts empty each run.
  const ledgerRef = useRef<LedgerBlob | undefined>(loadLedger(scene.language));

  useEffect(() => {
    inputRef.current?.focus();
  }, [learnerId, scene.id]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, thinking]);

  const active: SceneCharacter =
    scene.characters.find((c) => c.characterId === activeId) ?? scene.characters[0]!;
  // Characters that enter after the objective stay locked (dimmed) until then.
  const isLocked = (c: SceneCharacter) => c.entersWhen === 'after_objective' && !done;

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'learner', text }]);
    setThinking(true);
    try {
      const r = await api.turn({
        learnerId,
        scene,
        utterance: text,
        characterId: activeId,
        history,
        ledgerState: ledgerRef.current,
        factsSoFar: facts,
      });
      ledgerRef.current = r.ledgerState;
      saveLedger(scene.language, r.ledgerState);
      setTurns((t) => {
        const copy = [...t];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i]!.role === 'learner' && !(copy[i] as { outcome?: string }).outcome) {
            copy[i] = {
              ...copy[i],
              outcome: r.outcome,
              wrongLanguage: r.wrongLanguage,
              askInstead: r.askInstead,
            } as ChatTurn;
            break;
          }
        }
        return [...copy, { role: 'character', text: r.reply, characterName: r.characterName }];
      });
      setProgress(r.objectiveProgress);
      setFacts(r.factsCommunicated);
      const said = [...review.map((v) => v.said), text];
      setReview((v) => [...v, { said: text, outcome: r.outcome, upgrade: r.naturalUpgrade }]);
      if (r.complete) {
        setDone(r);
        // Closing coach note — generated from everything they said this run,
        // grounded in the ledger they just accumulated.
        api
          .debrief(learnerId, scene, said, ledgerRef.current)
          .then(setCoachNote)
          .catch(() => setCoachNote(null));
      }
    } catch (e) {
      setTurns((t) => [
        ...t,
        { role: 'character', text: `(${(e as Error).message})`, characterName: active.name },
      ]);
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="play" style={{ backgroundImage: `url(${backdrop})` }}>
      <div className="play-scrim" />
      <div className="play-inner">
        <div className="scene-header">
          <div className="scene-header-top">
            <span className="banner">{scene.banner}</span>
            <div className="progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="cefr" title={`Scene difficulty: ${tierOf(scene.difficulty).label}`}>
                {tierOf(scene.difficulty).cefr}
              </span>
            </div>
          </div>
          <div className="objective">🎯 {scene.objective.description}</div>
          <ul className="checklist">
            {scene.objective.requiredFacts.map((f, i) => {
              const ok = facts.includes(f);
              const label = scene.objective.checklist?.[i] ?? prettyFact(f);
              // Who this must be said to — only meaningful with a cast.
              const ownerId = scene.objective.factOwners?.[i];
              const owner =
                scene.characters.length > 1
                  ? scene.characters.find((c) => c.characterId === ownerId)
                  : undefined;
              return (
                <li key={f} className={`check ${ok ? 'ok' : ''}`}>
                  <span className="box">{ok ? '✓' : ''}</span>
                  {label}
                  {owner && <span className="check-who">{owner.name}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="cast-row">
          {scene.characters.map((c) => {
            const locked = isLocked(c);
            return (
              <button
                key={c.characterId}
                className={`avatar ${c.characterId === activeId ? 'active' : ''} ${locked ? 'locked' : ''}`}
                onClick={() => !locked && setActiveId(c.characterId)}
                disabled={locked}
                title={locked ? `${c.name} appears once you finish the objective` : c.persona}
              >
                {portraits[c.characterId] ? (
                  <img src={portraits[c.characterId]} alt={c.name} />
                ) : (
                  <span className="mono">{locked ? '🔒' : c.name[0]}</span>
                )}
                <span className="avatar-name">{c.name}</span>
              </button>
            );
          })}
        </div>

        <div className="dialogue" ref={scroller}>
          {turns.length === 0 && (
            <div className="hint">
              {scene.briefing && <p className="briefing">{scene.briefing}</p>}
              <p className="hint-nudge">
                You’re talking to <b>{active.name}</b>. {nudgeFor(scene.difficulty, scene.language)}
              </p>
            </div>
          )}
          {turns.map((t, i) =>
            t.role === 'learner' ? (
              <div key={i} className="bubble learner">
                {t.text}
                {t.outcome && <span className="outcome" title={OUTCOME[t.outcome].label}>{OUTCOME[t.outcome].dot}</span>}
                {t.wrongLanguage && (
                  <span className="lang-nudge">Try it in {scene.language}</span>
                )}
                {!t.wrongLanguage && t.askInstead && (
                  <span className="lang-nudge">{t.askInstead} is the one to ask about that</span>
                )}
              </div>
            ) : (
              <div key={i} className="bubble character">
                <span className="who">{t.characterName}</span>
                {t.text}
              </div>
            ),
          )}
          {thinking && (
            <div className="routing">
              ✦ {active.name} is thinking
              <span className="dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
              <span className="sep">·</span> Coach is evaluating
            </div>
          )}
        </div>

        <div className="composer">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={`What do you say to ${active.name}?`}
            disabled={!!done}
          />
          <button className="primary" onClick={send} disabled={thinking || !!done}>
            Say it
          </button>
        </div>
      </div>

      {done && (
        <div className="completion">
          <div className="completion-card">
            <div className="cc-badge">✓ {scene.completeLabel ?? 'Mission complete!'}</div>
            <h2>{scene.objective.description}</h2>
            <p className="cc-line">
              You communicated all of it — <b>{scene.objective.requiredFacts.length}</b> facts — at{' '}
              <b>
                {tierOf(scene.difficulty).label} ({tierOf(scene.difficulty).cefr})
              </b>{' '}
              difficulty.
            </p>

            {review.length > 0 && (
              <div className="cc-review">
                <div className="cc-review-title">What you said</div>
                {review.map((r, i) => (
                  <div key={i} className="cc-row">
                    <span className="cc-dot" title={OUTCOME[r.outcome].label}>
                      {OUTCOME[r.outcome].dot}
                    </span>
                    <div className="cc-row-body">
                      <div className="cc-said">“{r.said}”</div>
                      {r.upgrade && r.upgrade.trim().toLowerCase() !== r.said.trim().toLowerCase() && (
                        <div className="cc-better">
                          <span className="cc-arrow">→</span> {r.upgrade}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="cc-coach">
              <div className="cc-coach-title">Where to go next</div>
              {coachNote ? (
                <p className="cc-coach-note">{coachNote}</p>
              ) : (
                <p className="cc-coach-note pending">
                  <span className="spinner" /> Your coach is reviewing the conversation…
                </p>
              )}
            </div>
            <button className="primary" onClick={onExit}>
              Build another scene →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
