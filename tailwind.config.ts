import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0a", // Fanatics-style near-black for headers, primary CTAs
        accent: "#d40028", // Fanatics red — sparingly, for emphasis / hot states
        // Solid pre-flattened version of accent at ~10% over white. Used on
        // sticky table cells where bg-accent/10 (translucent) lets the text
        // of the cell underneath bleed through during horizontal scroll.
        "accent-tint": "#fbe6ea",
        paper: "#ffffff",
        bone: "#f5f5f5", // background panels
      },
      fontFamily: {
        display: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      letterSpacing: {
        "tight-2": "-0.02em",
        "tight-3": "-0.03em",
      },
    },
  },
  plugins: [],
};

export default config;
