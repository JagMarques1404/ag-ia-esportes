import { NextResponse } from "next/server";

export interface OkBody<T> {
  ok: true;
  data: T;
  meta: Record<string, unknown>;
}

export interface ErrorBody {
  ok: false;
  error: string;
  details: Record<string, unknown>;
}

export function okResponse<T>(
  data: T,
  meta: Record<string, unknown> = {}
): NextResponse<OkBody<T>> {
  return NextResponse.json<OkBody<T>>(
    { ok: true, data, meta },
    { status: 200 }
  );
}

export function errorResponse(
  message: string,
  details: Record<string, unknown> = {},
  status = 400
): NextResponse<ErrorBody> {
  return NextResponse.json<ErrorBody>(
    { ok: false, error: message, details },
    { status }
  );
}
