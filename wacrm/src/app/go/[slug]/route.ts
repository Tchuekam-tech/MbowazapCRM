import { createHash } from 'node:crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin, hasServiceRoleKey } from '@/lib/flows/admin-client';
import { serverCache } from '@/lib/server/cache';
import { buildWhatsAppRedirectUrl, normalizeSlug } from '@/lib/marketing/qr-svg';

    test(bot): add res logic in resilience.spec.js
