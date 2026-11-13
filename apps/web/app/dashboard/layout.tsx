import { Crown, MessageSquare, Network, PenLine, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import AllLists from "@/components/dashboard/sidebar/AllLists";
import MobileSidebar from "@/components/shared/sidebar/MobileSidebar";
import Sidebar from "@/components/shared/sidebar/Sidebar";
import { SearchQueryBridge } from "@/components/dashboard/SearchQueryBridge";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import SidebarLayout from "@/components/shared/sidebar/SidebarLayout";
import { Separator } from "@/components/ui/separator";
import { ReaderSettingsProvider } from "@/lib/readerSettings";
import { UserSettingsContextProvider } from "@/lib/userSettings";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";
import { TRPCError } from "@trpc/server";
import { TFunction } from "i18next";
import {
  Archive,
  Settings,
  ClipboardList,
  FileText,
  Highlighter,
  Home,
  Image as ImageIcon,
  Search,
  Tag,
  Video as VideoIcon,
  FileType2,
} from "lucide-react";

import { PluginManager, PluginType } from "@karakeep/shared/plugins";
import { tryCatch } from "@karakeep/shared/tryCatch";

export default async function Dashboard({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  const session = await getServerAuthSession();
  if (!session) {
    redirect("/");
  }

  const [lists, userSettings] = await Promise.all([
    tryCatch(api.lists.list()),
    tryCatch(api.users.settings()),
  ]);

  if (userSettings.error) {
    if (userSettings.error instanceof TRPCError) {
      if (
        userSettings.error.code === "NOT_FOUND" ||
        userSettings.error.code === "UNAUTHORIZED"
      ) {
        redirect("/logout");
      }
    }
    throw userSettings.error;
  }

  if (lists.error) {
    throw lists.error;
  }

  const items = (t: TFunction) =>
    [
      {
        name: t("common.home"),
        icon: <Home size={18} />,
        path: "/dashboard/bookmarks",
      },
      // 内容形态分类：走查询语言（is:image / is:video / is:pdf），结果走搜索页
      {
        name: "图片",
        icon: <ImageIcon size={18} />,
        path: "/dashboard/search?q=is%3Aimage",
      },
      {
        name: "视频",
        icon: <VideoIcon size={18} />,
        path: "/dashboard/search?q=is%3Avideo",
      },
      {
        name: "文章",
        icon: <FileText size={18} />,
        path: "/dashboard/search?q=is%3Alink+-is%3Avideo",
      },
      {
        name: "PDF / 文件",
        icon: <FileType2 size={18} />,
        path: "/dashboard/search?q=is%3Apdf",
      },
      PluginManager.isRegistered(PluginType.Search)
        ? [
            {
              name: t("common.search"),
              icon: <Search size={18} />,
              path: "/dashboard/search",
            },
          ]
        : [],
      {
        name: t("common.ai_chat"),
        icon: <MessageSquare size={18} />,
        path: "/dashboard/chat",
      },
      {
        name: t("common.knowledge_graph"),
        icon: <Network size={18} />,
        path: "/dashboard/graph",
      },
      {
        name: t("common.topics"),
        icon: <Sparkles size={18} />,
        path: "/dashboard/topics",
      },
      {
        name: t("common.create"),
        icon: <PenLine size={18} />,
        path: "/dashboard/create",
      },
      {
        name: t("common.membership"),
        icon: <Crown size={18} />,
        path: "/dashboard/support",
      },
      {
        name: "设置",
        icon: <Settings size={18} />,
        path: "/settings",
      },
      {
        name: t("common.tags"),
        icon: <Tag size={18} />,
        path: "/dashboard/tags",
      },
      {
        name: t("common.highlights"),
        icon: <Highlighter size={18} />,
        path: "/dashboard/highlights",
      },
      {
        name: t("common.archive"),
        icon: <Archive size={18} />,
        path: "/dashboard/archive",
      },
    ].flat();

  const mobileSidebar = (t: TFunction) => [
    ...items(t),
    {
      name: t("lists.all_lists"),
      icon: <ClipboardList size={18} />,
      path: "/dashboard/lists",
    },
  ];

  return (
    <UserSettingsContextProvider userSettings={userSettings.data}>
      <ReaderSettingsProvider>
        <SearchQueryBridge>
        <SidebarLayout
          sidebar={
            <Sidebar
              items={items}
              extraSections={
                <>
                  <Separator />
                  <AllLists initialData={lists.data} />
                </>
              }
            />
          }
          mobileSidebar={<MobileSidebar items={mobileSidebar} />}
          modal={modal}
        >
          {children}
          <InstallPrompt />
        </SidebarLayout>
        </SearchQueryBridge>
      </ReaderSettingsProvider>
    </UserSettingsContextProvider>
  );
}
