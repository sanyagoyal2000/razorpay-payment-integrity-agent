"use client";

import { Alert, Box, useToast } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { systemStatus } from "@/services/views/systemStatus";
import { useModel } from "@/ui/data/useModel";
import { BASE_PATH } from "./nav";

/** Degraded-dependency notices shown above every admin page. */
export function SystemStatusBanner() {
  const router = useRouter();
  const toast = useToast();
  const state = useModel((services, asOf) => systemStatus(services.repos, asOf));
  if (state.status !== "ready" || state.model.length === 0) return null;
  return (
    <div role="status" aria-live="polite">
    <Box display="flex" flexDirection="column" gap="spacing.3" marginBottom="spacing.6">
      {state.model.map((notice) => (
        <Alert
          key={notice.id}
          color={notice.severity}
          title={notice.title}
          description={notice.description}
          isDismissible={false}
          isFullWidth
          {...(notice.id === "stale"
            ? {
                actions: {
                  primary: {
                    text: "Refresh data",
                    onClick: () => {
                      const ok = state.services.store.sync(new Date());
                      toast.show(ok ? { color: "positive", content: "Data refreshed." } : { color: "negative", content: "Refresh failed: the data feed is unavailable." });
                    },
                  },
                },
              }
            : notice.id === "automation_paused"
              ? { actions: { primary: { text: "Open Automations", onClick: () => router.push(`${BASE_PATH}/automations`) } } }
              : {})}
        />
      ))}
    </Box>
    </div>
  );
}
