import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { serverCache } from '@/lib/server/cache';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient, type BotRuntimeMetrics } from '@/lib/mbowazap/client';

export const dynamic = 'force-dynamic';

/**
 * Authenticated live server health & speed monitor for both the
 * Next.js CRM server and the TchuekBot Baileys gateway.
 * Cached for 5s via singleflight to keep repeated dashboard refreshes instant.
 */
