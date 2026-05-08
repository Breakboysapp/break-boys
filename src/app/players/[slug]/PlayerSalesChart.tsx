"use client";

import { formatUsd } from "@/lib/money";

/**
 * Compact bar chart for a player's weekly sales volume — both bar
 * height (count) and a small dollar volume label per bar.
 *
 * Pure SVG, no chart library — this is one of ~3 chart instances in
 * the app and the data is always 12 buckets, so a 50-line bespoke
 * implementation beats pulling in recharts/chart.js for the bundle
 * cost.
 */
export type Bucket = {
  bucketStart: string;
  bucketEnd: string;
  count: number;
  totalCents: number;
  averageCents: number;
  partial: boolean;
};

const WIDTH = 720;
const HEIGHT = 180;
const PAD_X = 40;
const PAD_TOP = 12;
const PAD_BOTTOM = 32;

export default function PlayerSalesChart({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        No recent sales data for this player.
      </div>
    );
  }

  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const barSlot = innerW / buckets.length;
  const barW = Math.max(8, barSlot - 6);

  // Format week start ISO → "May 5". Concise label that stays readable
  // when 12 ticks have to share a 720px chart. Parse YYYY-MM-DD as a
  // local date to avoid the off-by-one shift you get from `new
  // Date("2026-02-16")` interpreting it as UTC midnight then converting
  // to a westward-shifted local date.
  const fmtTick = (iso: string) => {
    if (!iso) return "";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const [, y, mo, d] = m;
      const local = new Date(Number(y), Number(mo) - 1, Number(d));
      return local.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }
    return iso.slice(5, 10);
  };

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Weekly sales volume chart"
        className="block w-full max-w-3xl"
      >
        {/* Y-axis baseline */}
        <line
          x1={PAD_X}
          y1={PAD_TOP + innerH}
          x2={PAD_X + innerW}
          y2={PAD_TOP + innerH}
          stroke="#e2e8f0"
          strokeWidth={1}
        />

        {buckets.map((b, i) => {
          const h = (b.count / maxCount) * innerH;
          const x = PAD_X + i * barSlot + (barSlot - barW) / 2;
          const y = PAD_TOP + innerH - h;
          // Partial buckets (current week, still accumulating) get a
          // dashed outline instead of solid fill so users don't read
          // them as final.
          return (
            <g key={b.bucketStart}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={2}
                fill={b.partial ? "#fde8e8" : "#ef4444"}
                stroke={b.partial ? "#ef4444" : "none"}
                strokeWidth={b.partial ? 1.5 : 0}
                strokeDasharray={b.partial ? "3 2" : undefined}
              >
                <title>
                  {fmtTick(b.bucketStart)}
                  {b.bucketEnd ? `–${fmtTick(b.bucketEnd)}` : ""} · {b.count}{" "}
                  sales · {formatUsd(b.totalCents)}
                  {b.partial ? " (in progress)" : ""}
                </title>
              </rect>
              <text
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize={9}
                fill="#475569"
                fontWeight="bold"
              >
                {b.count > 0 ? b.count : ""}
              </text>
              <text
                x={x + barW / 2}
                y={PAD_TOP + innerH + 14}
                textAnchor="middle"
                fontSize={9}
                fill="#94a3b8"
              >
                {fmtTick(b.bucketStart)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
