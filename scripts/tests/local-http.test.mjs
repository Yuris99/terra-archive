import test from "node:test";
import assert from "node:assert/strict";
import { isSameLocalOrigin } from "../lib/local-http.mjs";
function request(origin, host = "127.0.0.1:3010") {
  const headers = new Headers({ host });
  if (origin !== undefined) headers.set("origin", origin);
  return { url: "http://localhost:3010/api/archive/answer", headers };
}
test("incoming loopback host is used despite Next internal localhost URL", () => {
  assert.equal(isSameLocalOrigin(request("http://127.0.0.1:3010")), true);
});
test("localhost and IPv6 work when the browser uses the same host", () => {
  assert.equal(isSameLocalOrigin(request("http://localhost:3010", "localhost:3010")), true);
  assert.equal(isSameLocalOrigin(request("http://[::1]:3010", "[::1]:3010")), true);
});
test("external, opaque, and different-port browser origins remain blocked", () => {
  for (const origin of ["https://example.com", "null", "http://127.0.0.1:3000", "http://localhost:3010"]) {
    assert.equal(isSameLocalOrigin(request(origin)), false);
  }
});
test("forged nonlocal and malformed host headers do not allow external origins", () => {
  assert.equal(isSameLocalOrigin(request("http://example.com", "example.com")), false);
  assert.equal(isSameLocalOrigin(request("http://127.0.0.1:3010", "127.0.0.1:3010@evil.com")), false);
});
test("local CLI requests without browser Origin continue to work", () => {
  assert.equal(isSameLocalOrigin(request(undefined)), true);
});
test("cross-site browser GETs are rejected even when Origin is absent", () => {
  const input = request(undefined); input.headers.set("sec-fetch-site", "cross-site");
  assert.equal(isSameLocalOrigin(input), false);
  input.headers.set("sec-fetch-site", "same-origin");
  assert.equal(isSameLocalOrigin(input), true);
});
