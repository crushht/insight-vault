import type { Config } from "tailwindcss";

/**
 * 共享 Tailwind 预设（Web 与 Web 侧共享组件）。
 * 所有颜色都从 `tokens.css` 的 `--iv-*` 变量派生，组件里禁止硬编码色值。
 */
export default {
  darkMode: ["class"],
  content: [
    "pages/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "app/**/*.{ts,tsx}",
    "src/**/*.{ts,tsx}",
  ],
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
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--iv-border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        panel: "hsl(var(--panel))",

        // 品牌色（青墨）
        brand: {
          50: "hsl(var(--iv-brand-50))",
          100: "hsl(var(--iv-brand-100))",
          300: "hsl(var(--iv-brand-300))",
          500: "hsl(var(--iv-brand-500))",
          600: "hsl(var(--iv-brand-600))",
          700: "hsl(var(--iv-brand-700))",
          900: "hsl(var(--iv-brand-900))",
        },
        // 琥珀强调（高亮、星标、会员）
        highlight: {
          100: "hsl(var(--iv-amber-100))",
          500: "hsl(var(--iv-amber-500))",
        },
        // AI 语义色（只用于 AI 相关容器与文字）
        ai: {
          from: "hsl(var(--iv-ai-from))",
          to: "hsl(var(--iv-ai-to))",
        },
        // 语义状态色
        success: "hsl(var(--iv-success))",
        warning: "hsl(var(--iv-warning))",
        info: "hsl(var(--iv-info))",

        // 表面层（比 background 语义更明确）
        surface: {
          DEFAULT: "hsl(var(--iv-surface))",
          raised: "hsl(var(--iv-surface-raised))",
          sunken: "hsl(var(--iv-surface-sunken))",
        },

        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderColor: {
        DEFAULT: "hsl(var(--border))",
      },
      fontFamily: {
        sans: ["var(--iv-font-sans)"],
        serif: ["var(--iv-font-serif)"],
        mono: ["var(--iv-font-mono)"],
        display: ["var(--iv-font-serif)"],
      },
      fontSize: {
        display: ["3.5rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        h1: ["2.5rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
        h2: ["2rem", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
        h3: ["1.5rem", { lineHeight: "1.35" }],
        h4: ["1.25rem", { lineHeight: "1.4" }],
        "body-lg": ["1.0625rem", { lineHeight: "1.65" }],
        body: ["0.9375rem", { lineHeight: "1.6" }],
        label: ["0.8125rem", { lineHeight: "1.5" }],
        caption: ["0.75rem", { lineHeight: "1.4" }],
      },
      borderRadius: {
        sm: "var(--iv-radius-sm)",
        md: "var(--iv-radius-md)",
        lg: "var(--iv-radius-lg)",
        xl: "var(--iv-radius-xl)",
        "2xl": "var(--iv-radius-2xl)",
      },
      boxShadow: {
        e1: "var(--iv-shadow-e1)",
        e2: "var(--iv-shadow-e2)",
        e3: "var(--iv-shadow-e3)",
      },
      transitionTimingFunction: {
        standard: "var(--iv-ease-standard)",
        spring: "var(--iv-ease-spring)",
      },
      transitionDuration: {
        fast: "var(--iv-motion-fast)",
        base: "var(--iv-motion-base)",
        slow: "var(--iv-motion-slow)",
      },
    },
  },
} satisfies Config;
