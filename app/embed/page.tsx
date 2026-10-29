import Assistant from "@/components/Assistant";
import { env } from "@/lib/env";
import { getTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Kompakte Ansicht für das Widget auf einer fremden Website (siehe public/widget.js)
export default function Embed() {
  const { company } = getTenant();
  return <Assistant company={company} demo={{ show: env.demoBanner(), author: env.demoAuthor() }} embedded />;
}
