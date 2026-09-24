import { describe, expect, it } from 'vitest';
import { isAutomationPausedHere } from './pause-state';

const NOW = Date.parse('2026-09-24T12:00:00Z');

describe('isAutomationPausedHere', () => {
  it('is paused when auto-reply is disabled on the thread (handoff, opt-out)', () => {
    expect(isAutomationPausedHere(true, 'active', null, NOW)).toBe(true);
  });

  it('is paused while a human handles the thread without an end date', () => {
    expect(isAutomationPausedHere(false, 'human_handling', null, NOW)).toBe(
      true
    );
  });

  it('honours a timed human pause until it lapses', () => {
    expect(
      isAutomationPausedHere(
        false,
        'human_handling',
        '2026-09-24T12:30:00Z',
        NOW
      )
    ).toBe(true);
    expect(
      isAutomationPausedHere(
        false,
        'human_handling',
        '2026-09-24T11:59:59Z',
        NOW
      )
    ).toBe(false);
  });

  it('is active otherwise, including rows from before migration 045', () => {
    expect(isAutomationPausedHere(false, 'active', null, NOW)).toBe(false);
    expect(isAutomationPausedHere(false, undefined, undefined, NOW)).toBe(
      false
    );
  });
});
