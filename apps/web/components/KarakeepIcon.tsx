import BrandLogo from "./BrandLogo";

/**
 * 兼容层：保留旧组件名，内部转发到品牌标记。
 * 新代码请直接使用 `@/components/BrandLogo`。
 */
export default function KarakeepLogo({
  height,
  withWordmark = true,
}: {
  height: number;
  withWordmark?: boolean;
}) {
  return <BrandLogo height={height} withWordmark={withWordmark} />;
}
