import { describe, it, expect } from 'vitest';
import { reservePairing, type PairingConfig } from './pairing-reservation';
import { wacrmFakeDb } from './testing/fake-supabase';
const NOW = Date.parse('2026-10-01T00:00:00Z');
const PHONE = '237600000001';

describe('pairing reservations', () => {
  it('allows only one account to reserve a phone concurrently', async () => {
    const db = wacrmFakeDb();
    const attempts = await Promise.allSettled([
      reservePairing(db.client(), 'a', 'u', null, 'ref-a', PHONE, NOW),
      reservePairing(db.client(), 'b', 'v', null, 'ref-b', PHONE, NOW),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(db.rows('whatsapp_config')).toHaveLength(1);
  });
  it('prevents two tabs replacing the same account snapshot', async () => {
    const db = wacrmFakeDb();
    const previous = {
      id: 'cfg',
      account_id: 'a',
      user_id: 'u',
      provider: 'mbowazap',
      mbowazap_state: 'disconnected',
      mbowazap_pairing_ref: 'old',
      mbowazap_session: null,
      updated_at: new Date(NOW - 1000).toISOString(),
    };
    db.seed('whatsapp_config', [{ ...previous }]);
    const attempts = await Promise.allSettled([
      reservePairing(
        db.client(),
        'a',
        'u',
        { ...previous },
        'ref-a',
        PHONE,
        NOW
      ),
      reservePairing(
        db.client(),
        'a',
        'u',
        { ...previous },
        'ref-b',
        null,
        NOW
      ),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(db.rows('whatsapp_config')[0].mbowazap_pairing_ref).toBe('ref-a');
  });
  it('rolls back failure but does not erase a completed connection', async () => {
    const db = wacrmFakeDb();
    const first = await reservePairing(
      db.client(),
      'a',
      'u',
      null,
      'ref-a',
      PHONE,
      NOW
    );
    await first.rollback();
    expect(db.rows('whatsapp_config')).toHaveLength(0);
    const next = await reservePairing(
      db.client(),
      'a',
      'u',
      null,
      'ref-b',
      PHONE,
      NOW
    );
    db.rows('whatsapp_config')[0].mbowazap_state = 'connected';
    await next.rollback();
    expect(db.rows('whatsapp_config')[0].mbowazap_state).toBe('connected');
  });
  it('rejects active attempts and permits an expired attempt to be replaced', async () => {
    const db = wacrmFakeDb();
    await reservePairing(db.client(), 'a', 'u', null, 'ref-a', PHONE, NOW);
    const previous = { ...db.rows('whatsapp_config')[0] } as PairingConfig;
    await expect(
      reservePairing(
        db.client(),
        'a',
        'u',
        previous,
        'ref-b',
        PHONE,
        NOW + 1000
      )
    ).rejects.toMatchObject({ code: 'pairing_busy' });
    await reservePairing(
      db.client(),
      'a',
      'u',
      previous,
      'ref-b',
      PHONE,
      NOW + 120001
    );
    expect(db.rows('whatsapp_config')[0].mbowazap_pairing_ref).toBe('ref-b');
  });
});
