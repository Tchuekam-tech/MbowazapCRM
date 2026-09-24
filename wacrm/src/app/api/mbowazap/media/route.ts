import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { findAccountBySession } from '@/lib/mbowazap/accounts';
import { bridgeError, readBotRequest } from '@/lib/mbowazap/bot-request';
import { SESSION_PATTERN } from '@/lib/mbowazap/protocol';
import { buildMediaPath, MEDIA_MAX_BYTES } from '@/lib/storage/upload-media';
import {
  MIRROR_BUCKET,
  mirrorFileName,
  normalizeMimeType,
} from '@/lib/whatsapp/mirror-inbound-media';

/**
 * POST /api/mbowazap/media?session=<paired number>&filename=<name>
 *
 * One media file from TchuekBot, as raw bytes with its Content-Type —
 * signed like every bridge request, so the signature covers the bytes.
 * Stored in the account's folder of the `chat-media` bucket (the same
 * home as mirrored Meta media) and answered with
 * `{ ok, url, mimeType, sizeBytes }`; the bot then puts that URL on the
 * message event. A type the bucket doesn't allow answers 415, and the
 * bot records the message without its media.
 */

const FOLDER = 'mbowazap';

export async function POST(request: Request) {
  const read = await readBotRequest(request, MEDIA_MAX_BYTES);
  if (!read.ok) return read.response;
  if (read.body.length === 0) {
    return bridgeError(400, 'invalid_request', 'Media body is empty');
  }

  const session = read.url.searchParams.get('session') ?? '';
  if (!SESSION_PATTERN.test(session)) {
    return bridgeError(400, 'invalid_request', 'session must be the paired number as 6-15 digits');
  }

  const db = supabaseAdmin();
  let accountId: string;
  try {
    const account = await findAccountBySession(db, session);
    if (!account) {
      return bridgeError(404, 'not_found', `No wacrm account is paired with ${session}`);
    }
    accountId = account.accountId;
  } catch (err) {
    console.error('[mbowazap/media] account lookup failed:', err);
    return bridgeError(503, 'internal_error', 'Could not resolve the account; retry later');
  }

  const mimeType =
    normalizeMimeType(request.headers.get('content-type')) ?? 'application/octet-stream';
  // A digits-only prefix: download names hide a leading run of 10+
  // digits (`basenameFromUrl`), so the agent saves the original name.
  const objectName = mirrorFileName({
    mediaId: `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    mimeType,
    fileName: read.url.searchParams.get('filename'),
  });
  const path = buildMediaPath(accountId, objectName, null, FOLDER);

  const { error } = await db.storage.from(MIRROR_BUCKET).upload(path, read.body, {
    contentType: mimeType,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) {
    // Most likely a type outside the bucket's allow-list (migration 039).
    console.warn(`[mbowazap/media] upload failed (${mimeType}):`, error.message);
    return bridgeError(415, 'unsupported_media', error.message);
  }

  const {
    data: { publicUrl },
  } = db.storage.from(MIRROR_BUCKET).getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    url: publicUrl,
    mimeType,
    sizeBytes: read.body.length,
  });
}
