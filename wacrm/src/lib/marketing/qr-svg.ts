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
