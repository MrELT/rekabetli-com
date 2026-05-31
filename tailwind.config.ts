import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        rekabetli: {
          bg: "#0b111b",
          "bg-soft": "#0f1725",
          surface: "#131f34",
          "surface-strong": "#1a2740",
          text: "#e8eefc",
          muted: "#9caaca",
          primary: "#2d8cff",
          "primary-strong": "#1e63da",
          action: "#ff8a1e",
          border: "rgba(123, 151, 206, 0.25)",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [typography],
};

export default config;
