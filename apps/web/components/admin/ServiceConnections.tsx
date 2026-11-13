"use client";

import { AdminCard } from "@/components/admin/AdminCard";
import { useTranslation } from "@/lib/i18n/client";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

function ConnectionStatus({
  label,
  configured,
  connected,
  pluginName,
  error,
}: {
  label: string;
  configured: boolean;
  connected: boolean;
  pluginName?: string;
  error?: string;
}) {
  const { t } = useTranslation();

  let statusText = t("admin.service_connections.status.not_configured");
  let badgeColor =
    "bg-surface-sunken text-muted-foreground dark:bg-muted dark:text-muted-foreground";
  let iconColor = "text-muted-foreground/80";
  let borderColor = "border-border dark:border-border";

  if (configured) {
    if (connected) {
      statusText = t("admin.service_connections.status.connected");
      badgeColor =
        "bg-success/10 text-success dark:bg-success/20 dark:text-success";
      iconColor = "text-success";
      borderColor = "border-green-200 dark:border-green-900";
    } else {
      statusText = t("admin.service_connections.status.disconnected");
      badgeColor =
        "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive";
      iconColor = "text-destructive";
      borderColor = "border-red-200 dark:border-red-900";
    }
  }

  return (
    <div
      className={`rounded-lg border ${borderColor} bg-card p-5 shadow-sm transition-all`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold">{label}</div>
          {pluginName && (
            <div className="mt-1 text-xs text-muted-foreground">
              {pluginName}
            </div>
          )}
        </div>
        <div
          className={`flex h-2 w-2 items-center justify-center rounded-full ${iconColor}`}
        >
          <div
            className={`h-2 w-2 rounded-full ${connected && configured ? "animate-pulse" : ""} bg-current`}
          ></div>
        </div>
      </div>
      <div className="mb-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}
        >
          {statusText}
        </span>
      </div>
      {error && (
        <div className="mt-3 rounded-md bg-destructive/10 p-2 dark:bg-destructive/20">
          <p className="text-xs text-destructive dark:text-destructive" title={error}>
            {error.length > 60 ? `${error.substring(0, 60)}...` : error}
          </p>
        </div>
      )}
    </div>
  );
}

function ConnectionsSkeleton() {
  return (
    <AdminCard>
      <div className="mb-4 h-7 w-40 animate-pulse rounded bg-border dark:bg-muted"></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-5 shadow-sm dark:border-border"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="h-5 w-28 animate-pulse rounded bg-border dark:bg-muted"></div>
              <div className="h-2 w-2 animate-pulse rounded-full bg-gray-300 dark:bg-input"></div>
            </div>
            <div className="mb-2">
              <div className="h-5 w-20 animate-pulse rounded-full bg-border dark:bg-muted"></div>
            </div>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}

export default function ServiceConnections() {
  const api = useTRPC();
  const { t } = useTranslation();
  const { data: connections } = useQuery(
    api.admin.checkConnections.queryOptions(undefined, {
      refetchInterval: 10000,
    }),
  );

  if (!connections) {
    return <ConnectionsSkeleton />;
  }

  return (
    <AdminCard>
      <div className="mb-2 text-xl font-medium">
        {t("admin.service_connections.title")}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("admin.service_connections.description")}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ConnectionStatus
          label={t("admin.service_connections.search_engine")}
          configured={connections.searchEngine.configured}
          connected={connections.searchEngine.connected}
          pluginName={connections.searchEngine.pluginName}
          error={connections.searchEngine.error}
        />
        <ConnectionStatus
          label={t("admin.service_connections.browser")}
          configured={connections.browser.configured}
          connected={connections.browser.connected}
          pluginName={connections.browser.pluginName}
          error={connections.browser.error}
        />
        <ConnectionStatus
          label={t("admin.service_connections.queue_system")}
          configured={connections.queue.configured}
          connected={connections.queue.connected}
          pluginName={connections.queue.pluginName}
          error={connections.queue.error}
        />
        <ConnectionStatus
          label={t("admin.service_connections.vector_store")}
          configured={connections.vectorStore.configured}
          connected={connections.vectorStore.connected}
          pluginName={connections.vectorStore.pluginName}
          error={connections.vectorStore.error}
        />
      </div>
    </AdminCard>
  );
}
