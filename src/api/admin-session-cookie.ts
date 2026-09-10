import type { FastifyRequest } from "fastify";

const COOKIE_NAME = "yibo_admin_session";

export const adminSessionToken = (request: FastifyRequest): string | undefined => {
  const cookie = request.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(value.join("="));
  }
  return undefined;
};

export const adminSessionCookie = (value: string, request: FastifyRequest, maxAge: number): string => {
  const secure = request.protocol === "https" || process.env.NODE_ENV === "production";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
};
