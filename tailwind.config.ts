import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./constants/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        fill: {
          1: "rgba(255, 255, 255, 0.10)",
        },
        bankGradient: "#0179FE",
        indigo: {
          500: "#6172F3",
          700: "#3538CD",
          // Expanded shades
          600: "#4A5ED8",
          800: "#2A2E9C",
        },
        success: {
          25: "#F6FEF9",
          50: "#ECFDF3",
          100: "#D1FADF",
          600: "#039855",
          700: "#027A48",
          900: "#054F31",
          // Expanded shades
          200: "#A7F3D0",
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          800: "#065F46",
        },
        pink: {
          25: "#FEF6FB",
          100: "#FCE7F6",
          500: "#EE46BC",
          600: "#DD2590",
          700: "#C11574",
          900: "#851651",
          // Expanded shades
          200: "#FBCFE8",
          300: "#F9A8D4",
          400: "#F472B6",
          800: "#9D174D",
        },
        red: {
          25: "#FFFBFA",
          50: "#FEF2F2",
          100: "#FEE2E2",
          200: "#FECACA",
          300: "#FCA5A5",
          400: "#F87171",
          500: "#EF4444",
          600: "#DC2626",
          700: "#B91C1C",
          800: "#991B1B",
          900: "#7F1D1D",
          950: "#450A0A",
          // Expanded shades
          150: "#FECACA",
          250: "#FCA5A5",
          350: "#F87171",
          450: "#EF4444",
          550: "#DC2626",
          650: "#B91C1C",
          750: "#991B1B",
          850: "#7F1D1D",
        },
        blue: {
          25: "#F5FAFF",
          100: "#D1E9FF",
          500: "#2E90FA",
          600: "#1570EF",
          700: "#175CD3",
          900: "#194185",
          // Expanded shades
          200: "#A7D8FF",
          300: "#7EC7FF",
          400: "#55B6FF",
          800: "#144BA8",
        },
        sky: {
          1: "#F3F9FF",
          // Expanded shades
          50: "#E0F2FF",
          100: "#BAE6FF",
          200: "#7DD3FC",
          300: "#38BDF8",
          400: "#0EA5E9",
          500: "#0284C7",
          600: "#0369A1",
          700: "#075985",
          800: "#0C4A6E",
          900: "#0A3A5A",
        },
        black: {
          1: "#00214F",
          2: "#344054",
          // Expanded shades
          3: "#1C1C1E",
          4: "#2C2C2E",
          5: "#3A3A3C",
          6: "#48484A",
          7: "#636366",
          8: "#8E8E93",
          9: "#AEAEB2",
        },
        gray: {
          25: "#FCFCFD",
          200: "#EAECF0",
          300: "#D0D5DD",
          500: "#667085",
          600: "#475467",
          700: "#344054",
          900: "#101828",
          // Expanded shades
          50: "#F9FAFB",
          100: "#F3F4F6",
          400: "#9CA3AF",
          800: "#1F2937",
        },
        // Bank card colors
        bankcard: {
          violet: "#8B5CF6",
          fuchsia: "#D946EF",
          cyan: "#06B6D4",
          blue: "#3B82F6",
          emerald: "#10B981",
          teal: "#0D9488",
          orange: "#F97316",
          amber: "#F59E0B",
          rose: "#F43F5E",
          red: "#EF4444",
          lime: "#84CC16",
          green: "#22C55E",
          pink: "#EC4899",
          yellow: "#EAB308",
          indigo: "#6366F1",
          purple: "#A855F7",
        },
      },
      backgroundImage: {
        "bank-gradient": "linear-gradient(90deg, #0179FE 0%, #4893FF 100%)",
        "gradient-mesh": "url('/icons/gradient-mesh.svg')",
        "bank-green-gradient":
          "linear-gradient(90deg, #01797A 0%, #489399 100%)",
        // Bank card gradients
        "bankcard-violet-fuchsia": "linear-gradient(to right, #8B5CF6, #D946EF)",
        "bankcard-cyan-blue": "linear-gradient(to right, #06B6D4, #3B82F6)",
        "bankcard-emerald-teal": "linear-gradient(to right, #10B981, #0D9488)",
        "bankcard-orange-amber": "linear-gradient(to right, #F97316, #F59E0B)",
        "bankcard-rose-red": "linear-gradient(to right, #F43F5E, #EF4444)",
        "bankcard-blue-indigo": "linear-gradient(to right, #3B82F6, #6366F1)",
        "bankcard-lime-green": "linear-gradient(to right, #84CC16, #22C55E)",
        "bankcard-pink-rose": "linear-gradient(to right, #EC4899, #F43F5E)",
        "bankcard-yellow-orange": "linear-gradient(to right, #EAB308, #F97316)",
        "bankcard-indigo-purple": "linear-gradient(to right, #6366F1, #A855F7)",
      },
      boxShadow: {
        form: "0px 1px 2px 0px rgba(16, 24, 40, 0.05)",
        chart:
          "0px 1px 3px 0px rgba(16, 24, 40, 0.10), 0px 1px 2px 0px rgba(16, 24, 40, 0.06)",
        profile:
          "0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)",
        creditCard: "8px 10px 16px 0px rgba(0, 0, 0, 0.05)",
      },
      fontFamily: {
        inter: "var(--font-inter)",
        "ibm-plex-serif": "var(--font-ibm-plex-serif)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;

export default config;
