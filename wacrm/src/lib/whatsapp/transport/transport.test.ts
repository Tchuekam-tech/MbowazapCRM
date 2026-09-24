import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MbowazapBridgeError, type MbowazapClient } from '@/lib/mbowazap/client';
import type { MessageTemplate } from '@/types';
import {
  audioMimeType,
  createMbowazapTransport,
  formatInteractiveAsText,
  resolveMbowazapTarget,
  toBridgeRecipient,
} from './mbowazap';
import { createMetaTransport } from './meta';
import { SendMessageError, whatsappProvider } from './index';

const session = '237600000001';
const conversationId = 'conv-1';

/** A `messages` count query that resolves to `result`, recording the chain. */
function fakeDb(result: {
  count: number | null;
  error: { message: string } | null;
}) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...args: unknown[]) => {
      calls.push(['select', ...args]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push(['eq', ...args]);
      return chain;
    },
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  const db = {
    from: (table: string) => {
      calls.push(['from', table]);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

function fakeClient(send?: MbowazapClient['send']) {
  const unused = () => Promise.reject(new Error('not used in this test'));
  return {
    ping: unused,
    pair: unused,
    getSession: unused,
    logout: unused,
    setBrain: unused,
    setContactAi: unused,
    send: vi.fn<MbowazapClient['send']>(
      send ??
        (async () => ({ messageId: '3EB0SENT', timestamp: 1_700_000_000 }))
    ),
    react: vi.fn<MbowazapClient['react']>(async () => ({
      messageId: '3EB0REACT',
    })),
  };
}

function transportWith(
  count: number | null,
  error: { message: string } | null = null,
  client = fakeClient()
) {
  const { db, calls } = fakeDb({ count, error });
  const transport = createMbowazapTransport({ session, db, client });
  return { transport, client, calls };
}

const base = { conversationId, origin: 'agent' as const };

async function sendError(promise: Promise<unknown>): Promise<SendMessageError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(SendMessageError);
  return err as SendMessageError;
}

describe('resolveMbowazapTarget', () => {
  it('prefers the phone number, as bare digits', () => {
    expect(resolveMbowazapTarget({ phone: '+237 699 00 11 22' })).toEqual({
      target: '237699001122',
      isPhone: true,
    });
  });

  it('falls back to the WhatsApp LID', () => {
    expect(
      resolveMbowazapTarget({ phone: '', wa_lid: '123456789012' })
    ).toEqual({ target: 'lid:123456789012', isPhone: false });
  });

  it('never uses a Meta business-scoped user ID', () => {
    expect(
      resolveMbowazapTarget({ phone: '', wa_user_id: 'US.13491208655302741918' })
    ).toBeNull();
    expect(resolveMbowazapTarget({ phone: '12', wa_lid: 'not-a-lid' })).toBeNull();
    expect(resolveMbowazapTarget(null)).toBeNull();
  });
});

describe('toBridgeRecipient', () => {
  it('maps phone and LID targets', () => {
    expect(toBridgeRecipient('237699001122')).toEqual({ phone: '237699001122' });
    expect(toBridgeRecipient('lid:123456789012')).toEqual({
      lid: '123456789012',
    });
  });

  it.each([
    ['a Meta BSUID', 'US.13491208655302741918'],
    ['a formatted number', '+237 699 00 11 22'],
    ['a group JID', '123456789-987654@g.us'],
    ['a bad LID', 'lid:abc'],
    ['an empty target', ''],
  ])('refuses %s instead of guessing', (_label, target) => {
    expect(() => toBridgeRecipient(target)).toThrow(SendMessageError);
  });
});

describe('MboWazap transport — reply-only', () => {
  it('sends once the customer has written in the conversation', async () => {
    const { transport, client, calls } = transportWith(1);
    await expect(
      transport.sendText({
        ...base,
        to: '237699001122',
        text: 'Bonjour',
        contextMessageId: 'ORIG1',
      })
    ).resolves.toEqual({ messageId: '3EB0SENT' });

    expect(client.send).toHaveBeenCalledWith({
      session,
      to: { phone: '237699001122' },
      origin: 'agent',
      quotedId: 'ORIG1',
      kind: 'text',
      text: 'Bonjour',
    });
    expect(calls).toContainEqual(['from', 'messages']);
    expect(calls).toContainEqual(['eq', 'conversation_id', conversationId]);
    expect(calls).toContainEqual(['eq', 'sender_type', 'customer']);
  });

  it('refuses when the customer never wrote first', async () => {
    const { transport, client } = transportWith(0);
    const err = await sendError(
      transport.sendText({ ...base, to: '237699001122', text: 'Promo!' })
    );
    expect(err).toMatchObject({ code: 'reply_only', status: 409 });
    expect(client.send).not.toHaveBeenCalled();
  });

  it('fails closed when the check itself fails', async () => {
    const { transport, client } = transportWith(null, { message: 'timeout' });
    const err = await sendError(
      transport.sendText({ ...base, to: '237699001122', text: 'Hi' })
    );
    expect(err).toMatchObject({ code: 'reply_only_unverified', status: 503 });
    expect(client.send).not.toHaveBeenCalled();
  });

  it('gates templates, media and interactive sends too', async () => {
    const { transport, client } = transportWith(0);
    await sendError(
      transport.sendTemplate({
        ...base,
        to: '237699001122',
        templateName: 'promo',
        contentText: 'Promo',
      })
    );
    await sendError(
      transport.sendMedia({
        ...base,
        to: '237699001122',
        kind: 'image',
        link: 'https://cdn.example.com/a.jpg',
      })
    );
    await sendError(
      transport.sendInteractive({
        ...base,
        to: '237699001122',
        payload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'A' }],
        },
      })
    );
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('MboWazap transport — payloads', () => {
  it('sends audio with a MIME type so ogg/opus goes out as a voice note', async () => {
    const { transport, client } = transportWith(1);
    await transport.sendMedia({
      ...base,
      to: 'lid:123456789012',
      kind: 'audio',
      link: 'https://cdn.example.com/voice/note.ogg?token=1',
    });
    await transport.sendMedia({
      ...base,
      to: '237699001122',
      kind: 'image',
      link: 'https://cdn.example.com/a.jpg',
      caption: 'Catalogue',
    });
    expect(client.send.mock.calls[0][0]).toMatchObject({
      to: { lid: '123456789012' },
      kind: 'audio',
      mediaUrl: 'https://cdn.example.com/voice/note.ogg?token=1',
      mimeType: 'audio/ogg; codecs=opus',
    });
    expect(client.send.mock.calls[1][0]).toMatchObject({
      kind: 'image',
      mimeType: undefined,
      text: 'Catalogue',
    });
  });

  it('sends templates as their rendered body text', async () => {
    const { transport, client } = transportWith(1);
    const template = {
      body_text: 'Bonjour {{1}}, votre pack {{2}} est prêt',
    } as MessageTemplate;
    await transport.sendTemplate({
      ...base,
      to: '237699001122',
      templateName: 'ready',
      template,
      params: ['Awa', 'Business'],
    });
    await transport.sendTemplate({
      ...base,
      to: '237699001122',
      templateName: 'ready',
      contentText: 'Pre-rendered',
    });
    expect(client.send.mock.calls[0][0]).toMatchObject({
      kind: 'text',
      text: 'Bonjour Awa, votre pack Business est prêt',
    });
    expect(client.send.mock.calls[1][0]).toMatchObject({ text: 'Pre-rendered' });

    const err = await sendError(
      transport.sendTemplate({ ...base, to: '237699001122', templateName: 'x' })
    );
    expect(err).toMatchObject({ code: 'template_unavailable', status: 400 });
  });

  it('reacts without the reply-only check, addressing our own messages as fromMe', async () => {
    const { transport, client, calls } = transportWith(0);
    await expect(
      transport.sendReaction({
        to: '237699001122',
        targetMessageId: '3EB0ORIG',
        targetFromMe: true,
        emoji: '👍',
      })
    ).resolves.toEqual({ messageId: '3EB0REACT' });
    expect(client.react).toHaveBeenCalledWith({
      session,
      to: { phone: '237699001122' },
      targetId: '3EB0ORIG',
      targetFromMe: true,
      emoji: '👍',
    });
    expect(calls).toEqual([]);
  });

  it('formats buttons and lists as numbered menus', () => {
    expect(
      formatInteractiveAsText({
        kind: 'buttons',
        header: 'Welcome',
        body: 'Choose:',
        footer: 'Reply with a number',
        buttons: [
          { id: 'a', title: 'Track order' },
          { id: 'b', title: 'Support' },
        ],
      })
    ).toBe('*Welcome*\n\nChoose:\n\n1. Track order\n2. Support\n\n_Reply with a number_');
    expect(
      formatInteractiveAsText({
        kind: 'list',
        body: 'Menu',
        button_label: 'Open',
        sections: [
          { title: 'Drinks', rows: [{ id: 'c', title: 'Coffee', description: 'Hot' }] },
          { title: 'Food', rows: [{ id: 'p', title: 'Croissant' }] },
        ],
      })
    ).toBe('Menu\n\n*Drinks*\n1. Coffee — Hot\n*Food*\n2. Croissant');
  });

  it('reads audio MIME types from the file extension', () => {
    expect(audioMimeType('https://x.example/a.OPUS')).toBe('audio/ogg; codecs=opus');
    expect(audioMimeType('https://x.example/a.mp3')).toBe('audio/mpeg');
    expect(audioMimeType('https://x.example/a.wav')).toBeUndefined();
    expect(audioMimeType('not a url')).toBeUndefined();
  });
});

describe('MboWazap transport — bridge errors', () => {
  it.each([
    ['session_not_connected', 409],
    ['invalid_request', 400],
    ['timeout', 504],
    ['unauthorized', 503],
    ['bridge_not_configured', 503],
    ['send_failed', 502],
    ['network_error', 502],
  ] as const)('maps %s to HTTP %i', async (code, status) => {
    const client = fakeClient(async () => {
      throw new MbowazapBridgeError(code, 'boom', 401);
    });
    const { transport } = transportWith(1, null, client);
    const err = await sendError(
      transport.sendText({ ...base, to: '237699001122', text: 'Hi' })
    );
    expect(err).toMatchObject({ code: `mbowazap_${code}`, status });
  });

  it('reports a missing bridge configuration as a typed 503', () => {
    const { db } = fakeDb({ count: 1, error: null });
    let caught: unknown;
    try {
      createMbowazapTransport({ session, db });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SendMessageError);
    expect(caught).toMatchObject({ code: 'mbowazap_not_configured', status: 503 });
  });
});

describe('Meta transport', () => {
  it('addresses by phone, else by business-scoped user ID', () => {
    const meta = createMetaTransport({ phoneNumberId: 'pn', accessToken: 't' });
    expect(meta.provider).toBe('meta');
    expect(meta.resolveTarget({ phone: '+237 699 00 11 22' })).toEqual({
      target: '237699001122',
      isPhone: true,
    });
    expect(meta.resolveTarget({ phone: '', wa_lid: '123456789012' })).toBeNull();
  });
});

describe('whatsappProvider', () => {
  it('treats anything but "mbowazap" as Meta', () => {
    expect(whatsappProvider({ provider: 'mbowazap' })).toBe('mbowazap');
    expect(whatsappProvider({ provider: 'meta' })).toBe('meta');
    expect(whatsappProvider({})).toBe('meta');
    expect(whatsappProvider(null)).toBe('meta');
  });
});
