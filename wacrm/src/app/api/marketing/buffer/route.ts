import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { serverCache } from '@/lib/server/cache';
import { BufferApiError } from '@/lib/marketing/buffer-client';
import {
  connectBufferAccount,
  syncBufferForAccount,
} from '@/lib/marketing/buffer-sync';
import { loadDigitalPresenceReport } from '@/lib/marketing/presence-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const report = await loadDigitalPresenceReport(ctx.supabase, ctx.accountId);
    return NextResponse.json(report);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
