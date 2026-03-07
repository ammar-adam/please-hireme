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
        "brand-navy": "#0D1B2A",
        "brand-teal": "#0A9396",
        "brand-teal-light": "#E0F5F5",
        "score-green": "#2D9B5A",
        "score-amber": "#F4A261",
        "score-red": "#E63946",
        surface: "#F8F9FA",
        card: "#FFFFFF",
        "border-subtle": "#E2E8F0",
      },
    },
  },
  plugins: [],
};
export default config;
