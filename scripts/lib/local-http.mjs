// Next reconstructs request.url using its internal localhost hostname. Compare
// the browser Origin with the actual incoming Host, not that reconstructed URL.
export function isSameLocalOrigin(request) {
  // Cross-site GET resources may omit Origin; never let them trigger local inference.
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Local CLI requests do not send a browser Origin.
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const expected = new URL(`http://${host}`);
    return ["127.0.0.1", "localhost", "[::1]"].includes(expected.hostname)
      && !expected.username && !expected.password && expected.pathname === "/" && !expected.search && !expected.hash
      && origin === expected.origin;
  } catch { return false; }
}
