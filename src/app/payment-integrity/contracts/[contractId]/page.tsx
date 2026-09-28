import { ContractEditorPage } from "@/ui/contracts/ContractEditorPage";

export default function Page({ params }: { params: { contractId: string } }) {
  return <ContractEditorPage contractId={decodeURIComponent(params.contractId)} />;
}
