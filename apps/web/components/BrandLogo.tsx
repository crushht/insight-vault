/**
 * 品牌标记：一个「仓」的方块 + 一道斜向的灵感之光。
 *
 * - 方块用 `currentColor`，因此在明暗主题与任意容器里都自动适配；
 * - 光带用 AI 渐变（--iv-ai-from → --iv-ai-to），是品牌唯一允许的渐变；
 * - 不使用外部位图，缩放不失真。
 */
export default function BrandLogo({
  height = 32,
  withWordmark = false,
  className = "",
}: {
  height?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-foreground ${className}`}
    >
      <svg
        width={height}
        height={height}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="iv-beam" x1="8" y1="26" x2="24" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="hsl(var(--iv-ai-from))" />
            <stop offset="100%" stopColor="hsl(var(--iv-ai-to))" />
          </linearGradient>
          <mask id="iv-mark-mask">
            <rect x="0" y="0" width="32" height="32" rx="9" fill="white" />
            <path d="M10.2 23.4 L16.4 8.6 h3.6 L13.8 23.4 Z" fill="black" />
          </mask>
        </defs>
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="9"
          fill="currentColor"
          mask="url(#iv-mark-mask)"
        />
        <path
          d="M10.2 23.4 L16.4 8.6 h3.6 L13.8 23.4 Z"
          fill="url(#iv-beam)"
        />
      </svg>
      {withWordmark && (
        <span className="font-display text-[1.15em] font-semibold tracking-tight">
          灵感仓
        </span>
      )}
    </span>
  );
}
