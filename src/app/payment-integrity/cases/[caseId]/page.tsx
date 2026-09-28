import { CaseDetailPage } from "@/ui/cases/CaseDetailPage";

export default function Page({ params }: { params: { caseId: string } }) {
  return <CaseDetailPage caseId={decodeURIComponent(params.caseId)} />;
}
