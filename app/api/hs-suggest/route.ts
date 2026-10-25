import { z } from "zod";
import { aiConfigured, suggestHsCode } from "@/lib/ai";


const Body = z.object({ description: z.string().trim().min(1).max(500) });

/** AI HS-code suggestion for a blank code. Advice only — never applied automatically. */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
    if (!aiConfigured()) return Response.json({ suggestion: null, unavailable: true });
    return Response.json({ suggestion: await suggestHsCode(body.data.description) });
  } catch (e) {
    console.error("hs-suggest failed", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
