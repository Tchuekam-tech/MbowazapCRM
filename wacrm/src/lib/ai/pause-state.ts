import type { AutomationState } from '@/types';

/**
 * Whether automation is held off a conversation for a human — the rule
 * checkAutomationAllowed() gates sends on (./reply-control.ts), minus
 * assignment, which callers show separately. A pause with no end date is
 * indefinite; a timed one lapses at `pausedUntil`.
 */
export function isAutomationPausedHere(
  disabled: boolean,
  automationState: AutomationState | null | undefined,
  pausedUntil: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (disabled) return true;
  if (automationState !== 'human_handling') return false;
  return !pausedUntil || Date.parse(pausedUntil) > now;
}
