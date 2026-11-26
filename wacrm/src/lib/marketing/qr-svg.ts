// ============================================================
// Feature 1: Growth Links, Attribution Ref Codes & Pure SVG QR
//
// Zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode,
// Error Correction Level M, Versions 1–10 up to 213 UTF-8 bytes)
// + Click-to-WhatsApp link & attribution helpers.
// ============================================================

export function slugifyLinkName(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `wa-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function generateRefCode(prefix = 'MW'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  const cleanPrefix = prefix.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4) || 'MW';
  return `${cleanPrefix}${suffix}`;
}

/**
 * Builds the `https://wa.me/<digits>?text=...` destination URL.
 * Appends an unobtrusive `[REF:CODE]` tag when `refCode` is set and not
 * already present in the prefill message so inbound messages auto-attribute.
 */
export function buildWhatsAppRedirectUrl(
  destinationPhone: string,
  prefillMessage: string,
  refCode?: string | null
): string {
  const digits = destinationPhone.replace(/[^0-9]/g, '');
  let text = (prefillMessage || '').trim();
  const cleanRef = (refCode || '').trim().toUpperCase();
  if (cleanRef && !text.toUpperCase().includes(cleanRef)) {
    text = text ? `${text} [Ref:${cleanRef}]` : `Hi! [Ref:${cleanRef}]`;
  }
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Extracts a Growth Link attribution ref code (e.g. `[Ref:MW8K2P9]` or
 * `#MW8K2P9`) from an inbound WhatsApp message.
 */
export function extractGrowthRefCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const bracketed = text.match(/\[(?:ref|code)\s*[:=]\s*([A-Z0-9_-]{3,24})\]/i);
  if (bracketed?.[1]) return bracketed[1].toUpperCase();
  return null;
}

// ============================================================
// Pure TypeScript ISO/IEC 18004 QR Code Matrix (ECC Level M)
// Supports Versions 1–10 (up to 213 UTF-8 bytes — plenty for
// https://domain.com/go/<slug> short links).
// ============================================================

// Total codewords, EC codewords per block, and block counts for Level M, V1..V10.
const QR_LEVEL_M_SPECS: ReadonlyArray<{
  version: number;
  size: number;
  dataCodewords: number;
  ecPerBlock: number;
  blocks: ReadonlyArray<[number, number]>; // [numBlocks, dataCodewordsPerBlock]
  align: readonly number[];
}> = [
  { version: 1, size: 21, dataCodewords: 16, ecPerBlock: 10, blocks: [[1, 16]], align: [] },
  { version: 2, size: 25, dataCodewords: 28, ecPerBlock: 16, blocks: [[1, 28]], align: [6, 18] },
  { version: 3, size: 29, dataCodewords: 44, ecPerBlock: 26, blocks: [[1, 44]], align: [6, 22] },
  { version: 4, size: 33, dataCodewords: 64, ecPerBlock: 18, blocks: [[2, 32]], align: [6, 26] },
  { version: 5, size: 37, dataCodewords: 86, ecPerBlock: 24, blocks: [[2, 43]], align: [6, 30] },
  { version: 6, size: 41, dataCodewords: 108, ecPerBlock: 16, blocks: [[4, 27]], align: [6, 34] },
  { version: 7, size: 45, dataCodewords: 124, ecPerBlock: 18, blocks: [[4, 31]], align: [6, 22, 38] },
  { version: 8, size: 49, dataCodewords: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42] },
  { version: 9, size: 53, dataCodewords: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]], align: [6, 26, 46] },
  { version: 10, size: 57, dataCodewords: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]], align: [6, 28, 50] },
];

// GF(256) with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}
