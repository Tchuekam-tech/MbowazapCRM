import { describe, it, expect } from 'vitest';
import {
  MAX_EVENTS_PER_BATCH,
  MAX_QR_LENGTH,
  normalizeQrDataUrl,
  parseEventBatch,
} from './protocol';

const session = '237600000001';
const chat = { phone: '237699999999', pushName: 'Awa' };
let seq = 0;

function event(type: string, fields: Record<string, unknown>) {
  seq += 1;
  return {
    eventId: `1b4e28ba-2fa1-41d2-883f-${String(seq).padStart(12, '0')}`,
    type,
    at: 1_700_000_000_000,
    ...fields,
  };
}

function batch(events: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    protocol: '1',
    session,
    createdAt: 1_700_000_000_000,
    events,
    ...overrides,
  };
}

function parseOne(e: unknown) {
  const result = parseEventBatch(batch([e]));
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('parseEventBatch — envelope', () => {
  it('rejects a malformed envelope as a whole', () => {
    expect(parseEventBatch(null)).toEqual({
      ok: false,
      error: 'Body must be a JSON object',
    });
    expect(parseEventBatch(batch([], { protocol: '2' })).ok).toBe(false);
    expect(
      parseEventBatch(
        batch([event('tally.submitted', { chat })], { session: 'temp_qr' })
      ).ok
    ).toBe(false);
    expect(parseEventBatch(batch([])).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () =>
      event('tally.submitted', { chat })
    );
    expect(parseEventBatch(batch(tooMany)).ok).toBe(false);
  });

  it('keeps the good events and reports the bad ones by index', () => {
    const good = event('tally.submitted', { chat });
    const bad = event('status', { id: 'ABC', chat, status: 'seen' });
    const result = parseEventBatch(batch([good, bad, 'nope']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch.events).toEqual([good]);
    expect(result.rejected).toEqual([
      {
        index: 1,
        eventId: bad.eventId,
        error: 'status must be one of: sent, delivered, read, failed',
      },
      { index: 2, error: 'event must be an object' },
    ]);
  });

  it('rejects unknown event types and bad base fields', () => {
    const results = [
      event('message.deleted', { chat }),
      { ...event('tally.submitted', { chat }), eventId: '../x' },
      { ...event('tally.submitted', { chat }), at: -1 },
    ].map((e) => parseOne(e).rejected.length);
    expect(results).toEqual([1, 1, 1]);
  });
});

describe('parseEventBatch — message events', () => {
  const inbound = {
    id: '3EB0C431C26A1916',
    direction: 'inbound',
    origin: 'customer',
    chat,
    timestamp: 1_700_000_000,
    kind: 'text',
    text: 'Bonjour, je veux le pack Business',
  };

  it('accepts inbound text, dropping absent optional fields', () => {
    const e = event('message', inbound);
    expect(parseOne(e).batch.events).toEqual([e]);
  });

  it('accepts outbound media from Davila or the phone', () => {
    const e = event('message', {
      ...inbound,
      direction: 'outbound',
      origin: 'davila',
      kind: 'image',
      text: 'Voici le catalogue',
      media: {
        url: 'https://storage.example.com/chat-media/a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
      },
      quotedId: 'ABCDEF123',
    });
    expect(parseOne(e).rejected).toEqual([]);
  });

  it('accepts history messages and contact upserts', () => {
    const historyMessage = event('message', { ...inbound, history: true });
    const contactUpsert = event('contact.upsert', { chat, name: 'Awa Ndiaye' });
    const result = parseEventBatch(batch([historyMessage, contactUpsert]));
    expect(result.ok).toBe(true);
    expect(result.ok && result.rejected).toEqual([]);
    expect(result.ok && result.batch.events).toEqual([historyMessage, contactUpsert]);
  });

  it('accepts LID-only chats and locations', () => {
    const e = event('message', {
      ...inbound,
      chat: { lid: '123456789012' },
      kind: 'location',
      text: undefined,
      location: { latitude: 3.848, longitude: 11.502, name: 'Yaoundé' },
    });
    expect(parseOne(e).rejected).toEqual([]);
  });

  it.each([
    ['direction/origin mismatch', { origin: 'davila' }],
    ['text kind without text', { text: '' }],
    ['location kind without location', { kind: 'location', text: undefined }],
    ['chat without phone or lid', { chat: { pushName: 'x' } }],
    [
      'non-http media url',
      {
        kind: 'image',
        media: { url: 'file:///etc/passwd', mimeType: 'image/jpeg' },
      },
    ],
    [
      'bad mime type',
      {
        kind: 'image',
        media: { url: 'https://x.example/a', mimeType: 'jpeg' },
      },
    ],
    [
      'latitude out of range',
      { kind: 'location', location: { latitude: 91, longitude: 0 } },
    ],
    ['bad message id', { id: 'has spaces' }],
  ])('rejects %s', (_label, patch) => {
    expect(
      parseOne(event('message', { ...inbound, ...patch })).rejected
    ).toHaveLength(1);
  });
});

describe('parseEventBatch — other events', () => {
  it('accepts every event type', () => {
    const events = [
      event('connection', {
        status: 'connected',
        me: { phone: session, name: 'Tchuek-Tech' },
        pairingRef: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
      }),
      event('status', { id: 'ABC', chat, status: 'read' }),
      event('reaction', {
        id: 'R1',
        chat,
        targetId: 'ABC',
        emoji: '',
        fromMe: false,
      }),
      event('contact.upsert', { chat, name: 'Awa' }),
      event('contact.facts', {
        chat,
        facts: { name: 'Awa', interestedPack: 'business' },
      }),
      event('deal.closed', { chat, pack: 'elite' }),
      event('tally.submitted', { chat }),
      event('contact.opted_out', { chat }),
      event('ai.paused', { chat, until: 253402300799000 }),
      event('ai.paused', { chat, until: null }),
    ];
    const result = parseOne(events[0]);
    expect(result.rejected).toEqual([]);
    const all = parseEventBatch(batch(events));
    expect(all.ok && all.rejected).toEqual([]);
    expect(all.ok && all.batch.events).toEqual(events);
  });

  it('rejects empty facts, a bad pairingRef and a missing pause time', () => {
    expect(
      parseOne(event('contact.facts', { chat, facts: {} })).rejected
    ).toHaveLength(1);
    expect(
      parseOne(event('connection', { status: 'connected', pairingRef: 'nope' }))
        .rejected
    ).toHaveLength(1);
    expect(parseOne(event('ai.paused', { chat })).rejected).toHaveLength(1);
  });
});

describe('normalizeQrDataUrl', () => {
  const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  const jpgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
  const gifB64 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).toString('base64');
  const webpB64 = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]).toString('base64');

  it('accepts valid PNG, JPEG, GIF and WebP data URLs and bare base64', () => {
    expect(normalizeQrDataUrl(`data:image/png;base64,${pngB64}`)).toBe(`data:image/png;base64,${pngB64}`);
    expect(normalizeQrDataUrl(pngB64)).toBe(`data:image/png;base64,${pngB64}`);
    expect(normalizeQrDataUrl(`data:image/png;base64,${jpgB64}`)).toBe(`data:image/jpeg;base64,${jpgB64}`);
    expect(normalizeQrDataUrl(gifB64)).toBe(`data:image/gif;base64,${gifB64}`);
    expect(normalizeQrDataUrl(webpB64)).toBe(`data:image/webp;base64,${webpB64}`);
  });

  it('rejects non-image, XSS, corrupt base64, and oversized payloads', () => {
    const plainTextB64 = Buffer.from('2@raw-qr-string').toString('base64');
    expect(normalizeQrDataUrl(`data:image/png;base64,${plainTextB64}`)).toBeNull();
    expect(normalizeQrDataUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeQrDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(normalizeQrDataUrl('')).toBeNull();
    expect(normalizeQrDataUrl(null)).toBeNull();
    expect(normalizeQrDataUrl(`data:image/png;base64,${'A'.repeat(MAX_QR_LENGTH)}`)).toBeNull();
  });
});
