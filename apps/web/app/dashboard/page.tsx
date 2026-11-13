import { redirect } from "next/navigation";

/**
 * `/dashboard` 在 Karakeep 上游没有对应页面（只有子路由），直接访问会 404。
 * 灵感仓把「知识首页」定为收藏总览，这里做一次语义重定向。
 */
export default function DashboardIndexPage() {
  redirect("/dashboard/bookmarks");
}
