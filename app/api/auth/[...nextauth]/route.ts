import { NextResponse } from "next/server";

// Auth disabled — return explicit 404 JSON
export function GET() {
  return NextResponse.json({ error: "Auth disabled" }, { status: 404 });
}
export function POST() {
  return NextResponse.json({ error: "Auth disabled" }, { status: 404 });
}
