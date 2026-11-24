/** Compare the browser Origin with the actual incoming Host, rather than a
 * framework's internally reconstructed localhost URL behind its Node server. */
export function isSameOrigin(request: Request, secureHost = false): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const supplied = request.headers.get("origin");
  if (!supplied) return false;
  try {
    const origin = new URL(supplied), target = new URL(request.url);
    const host = (request.headers.get("host") || target.host).toLowerCase();
    const protocol = secureHost ? "https:" : target.protocol;
    return supplied === origin.origin && origin.host === host && origin.protocol === protocol;
  } catch { return false; }
}
