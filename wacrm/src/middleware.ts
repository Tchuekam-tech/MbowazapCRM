import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  // Explicitly bypass session middleware for health checks, public
  // Click-to-WhatsApp growth links (/go/*), cron endpoints (protected
  // by x-cron-secret), and MboWazap bot-to-CRM HMAC endpoints.
  if (
    pathname === '/api/health' ||
    pathname === '/api/mbowazap/events' ||
    pathname.startsWith('/api/mbowazap/media') ||
    pathname.startsWith('/go/') ||
    pathname === '/api/cron/tick' ||
    pathname === '/api/marketing/sequences/cron'
  ) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/notifications',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/marketing',
    '/automations',
    '/flows',
    '/agents',
    '/settings',
  ]
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks, health check, or HMAC bot ingestion)
  if (
    !user &&
    ((pathname.startsWith('/api/whatsapp/') && !pathname.includes('/webhook')) ||
      (pathname.startsWith('/api/mbowazap/') &&
        pathname !== '/api/mbowazap/events' &&
        !pathname.startsWith('/api/mbowazap/media')))
  ) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  if (protectedPaths.some((path) => pathname.startsWith(path))) {
    supabaseResponse.headers.set('Cache-Control', 'private, no-store')
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // api/health, api/mbowazap/events, api/mbowazap/media, /go/* growth
    // redirects, and cron endpoints are excluded for zero-overhead latency.
    '/((?!_next/static|_next/image|favicon.ico|api/health|api/mbowazap/events|api/mbowazap/media|api/cron/tick|api/marketing/sequences/cron|go/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
