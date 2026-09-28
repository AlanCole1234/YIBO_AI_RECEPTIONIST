/** Hosts the dashboard; all business logic and authentication stay in Fastify. */
export interface DashboardEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_ORIGIN?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
};

function failure(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateHeaders });
}

function apiOrigin(value: string | undefined, publicOrigin: string): URL | undefined {
  try {
    if (!value) return undefined;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash || url.origin === publicOrigin) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export default {
  async fetch(request: Request, env: DashboardEnvironment): Promise<Response> {
    const incoming = new URL(request.url);
    if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const target = apiOrigin(env.API_ORIGIN, incoming.origin);
    const accessId = env.CF_ACCESS_CLIENT_ID;
    const accessSecret = env.CF_ACCESS_CLIENT_SECRET;
    if (!target || Boolean(accessId) !== Boolean(accessSecret)) {
      return failure(503, "API_PROXY_NOT_CONFIGURED");
    }
    // The local Voice Lab/ARI/RTP services are deliberately not public endpoints.
    if (request.headers.has("Upgrade")) {
      return failure(400, "HTTP_API_ONLY");
    }

    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const upstreamRequest = new Request(target, request);
    upstreamRequest.headers.delete("Host");
    // Access protects the origin transport; it never replaces YIBO session auth.
    for (const header of ["CF-Access-Client-Id", "CF-Access-Client-Secret", "CF-Access-Jwt-Assertion"]) {
      upstreamRequest.headers.delete(header);
    }
    if (accessId && accessSecret) {
      upstreamRequest.headers.set("CF-Access-Client-Id", accessId);
      upstreamRequest.headers.set("CF-Access-Client-Secret", accessSecret);
    }

    try {
      // Preserve Origin, cookies, tenant checks, If-Match and the body unchanged.
      // Never retry a write or follow a redirect with credentials attached.
      const upstream = await fetch(upstreamRequest, { redirect: "manual", cache: "no-store" });
      const headers = new Headers(upstream.headers);
      for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch {
      // Do not expose origin addresses, provider failures or credentials in errors.
      return failure(502, "API_ORIGIN_UNAVAILABLE");
    }
  },
};
