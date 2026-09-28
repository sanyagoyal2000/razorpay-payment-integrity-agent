import { Suspense } from "react";
import { CasesPage } from "@/ui/cases/CasesPage";
import { PageSkeleton } from "@/ui/components/states";

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton rows={1} />}>
      <CasesPage />
    </Suspense>
  );
}
