import { describe, expect, it } from 'vitest';
import { isValidStatusTransition, ladderLevel } from './status';

describe('isValidStatusTransition', () => {
  it('allows forward moves along the ladder', () => {
    expect(isValidStatusTransition('pending', 'sent')).toBe(true);
    expect(isValidStatusTransition('sent', 'delivered')).toBe(true);
    expect(isValidStatusTransition('delivered', 'read')).toBe(true);
    expect(isValidStatusTransition('sent', 'read')).toBe(true);
  });

  it('never regresses', () => {
    expect(isValidStatusTransition('read', 'delivered')).toBe(false);
    expect(isValidStatusTransition('delivered', 'sent')).toBe(false);
    expect(isValidStatusTransition('read', 'read')).toBe(false);
  });

  it('accepts failed only before delivery, and treats it as terminal', () => {
    expect(isValidStatusTransition('pending', 'failed')).toBe(true);
    expect(isValidStatusTransition('sent', 'failed')).toBe(true);
    expect(isValidStatusTransition('delivered', 'failed')).toBe(false);
    expect(isValidStatusTransition('failed', 'read')).toBe(false);
  });

  it('refuses unknown incoming statuses and accepts from unknown current ones', () => {
    expect(isValidStatusTransition('sent', 'seen')).toBe(false);
    expect(isValidStatusTransition('mystery', 'delivered')).toBe(true);
    expect(ladderLevel('replied')).toBe(4);
    expect(ladderLevel('nope')).toBe(-1);
  });
});
