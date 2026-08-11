import { describe, it, expect } from 'vitest';
import { extractResponseText, extractDataArtifact, type A2aArtifact } from './roundtable.js';

describe('A2A artifact parsing', () => {
  const artifacts: A2aArtifact[] = [
    {
      name: 'response',
      parts: [
        { type: 'text', text: '¡Hola! ' },
        { type: 'text', text: 'Aquí tienes tu billete.' },
        { type: 'other', text: 'ignored' },
      ],
    },
    { name: 'verdict', parts: [{ type: 'data', data: { meaningUnderstood: true, objectiveProgress: 1 } }] },
  ];

  it('concatenates only the text parts of the response artifact', () => {
    expect(extractResponseText(artifacts)).toBe('¡Hola! Aquí tienes tu billete.');
  });

  it('returns empty string when there is no response artifact', () => {
    expect(extractResponseText([{ name: 'verdict', parts: [] }])).toBe('');
  });

  it('pulls structured data from a named data artifact', () => {
    const v = extractDataArtifact<{ objectiveProgress: number }>(artifacts, 'verdict');
    expect(v?.objectiveProgress).toBe(1);
  });

  it('returns undefined for a missing data artifact', () => {
    expect(extractDataArtifact(artifacts, 'nope')).toBeUndefined();
  });
});
