import { IncidentWorkspacePage } from "@/ui/incidents/IncidentWorkspacePage";

export default function Page({ params }: { params: { incidentId: string } }) {
  return <IncidentWorkspacePage incidentId={decodeURIComponent(params.incidentId)} />;
}
