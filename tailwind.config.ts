import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "quanto-navy": "#0D1B2A",
        "quanto-teal": "#0A9396",
        "quanto-teal-mid": "#C8ECED",
        "quanto-teal-bg": "#F0FAFA",
        "score-green": "#2D9B5A",
        "score-green-bg": "#EBF7F0",
        "score-amber": "#F4A261",
        "score-amber-bg": "#FEF3E8",
        "score-red": "#E63946",
        "score-red-bg": "#FDECED",
        surface: "#F8F9FA",
        card: "#FFFFFF",
        "border-subtle": "#E2E8F0",
        "text-muted": "#6B7280",
      },
    },
  },
  plugins: [],
};
export default config;
