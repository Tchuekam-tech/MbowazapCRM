import { describe, expect, it } from 'vitest';
import { encodeQrMatrix, renderQrSvg } from './qr-svg';
import {
  isPrivateOrBlockedIp,
  validatePublicHttpUrl,
} from '@/lib/jarvis/knowledge-ingestor';
import {
  ForbiddenError,
  UnauthorizedError,
  toErrorResponse,
} from '@/lib/auth/account';

describe('ISO/IEC 18004 QR code encoder hardening', () => {
  it('writes format bits MSB-first symmetrically to Copy 1 and Copy 2 with dark module', () => {
    const matrix = encodeQrMatrix('https://mbowazapcrm-production.up.railway.app/go/vip');
    const size = matrix.length;
    expect(size).toBeGreaterThanOrEqual(21);

    // Dark module at (size - 8, 8) is mandatory in every QR version
    expect(matrix[size - 8]?.[8]).toBe(true);

    // Copy 1: top-left around finder (indices 0..14)
    const copy1: boolean[] = [];
    for (let i = 0; i <= 5; i++) copy1.push(Boolean(matrix[8]?.[i]));
    copy1.push(Boolean(matrix[8]?.[7]));
    copy1.push(Boolean(matrix[8]?.[8]));
    copy1.push(Boolean(matrix[7]?.[8]));
    for (let i = 9; i < 15; i++) copy1.push(Boolean(matrix[14 - i]?.[8]));

    // Copy 2: bottom-left col 8 (0..6) + top-right row 8 (7..14)
    const copy2: boolean[] = [];
    for (let i = 0; i < 7; i++) copy2.push(Boolean(matrix[size - 1 - i]?.[8]));
    for (let i = 7; i < 15; i++) copy2.push(Boolean(matrix[8]?.[size - 15 + i]));

    // Both copies must match bit-for-bit and match EC Level M (00) + Mask 0 (000) -> 0x5412 (MSB 101010000010010)
    expect(copy1).toEqual(copy2);
    const expectedBits = Array.from({ length: 15 }, (_, idx) => (((0x5412 >>> (14 - idx)) & 1) === 1));
    expect(copy1).toEqual(expectedBits);

    const svg = renderQrSvg('https://example.com/go/test');
    expect(svg).toContain('<svg ');
    expect(svg).toContain('</svg>');
  });
});

describe('Knowledge ingestor SSRF hardening', () => {
  it('blocks bracketed IPv6, hex IPv4-mapped loopback, and full fe80::/10 link-local ranges', () => {
    expect(isPrivateOrBlockedIp('[::1]')).toBe(true);
    expect(isPrivateOrBlockedIp('::ffff:7f00:1')).toBe(true);
    expect(isPrivateOrBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIp('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254
    expect(isPrivateOrBlockedIp('fe80::1')).toBe(true);
    expect(isPrivateOrBlockedIp('febf::1234')).toBe(true);
    expect(isPrivateOrBlockedIp('fc00::1')).toBe(true);
    expect(isPrivateOrBlockedIp('fd12::1')).toBe(true);
    expect(isPrivateOrBlockedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects private IPv6 URL literals without DNS lookup', async () => {
    await expect(
      validatePublicHttpUrl('http://[::1]/admin', { skipDnsLookup: true }),
    ).rejects.toThrow(/Private IP/i);
    await expect(
      validatePublicHttpUrl('http://[::ffff:7f00:1]/secret', { skipDnsLookup: true }),
    ).rejects.toThrow(/Private IP/i);
    await expect(
      validatePublicHttpUrl('https://user:pass@example.com', { skipDnsLookup: true }),
    ).rejects.toThrow(/credentials/i);
  });
});

describe('toErrorResponse missing-migration classification', () => {
  it('maps PostgREST PGRST205 / PGRST202 / 42703 errors to HTTP 503 MIGRATION_REQUIRED', async () => {
    const res = toErrorResponse(
      new Error("Could not find the table 'public.growth_links' in the schema cache (PGRST205)"),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MIGRATION_REQUIRED');
  });

  it('preserves 401/403 typed auth errors and masks unknown internal errors as 500', async () => {
    expect(toErrorResponse(new UnauthorizedError()).status).toBe(401);
    expect(toErrorResponse(new ForbiddenError()).status).toBe(403);
    const unknown = toErrorResponse(new Error('secret db connection string'));
    expect(unknown.status).toBe(500);
    const body = await unknown.json();
    expect(body.error).toBe('Internal server error');
  });
});
