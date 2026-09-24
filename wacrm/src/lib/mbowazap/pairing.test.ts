import { describe, expect, it, vi } from 'vitest';
import { MbowazapBridgeError, type MbowazapClient } from './client';
import { bridgeErrorStatus, requestPairingQr } from './pairing';

const REF = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const QR = {
  method: 'qr' as const,
  qr: 'data:image/png;base64,QUJD',
  session: 'temp_qr' as const,
};

function clientWith(pair: MbowazapClient['pair']): MbowazapClient {
  return { pair } as MbowazapClient;
}

describe('requestPairingQr', () => {
  it('retries while the bot is still starting its QR socket', async () => {
    const pair = vi
      .fn()
      .mockRejectedValueOnce(
        new MbowazapBridgeError('pairing_pending', 'not yet', 503)
      )
      .mockResolvedValueOnce(QR);
    const sleep = vi.fn(async () => {});
    await expect(
      requestPairingQr(clientWith(pair), REF, sleep)
    ).resolves.toEqual(QR);
    expect(pair).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('gives up after a few pending answers', async () => {
    const pair = vi
      .fn()
      .mockRejectedValue(
        new MbowazapBridgeError('pairing_pending', 'not yet', 503)
      );
    await expect(
      requestPairingQr(clientWith(pair), REF, async () => {})
    ).rejects.toMatchObject({
      code: 'pairing_pending',
    });
    expect(pair).toHaveBeenCalledTimes(3);
  });

  it('does not retry other failures', async () => {
    const pair = vi
      .fn()
      .mockRejectedValue(
        new MbowazapBridgeError('pairing_failed', 'socket died', 502)
      );
    await expect(
      requestPairingQr(clientWith(pair), REF, async () => {})
    ).rejects.toMatchObject({
      code: 'pairing_failed',
    });
    expect(pair).toHaveBeenCalledTimes(1);
  });
});

describe('bridgeErrorStatus', () => {
  it('maps bridge failures to gateway statuses', () => {
    expect(
      bridgeErrorStatus(new MbowazapBridgeError('unauthorized', 'x', 401))
    ).toBe(502);
    expect(bridgeErrorStatus(new MbowazapBridgeError('timeout', 'x'))).toBe(
      504
    );
    expect(
      bridgeErrorStatus(new MbowazapBridgeError('already_connected', 'x', 409))
    ).toBe(409);
  });
});
