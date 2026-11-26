import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { serverCache } from '@/lib/server/cache';
import { hasServiceRoleKey, supabaseAdmin } from '@/lib/flows/admin-client';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient } from '@/lib/mbowazap/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'wacrm',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
