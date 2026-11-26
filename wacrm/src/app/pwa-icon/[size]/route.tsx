import { ImageResponse } from "next/og";

const ALLOWED_SIZES = new Set([192, 512]);

export async function GET(
  _req: Request,
  context: { params: Promise<{ size: string }> },
) {
  const { size: raw } = await context.params;
  const parsed = Number.parseInt(raw, 10);
  const dim = ALLOWED_SIZES.has(parsed) ? parsed : 192;
  const radius = Math.round(dim * 0.22);
  const glyphSize = Math.round(dim * 0.56);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
          borderRadius: radius,
        }}
      >
        <svg
          width={glyphSize}
          height={glyphSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    {
      width: dim,
      height: dim,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
