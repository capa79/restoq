// Next.js kaller onRequestError for feil på serveren (sider, server actions, API-ruter).
export async function register() {}

export async function onRequestError(err: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("./lib/error-log");
  const e = err as { message?: string; stack?: string; digest?: string };
  console.error("Serverfeil", request.method, request.path, e?.message);
  await logError({
    source: "server",
    message: `${request.method} ${context.routeType ?? ""}: ${e?.message ?? String(err)}`,
    stack: e?.stack,
    path: request.path,
    digest: e?.digest,
    userAgent: String(request.headers["user-agent"] ?? ""),
  });
}
