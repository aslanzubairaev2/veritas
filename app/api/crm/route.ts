import { crmConfigured, crmUpdate, snapshot } from "@/lib/crmdb";
import { isCrmAuthed } from "@/lib/crmauth";
import { errText } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isCrmAuthed(req))) return Response.json({ error: "auth" }, { status: 401 });
  if (!crmConfigured()) return Response.json({ error: "crm_not_configured" }, { status: 503 });
  try {
    return Response.json(await snapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("crm snapshot:", errText(e));
    return Response.json({ error: "db_error" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (!(await isCrmAuthed(req))) return Response.json({ error: "auth" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; id?: number; value?: string };
  if ((b.kind !== "lead_status" && b.kind !== "task_done") || typeof b.id !== "number") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    await crmUpdate(b.kind, b.id, String(b.value ?? ""));
    return Response.json({ ok: true });
  } catch (e) {
    console.error("crm update:", errText(e));
    return Response.json({ error: "db_error" }, { status: 502 });
  }
}
