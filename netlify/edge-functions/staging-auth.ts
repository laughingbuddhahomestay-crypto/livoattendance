/**
 * Staging Password Protection Middleware
 * Runs at the Netlify Edge CDN across all routes (/*):
 * - Blocks unauthenticated visitors before pages, assets, or API functions are served.
 * - Works on ALL Netlify plans including free Starter tier without incurring fees.
 * - Passes through transparently if STAGING_PASSWORD is not set (e.g. in production).
 */

interface EdgeContext {
  next: () => Promise<Response>;
}

declare const Netlify: {
  env: {
    get: (key: string) => string | undefined;
  };
};

export default async (request: Request, context: EdgeContext) => {
  const stagingPass = Netlify.env.get("STAGING_PASSWORD");
  const stagingUser = Netlify.env.get("STAGING_USER") || "admin";

  // If no staging password is set, allow request through (production mode)
  if (!stagingPass) {
    return context.next();
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Basic (.+)$/);
    if (match) {
      try {
        const decoded = atob(match[1]);
        const separatorIdx = decoded.indexOf(":");
        if (separatorIdx !== -1) {
          const user = decoded.slice(0, separatorIdx);
          const pass = decoded.slice(separatorIdx + 1);

          if (user === stagingUser && pass === stagingPass) {
            return context.next();
          }
        }
      } catch {
        // Malformed base64, proceed to 401 prompt
      }
    }
  }

  return new Response("Access Denied: Livotel Staging Environment is Password-Protected.\n", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Livotel Staging Environment"',
      "Content-Type": "text/plain",
    },
  });
};
