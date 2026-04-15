import { NextResponse } from "next/server";
import { availableModels } from "@/src/shared";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ models: availableModels() });
}
