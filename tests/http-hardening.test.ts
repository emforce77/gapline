import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import nextConfig from "../next.config";
import { requestOrigin, sameOrigin } from "../src/lib/store/access";

/** A POST as Cloud Run hands it to the app: Host is the service's, the proto is the front end's. */
function post(headers: Record<string, string>): Request {
  return new Request("http://localhost:8080/api/projects", {
    method: "POST",
    headers: { host: "gapline.example", "x-forwarded-proto": "https", ...headers },
  });
}

describe("which requests may change data", () => {
  it("accepts this site's own pages", () => {
    assert.equal(sameOrigin(post({ origin: "https://gapline.example" })), true);
    // Locally Next sets the proto to http and the port stays in Host.
    const local = new Request("http://localhost:22830/api/projects", {
      method: "POST",
      headers: {
        host: "localhost:22830",
        "x-forwarded-proto": "http",
        origin: "http://localhost:22830",
      },
    });
    assert.equal(sameOrigin(local), true);
  });

  it("ignores a client's X-Forwarded-Host, which Cloud Run passes through unchanged", () => {
    const forged = { "x-forwarded-host": "evil.example" };
    assert.equal(sameOrigin(post({ ...forged, origin: "https://evil.example" })), false);
    assert.equal(sameOrigin(post({ ...forged, origin: "https://gapline.example" })), true);
    assert.equal(requestOrigin(post(forged)), "https://gapline.example");
  });

  it("compares the whole origin: scheme, userinfo tricks and other hosts fail", () => {
    for (const origin of [
      "http://gapline.example",
      "https://evil.example@gapline.example",
      "https://gapline.example.evil.example",
      "https://evil.example",
      "null",
    ])
      assert.equal(sameOrigin(post({ origin })), false, origin);
    assert.equal(sameOrigin(post({})), false);
  });
});

describe("response headers", () => {
  it("never says what serves the site and sets the security headers on every path", async () => {
    assert.equal(nextConfig.poweredByHeader, false);
    const rules = await nextConfig.headers!();
    assert.deepEqual(
      rules.map((r) => r.source),
      ["/:path*"],
    );
    const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
    const csp = headers["Content-Security-Policy"];
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /default-src 'self'/);
    // Object URLs: the picked file's length check and the generated caption tracks.
    assert.match(csp, /media-src 'self' blob:/);
    assert.doesNotMatch(csp, /unsafe-eval/, "eval is for development only");
  });
});

describe("the home-screen icon", () => {
  it("answers at the legacy root paths with the same picture as the declared one", async () => {
    const declared = await readFile("src/app/apple-icon.png");
    for (const name of ["apple-touch-icon.png", "apple-touch-icon-precomposed.png"])
      assert.deepEqual(await readFile(`public/${name}`), declared, name);
  });
});
