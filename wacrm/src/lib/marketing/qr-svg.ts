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

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem[0]!;
    for (let j = 0; j < ecLen - 1; j++) rem[j] = rem[j + 1]!;
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1]!, factor);
      }
    }
  }
  return rem;
}

function formatBits(mask: number): number {
  // Level M = 00 in 2-bit EC indicator
  const data = (0b00 << 3) | (mask & 0x7);
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (rem & (1 << (i + 12))) rem ^= 0x1f25 << i;
  }
  return (version << 12) | rem;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = QR_LEVEL_M_SPECS.find((s) => {
    const countBits = s.version <= 9 ? 8 : 16;
    const neededBits = 4 + countBits + bytes.length * 8;
    return Math.ceil(neededBits / 8) <= s.dataCodewords;
  });
  if (!spec) {
    throw new Error('QR payload exceeds maximum supported length (213 bytes)');
  }

  // 1. Build bit stream (Byte mode 0100 + char count + payload + terminator + pad)
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = spec.dataCodewords * 8;
  const term = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw = new Uint8Array(spec.dataCodewords);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!;
    dataCw[byteIdx++] = v;
  }
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (byteIdx < spec.dataCodewords) {
    dataCw[byteIdx++] = padBytes[padIdx % 2]!;
    padIdx++;
  }

  // 2. Split into blocks + Reed-Solomon ECC + interleave
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, len] of spec.blocks) {
    for (let b = 0; b < count; b++) {
      const slice = dataCw.subarray(offset, offset + len);
      offset += len;
      dataBlocks.push(slice);
      ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
    }
  }

  const finalCodewords: number[] = [];
  const maxBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalCodewords.push(blk[i]!);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const blk of ecBlocks) finalCodewords.push(blk[i]!);
  }

  // 3. Draw function patterns
  const size = spec.size;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r]![c] = dark;
    isFunc[r]![c] = true;
  };

  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        setFunc(r, c, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = spec.align;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const cr = align[i]!;
      const cc = align[j]!;
      if (isFunc[cr]![cc]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunc(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Reserve format info + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = size - 8; i < size; i++) {
    setFunc(8, i, false);
    setFunc(i, 8, false);
  }
  setFunc(size - 8, 8, true);

  // Version info for >= 7
  if (spec.version >= 7) {
    const vb = versionBits(spec.version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }
