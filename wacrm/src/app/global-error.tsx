'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#020617',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            padding: '1.5rem',
            borderRadius: '0.75rem',
            border: '1px solid #1e293b',
            backgroundColor: '#0f172a',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.125rem', margin: '0 0 0.5rem' }}>
            Application error
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: '0 0 1rem' }}>
            A critical error prevented the application from rendering.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                border: 'none',
                backgroundColor: '#7c3aed',
                color: '#ffffff',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/dashboard"
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                border: '1px solid #334155',
                color: '#f8fafc',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
