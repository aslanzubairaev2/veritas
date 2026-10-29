import Assistant from "@/components/Assistant";
import { env } from "@/lib/env";
import { getTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default function Home() {
  const { company } = getTenant();
  return <Assistant company={company} demo={{ show: env.demoBanner(), author: env.demoAuthor() }} />;
}
