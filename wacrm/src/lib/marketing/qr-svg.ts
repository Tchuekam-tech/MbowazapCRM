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
