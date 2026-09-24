import { NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { bridgeError, readBotRequest } from '@/lib/mbowazap/bot-request';
import { ingestBatch, type IngestResult } from '@/lib/mbowazap/ingest';
import { parseEventBatch, type RejectedEvent } from '@/lib/mbowazap/protocol';

/**
 * POST /api/mbowazap/events
 *
 * Signed event batches from TchuekBot (docs/mbowazap-bridge.md): inbound
 * and outbound messages, delivery statuses, reactions, connection
 * changes and Davila's CRM facts.
 *
 * The records are written before answering, so a 2xx means they are
 * stored and the bot may drop the batch; any storage failure answers
 * 503 and the bot retries (every event is idempotent). The reply
 * engines — Flows, automations, AI auto-reply — and public webhooks run
 * afterwards in `after()`, like the Meta webhook's fan-out.
 */

// Headroom for the `after()` fan-out (flows, automations, AI replies).
export const maxDuration = 60;

// A batch holds at most 100 events of at most 64 KB text each.
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  const read = await readBotRequest(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  let json: unknown;
  try {
    json = JSON.parse(read.body.toString('utf8'));
  } catch {
    return bridgeError(400, 'invalid_request', 'Body must be valid JSON');
  }
  const parsed = parseEventBatch(json);
  if (!parsed.ok) return bridgeError(400, 'invalid_request', parsed.error);

  const deferred: (() => Promise<void>)[] = [];
  let result: IngestResult;
  try {
    result = await ingestBatch(
      { db: supabaseAdmin(), defer: (task) => deferred.push(task) },
      parsed.batch
    );
  } catch (err) {
    console.error('[mbowazap/events] batch not stored; the bot will retry:', err);
    return bridgeError(503, 'internal_error', 'Events could not be stored; retry later');
  }

  if (deferred.length > 0) {
    // Awaited one by one inside `after()`, which only keeps the function
    // alive for promises it can see (see issue #301).
    after(async () => {
      for (const task of deferred) {
        try {
          await task();
        } catch (err) {
          console.error('[mbowazap/events] follow-up failed:', err);
        }
      }
    });
  }

  // Ingest reports positions within the parsed events; map them back to
  // the positions the bot sent.
  const rejected: RejectedEvent[] = [
    ...parsed.rejected,
    ...result.rejected.map((r) => ({
      ...r,
      index: parsed.eventIndexes[r.index] ?? r.index,
    })),
  ].sort((a, b) => a.index - b.index);

  return NextResponse.json({ ok: true, accepted: result.accepted, rejected });
}
