import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        // MUXARO Brand Core Palette
        brand: {
          DEFAULT: "var(--muxaro-indigo)",
          violet: "var(--muxaro-indigo)",
          indigo: "var(--muxaro-indigo)",
          blue: "var(--muxaro-blue)",
          cyan: "var(--muxaro-cyan)",
          dark: "var(--muxaro-bg-base)",
          surface: "var(--muxaro-bg-surface)",
        },

        // Core Semantic Surfaces (Light-first consumer workspace)
        base: "var(--muxaro-bg-base)",
        main: "var(--muxaro-bg-base)",
        surface: {
          DEFAULT: "var(--muxaro-bg-surface)",
          elevated: "var(--muxaro-bg-elevated)",
          muted: "var(--muxaro-bg-interactive)",
          interactive: "var(--muxaro-bg-interactive)",
        },
        elevated: "var(--muxaro-bg-elevated)",
        interactive: "var(--muxaro-bg-interactive)",

        // Typography / Content Tokens
        primary: "var(--muxaro-text-primary)",
        secondary: "var(--muxaro-text-secondary)",
        tertiary: "var(--muxaro-text-tertiary)",
        content: {
          DEFAULT: "var(--muxaro-text-primary)",
          secondary: "var(--muxaro-text-secondary)",
          muted: "var(--muxaro-text-tertiary)",
        },
        
        // Borders & Rules
        border: "var(--muxaro-border)",
        line: {
          DEFAULT: "var(--muxaro-border)",
          subtle: "var(--muxaro-border-subtle)",
        },
        
        // Status Semantics
        success: {
          DEFAULT: "var(--muxaro-success)",
          bg: "var(--muxaro-success-bg)",
        },
        warning: {
          DEFAULT: "var(--muxaro-warning)",
          bg: "var(--muxaro-warning-bg)",
        },
        error: {
          DEFAULT: "var(--muxaro-error)",
          bg: "var(--muxaro-error-bg)",
        },
        info: {
          DEFAULT: "var(--muxaro-info)",
          bg: "var(--muxaro-info-bg)",
        },

        // Backward compatibility mappings
        paper: "var(--muxaro-bg-surface)",
        "paper-2": "var(--muxaro-bg-base)",
        "paper-3": "var(--muxaro-bg-elevated)",
        ink: "var(--muxaro-text-primary)",
        "ink-2": "var(--muxaro-text-secondary)",
        muted: "var(--muxaro-text-tertiary)",
        rule: "var(--muxaro-border)",
        "rule-2": "var(--muxaro-border-subtle)",
        indigo: "var(--muxaro-indigo)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        md: "10px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "32px",
        full: "9999px",
      },
      boxShadow: {
        sm: "var(--muxaro-shadow-sm)",
        md: "var(--muxaro-shadow-md)",
        lg: "var(--muxaro-shadow-lg)",
        subtle: "var(--muxaro-shadow-sm)",
        card: "var(--muxaro-shadow-md)",
        elevated: "var(--muxaro-shadow-lg)",
        brand: "var(--muxaro-shadow-btn)",
        "brand-hover": "var(--muxaro-shadow-btn-hover)",
        focus: "var(--muxaro-shadow-focus)",
      },
      backgroundImage: {
        "muxaro-gradient": "var(--muxaro-gradient-primary)",
        "muxaro-gradient-hover": "var(--muxaro-gradient-hover)",
        "muxaro-gradient-subtle": "var(--muxaro-gradient-subtle)",
        "muxaro-hero": "var(--muxaro-hero-wash)",
        "muxaro-aurora-static": "var(--muxaro-aurora-static)",
      },
      maxWidth: {
        sheet: "1280px",
      },
    },
  },
  plugins: [],
};

export default config;
