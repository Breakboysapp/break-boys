/**
 * App icon — used for the browser tab favicon, the Android home-screen
 * tile when the PWA is installed, and the splash background.
 *
 * generateImageMetadata produces four variants:
 *   - 192 / 512 "any" purpose: standard rounded-tile look (matches
 *     the BB monogram in the header); used by browsers as favicons
 *     and by Android PWAs.
 *   - 192 / 512 "maskable" purpose: same artwork but with extra
 *     padding so Android adaptive-icon masks (circle, squircle, etc.)
 *     can crop without clipping the BB letterforms. The maskable
 *     "safe zone" is the central 80% per the spec; we keep all
 *     content inside that.
 *
 * Apple uses /apple-icon (a separate file) so it doesn't go through
 * this metadata.
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const contentType = "image/png";

type IconId = "192" | "512" | "192-maskable" | "512-maskable";

export function generateImageMetadata() {
  return [
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
    {
      id: "192-maskable",
      size: { width: 192, height: 192 },
      contentType: "image/png",
    },
    {
      id: "512-maskable",
      size: { width: 512, height: 512 },
      contentType: "image/png",
    },
  ];
}

export default function Icon({ id }: { id: string }) {
  const variant = id as IconId;
  const px = variant.startsWith("512") ? 512 : 192;
  const maskable = variant.endsWith("-maskable");
  // Maskable: shrink artwork to fit the central 80% safe zone so the OS
  // mask doesn't clip into the BB. Non-maskable: fill the tile edge-to-edge.
  const inset = maskable ? Math.round(px * 0.1) : 0;
  const fontSize = Math.round((px - inset * 2) * 0.55);
  const stripeHeight = Math.max(2, Math.round((px - inset * 2) * 0.1));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          // Outer fill: black so even maskable safe-zone ring stays
          // brand-consistent if the OS mask is small.
          backgroundColor: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: px - inset * 2,
            height: px - inset * 2,
            backgroundColor: "#0a0a0a",
            // Slight rounding on non-maskable for the rounded-tile look
            // every favicon expects. Maskable stays square because the OS
            // applies its own mask shape.
            borderRadius: maskable ? 0 : Math.round(px * 0.18),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize,
              fontWeight: 900,
              color: "#ffffff",
              letterSpacing: "-0.05em",
              fontFamily:
                "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, sans-serif",
              lineHeight: 1,
              // Optical centering — "BB" sits a hair high without a nudge
              transform: "translateY(-2%)",
            }}
          >
            BB
          </div>
          {/* Red accent stripe along the bottom — same vibe as the
              header's BB tile + OG image. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: stripeHeight,
              backgroundColor: "#d40028",
            }}
          />
        </div>
      </div>
    ),
    { width: px, height: px },
  );
}
