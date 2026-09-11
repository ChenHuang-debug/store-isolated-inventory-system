import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.query("select 1");
    return NextResponse.json({
      status: "ok",
      service: "store-isolated-inventory-system",
      database: "connected",
      responseMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        service: "store-isolated-inventory-system",
        database: "unavailable",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
