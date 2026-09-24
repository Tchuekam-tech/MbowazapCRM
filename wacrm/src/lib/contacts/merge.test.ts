import { describe, it, expect } from 'vitest';
import { mergeContacts } from './merge';
import { wacrmFakeDb } from '@/lib/mbowazap/testing/fake-supabase';

describe('mergeContacts', () => {
  it('does nothing if survivor and loser are identical', async () => {
    const fake = wacrmFakeDb();
    const result = await mergeContacts(fake.client(), {
      accountId: 'acc-1',
      survivorContactId: 'c-1',
      loserContactId: 'c-1',
    });
    expect(result).toEqual({ merged: false, survivorContactId: 'c-1', reason: 'same_contact' });
  });

  it('merges a LID-only contact into a phone-bearing contact completely', async () => {
    const fake = wacrmFakeDb();
    const db = fake.client();

    // 1. Seed two contacts in acc-1
    fake.seed('contacts', [
      {
        id: 'c-phone',
        account_id: 'acc-1',
        phone: '+237699000001',
        name: '+237699000001', // placeholder name
        wa_lid: null,
      },
      {
        id: 'c-lid',
        account_id: 'acc-1',
        phone: '',
        name: 'Awa Real Name',
        wa_lid: 'lid-12345',
      },
    ]);

    // 2. Seed conversations for both
    fake.seed('conversations', [
      {
        id: 'conv-phone',
        account_id: 'acc-1',
        contact_id: 'c-phone',
        unread_count: 2,
      },
      {
        id: 'conv-lid',
        account_id: 'acc-1',
        contact_id: 'c-lid',
        unread_count: 3,
      },
    ]);

    // 3. Seed messages
    fake.seed('messages', [
      {
        id: 'm-1',
        conversation_id: 'conv-phone',
        message_id: 'M1',
        content_text: 'Hello phone',
      },
      {
        id: 'm-2',
        conversation_id: 'conv-lid',
        message_id: 'M2',
        content_text: 'Hello lid',
      },
    ]);

    // 4. Seed deals
    fake.seed('deals', [
      {
        id: 'deal-phone',
        account_id: 'acc-1',
        contact_id: 'c-phone',
        conversation_id: 'conv-phone',
        status: 'open',
      },
      {
        id: 'deal-lid',
        account_id: 'acc-1',
        contact_id: 'c-lid',
        conversation_id: 'conv-lid',
        status: 'open',
      },
    ]);

    // 5. Seed tags
    fake.seed('contact_tags', [
      { id: 'ct-1', contact_id: 'c-phone', tag_id: 'tag-common' },
      { id: 'ct-2', contact_id: 'c-phone', tag_id: 'tag-phone-only' },
      { id: 'ct-3', contact_id: 'c-lid', tag_id: 'tag-common' }, // duplicate tag
      { id: 'ct-4', contact_id: 'c-lid', tag_id: 'tag-lid-only' },
    ]);

    // 6. Seed custom values
    fake.seed('contact_custom_values', [
      { id: 'cv-1', contact_id: 'c-phone', custom_field_id: 'field-1', value: 'Val 1' },
      { id: 'cv-2', contact_id: 'c-lid', custom_field_id: 'field-1', value: 'Val 1' }, // duplicate field
      { id: 'cv-3', contact_id: 'c-lid', custom_field_id: 'field-2', value: 'Val 2' },
    ]);

    // 7. Seed broadcast recipients
    fake.seed('broadcast_recipients', [
      { id: 'br-1', contact_id: 'c-lid', broadcast_id: 'b-1' },
    ]);

    // Execute merge
    const result = await mergeContacts(db, {
      accountId: 'acc-1',
      survivorContactId: 'c-phone',
      loserContactId: 'c-lid',
      newLid: 'lid-12345',
    });

    expect(result).toEqual({ merged: true, survivorContactId: 'c-phone' });

    // Verify contacts
    const contacts = fake.rows('contacts');
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      id: 'c-phone',
      phone: '+237699000001',
      name: 'Awa Real Name', // placeholder replaced by loser's real name
      wa_lid: 'lid-12345',
    });

    // Verify conversations: loser conversation removed, survivor conversation has unread sum
    const convs = fake.rows('conversations');
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({
      id: 'conv-phone',
      contact_id: 'c-phone',
      unread_count: 5,
    });

    // Verify messages: all reparented to conv-phone
    const msgs = fake.rows('messages');
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.conversation_id === 'conv-phone')).toBe(true);

    // Verify deals: all reparented to c-phone and conv-phone
    const deals = fake.rows('deals');
    expect(deals).toHaveLength(2);
    expect(deals.every((d) => d.contact_id === 'c-phone')).toBe(true);
    expect(deals.find((d) => d.id === 'deal-lid')?.conversation_id).toBe('conv-phone');

    // Verify tags: union of tags, no duplicates
    const tags = fake.rows('contact_tags');
    expect(tags).toHaveLength(3);
    const tagIds = tags.map((t) => t.tag_id).sort();
    expect(tagIds).toEqual(['tag-common', 'tag-lid-only', 'tag-phone-only']);
    expect(tags.every((t) => t.contact_id === 'c-phone')).toBe(true);

    // Verify custom values: union of fields
    const values = fake.rows('contact_custom_values');
    expect(values).toHaveLength(2);
    expect(values.every((v) => v.contact_id === 'c-phone')).toBe(true);
    const fieldIds = values.map((v) => v.custom_field_id).sort();
    expect(fieldIds).toEqual(['field-1', 'field-2']);

    // Verify broadcast recipients
    const brs = fake.rows('broadcast_recipients');
    expect(brs).toHaveLength(1);
    expect(brs[0].contact_id).toBe('c-phone');
  });

  describe('loses nothing that hangs off the duplicate', () => {
    function seedPair() {
      const fake = wacrmFakeDb();
      fake.seed('contacts', [
        { id: 'c-phone', account_id: 'acc-1', phone: '237699000001', name: 'Awa' },
        { id: 'c-lid', account_id: 'acc-1', phone: '', name: 'Awa', wa_lid: '123456789012' },
      ]);
      fake.seed('conversations', [
        { id: 'conv-phone', account_id: 'acc-1', contact_id: 'c-phone', unread_count: 0 },
        { id: 'conv-lid', account_id: 'acc-1', contact_id: 'c-lid', unread_count: 1 },
      ]);
      fake.seed('messages', [
        { id: 'm-lid', conversation_id: 'conv-lid', message_id: 'L1', sender_type: 'customer' },
      ]);
      return fake;
    }

    it('keeps notes, reactions, notifications, flow runs and pending automation steps', async () => {
      const fake = seedPair();
      fake.seed('contact_notes', [{ id: 'note-1', account_id: 'acc-1', contact_id: 'c-lid', content: 'VIP' }]);
      fake.seed('message_reactions', [
        { id: 'r-1', message_id: 'm-lid', conversation_id: 'conv-lid', actor_type: 'customer', actor_id: 'c-lid', emoji: '❤️' },
      ]);
      fake.seed('notifications', [
        { id: 'n-1', account_id: 'acc-1', contact_id: 'c-lid', conversation_id: 'conv-lid' },
      ]);
      fake.seed('flow_runs', [
        { id: 'run-1', account_id: 'acc-1', contact_id: 'c-lid', conversation_id: 'conv-lid', status: 'active' },
      ]);
      fake.seed('automation_pending_executions', [{ id: 'pending-1', account_id: 'acc-1', contact_id: 'c-lid' }]);

      const result = await mergeContacts(fake.client(), {
        accountId: 'acc-1',
        survivorContactId: 'c-phone',
        loserContactId: 'c-lid',
      });

      expect(result.merged).toBe(true);
      expect(fake.rows('contact_notes')).toEqual([expect.objectContaining({ id: 'note-1', contact_id: 'c-phone' })]);
      expect(fake.rows('message_reactions')).toEqual([
        expect.objectContaining({ id: 'r-1', conversation_id: 'conv-phone', actor_id: 'c-phone' }),
      ]);
      expect(fake.rows('notifications')).toEqual([
        expect.objectContaining({ id: 'n-1', contact_id: 'c-phone', conversation_id: 'conv-phone' }),
      ]);
      expect(fake.rows('flow_runs')).toEqual([
        expect.objectContaining({ id: 'run-1', contact_id: 'c-phone', conversation_id: 'conv-phone', status: 'active' }),
      ]);
      expect(fake.rows('automation_pending_executions')).toEqual([
        expect.objectContaining({ id: 'pending-1', contact_id: 'c-phone' }),
      ]);
    });

    it('ends the duplicate run when both contacts are mid-flow (one active run per contact)', async () => {
      const fake = seedPair();
      fake.seed('flow_runs', [
        { id: 'run-phone', contact_id: 'c-phone', status: 'active' },
        { id: 'run-lid', contact_id: 'c-lid', status: 'active' },
      ]);
      await mergeContacts(fake.client(), { accountId: 'acc-1', survivorContactId: 'c-phone', loserContactId: 'c-lid' });
      const runs = Object.fromEntries(fake.rows('flow_runs').map((r) => [r.id, r]));
      expect(runs['run-phone']).toMatchObject({ status: 'active', contact_id: 'c-phone' });
      expect(runs['run-lid']).toMatchObject({ status: 'failed', end_reason: 'contact_merged', contact_id: 'c-phone' });
    });

    it('aborts before deleting anything when a move fails', async () => {
      const fake = seedPair();
      fake.failNext = { table: 'messages', op: 'update', error: { message: 'connection reset' } };
      await expect(
        mergeContacts(fake.client(), { accountId: 'acc-1', survivorContactId: 'c-phone', loserContactId: 'c-lid' })
      ).rejects.toThrow(/moving messages: connection reset/);
      expect(fake.rows('contacts')).toHaveLength(2);
      expect(fake.rows('conversations')).toHaveLength(2);
      expect(fake.rows('messages')).toEqual([expect.objectContaining({ id: 'm-lid', conversation_id: 'conv-lid' })]);
    });

    it('keeps both contacts when the same WhatsApp message is stored in both threads', async () => {
      const fake = seedPair();
      fake.seed('messages', [{ id: 'm-dup', conversation_id: 'conv-phone', message_id: 'L1' }]);
      const result = await mergeContacts(fake.client(), {
        accountId: 'acc-1',
        survivorContactId: 'c-phone',
        loserContactId: 'c-lid',
      });
      expect(result).toEqual({ merged: false, survivorContactId: 'c-phone', reason: 'conflicting_messages' });
      expect(fake.rows('contacts')).toHaveLength(2);
      expect(fake.rows('messages')).toHaveLength(2);
    });
  });

  it('re-points loser conversation to survivor when survivor has no conversation', async () => {
    const fake = wacrmFakeDb();
    const db = fake.client();

    fake.seed('contacts', [
      { id: 'c-survivor', account_id: 'acc-1', phone: '+237699000001', name: 'Survivor' },
      { id: 'c-loser', account_id: 'acc-1', phone: '', name: 'Loser', wa_lid: 'lid-xyz' },
    ]);

    fake.seed('conversations', [
      { id: 'conv-loser', account_id: 'acc-1', contact_id: 'c-loser', unread_count: 1 },
    ]);

    const result = await mergeContacts(db, {
      accountId: 'acc-1',
      survivorContactId: 'c-survivor',
      loserContactId: 'c-loser',
    });

    expect(result.merged).toBe(true);
    const convs = fake.rows('conversations');
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({ id: 'conv-loser', contact_id: 'c-survivor' });
    expect(fake.rows('contacts')).toHaveLength(1);
  });
});
