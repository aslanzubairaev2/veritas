import type { Metadata } from "next";
import Crm from "@/components/Crm";
import { getTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `${getTenant().company.shortName} CRM`, robots: { index: false, follow: false } };
}

export default function CrmPage() {
  const { company } = getTenant();
  return <Crm companyName={company.name} />;
}
