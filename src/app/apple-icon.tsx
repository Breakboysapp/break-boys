/**
 * Apple-touch-icon — what shows up on iOS home screens when the user
 * taps Share → Add to Home Screen. Apple uses a separate route from
 * the standard icon and applies its own rounded-rect mask.
 *
 * 180x180 is the modern iOS recommendation; older devices upscale OK.
 * Background is solid (no transparency) since iOS will composite it
 * onto the home screen.
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: 100,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "-0.05em",
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, sans-serif",
            lineHeight: 1,
            transform: "translateY(-3%)",
          }}
        >
          BB
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 18,
            backgroundColor: "#d40028",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
