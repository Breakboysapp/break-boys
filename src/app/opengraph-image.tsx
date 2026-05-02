/**
 * Open Graph image — what shows up when someone shares breakboys.app on
 * iMessage, Discord, Twitter, Slack, etc. Next.js auto-generates the
 * og:image <meta> tag for any route that has an opengraph-image file
 * colocated with it (this one is at the root, so it's the default for
 * the whole site; per-route overrides could ship in the same way).
 *
 * Rendered server-side at request time via next/og's ImageResponse,
 * which renders a JSX subset (block layouts, gradients, basic text,
 * inline SVGs) into a PNG. The output dimensions and contentType are
 * the standard 1.91:1 ratio every social platform expects.
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Break Boys — track sports card breaks, score every team";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0a0a0a",
          color: "#ffffff",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          position: "relative",
          padding: "72px 80px",
        }}
      >
        {/* Top-row: BB monogram + small wordmark, mirroring the header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <div
            style={{
              width: "96px",
              height: "96px",
              borderRadius: "16px",
              backgroundColor: "#0a0a0a",
              border: "2px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontSize: "56px",
                fontWeight: 900,
                letterSpacing: "-3px",
                lineHeight: 1,
                color: "#ffffff",
              }}
            >
              BB
            </div>
            {/* Red accent stripe along the bottom of the BB tile */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: "10px",
                backgroundColor: "#d40028",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              lineHeight: 1,
            }}
          >
            <div
              style={{
                fontSize: "18px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "2px",
                color: "#d40028",
              }}
            >
              Break
            </div>
            <div
              style={{
                fontSize: "36px",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "-1px",
                marginTop: "6px",
              }}
            >
              Boys
            </div>
          </div>
        </div>

        {/* Hero stack — pushes to bottom-left */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "auto",
          }}
        >
          <div
            style={{
              fontSize: "20px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "3px",
              color: "#d40028",
              marginBottom: "20px",
            }}
          >
            Beat the Break
          </div>
          <div
            style={{
              fontSize: "120px",
              fontWeight: 900,
              lineHeight: 0.95,
              letterSpacing: "-4px",
              color: "#ffffff",
            }}
          >
            Score every
          </div>
          <div
            style={{
              fontSize: "120px",
              fontWeight: 900,
              lineHeight: 0.95,
              letterSpacing: "-4px",
              color: "#ffffff",
              marginTop: "4px",
            }}
          >
            team.
          </div>
          <div
            style={{
              fontSize: "26px",
              fontWeight: 500,
              lineHeight: 1.3,
              color: "rgba(255,255,255,0.7)",
              marginTop: "28px",
              maxWidth: "780px",
            }}
          >
            Per-team checklists, content scores, and market values for
            modern Topps, Bowman, and Panini sports breaks.
          </div>
        </div>

        {/* Bottom-right URL stamp */}
        <div
          style={{
            position: "absolute",
            right: "80px",
            bottom: "60px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "20px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "2px",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          breakboys.app
        </div>

        {/* Full-width red accent line at the very bottom — mirrors the
            monogram and ties the composition together */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "12px",
            backgroundColor: "#d40028",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
