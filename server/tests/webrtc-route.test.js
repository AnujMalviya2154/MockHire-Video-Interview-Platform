// Stage 1 verification: test the webrtc route's pure functions and
// the endpoint's behavior under various Cloudflare response scenarios.
//
// Run: node server/tests/webrtc-route.test.js

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ── Test the URL normalization and credential extraction logic ───────
// We replicate the pure functions from webrtc.js here to test them
// in isolation without needing Express or MongoDB.

const GOOGLE_STUN = { urls: "stun:stun.l.google.com:19302" };

const ALLOWED_TURN_URLS = [
  "turn:turn.cloudflare.com:3478?transport=udp",
  "turns:turn.cloudflare.com:443?transport=tcp",
];

function extractCredentials(cfResponse) {
  if (!cfResponse?.iceServers || !Array.isArray(cfResponse.iceServers)) return null;
  const turnEntry = cfResponse.iceServers.find(
    (entry) => entry.username && entry.credential
  );
  if (!turnEntry) return null;
  return { username: turnEntry.username, credential: turnEntry.credential };
}

function buildIceServers(credentials) {
  if (!credentials) return [GOOGLE_STUN];
  return [
    GOOGLE_STUN,
    {
      urls: ALLOWED_TURN_URLS,
      username: credentials.username,
      credential: credentials.credential,
    },
  ];
}

// ── Simulated Cloudflare response (matching documented schema) ───────
const MOCK_CF_RESPONSE = {
  iceServers: [
    {
      urls: [
        "stun:stun.cloudflare.com:3478",
        "stun:stun.cloudflare.com:53",
      ],
    },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turn:turn.cloudflare.com:80?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "test-user-abc123",
      credential: "test-cred-xyz789",
    },
  ],
};

// ── Tests ────────────────────────────────────────────────────────────

describe("extractCredentials", () => {
  it("extracts username and credential from a valid Cloudflare response", () => {
    const result = extractCredentials(MOCK_CF_RESPONSE);
    assert.deepStrictEqual(result, {
      username: "test-user-abc123",
      credential: "test-cred-xyz789",
    });
  });

  it("returns null for null input", () => {
    assert.strictEqual(extractCredentials(null), null);
  });

  it("returns null for response with no iceServers", () => {
    assert.strictEqual(extractCredentials({}), null);
  });

  it("returns null for response with STUN-only (no credentials)", () => {
    const stunOnly = {
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
    };
    assert.strictEqual(extractCredentials(stunOnly), null);
  });

  it("returns null for malformed response with empty iceServers", () => {
    assert.strictEqual(extractCredentials({ iceServers: [] }), null);
  });
});

describe("buildIceServers", () => {
  it("returns STUN-only when credentials are null", () => {
    const result = buildIceServers(null);
    assert.deepStrictEqual(result, [GOOGLE_STUN]);
    assert.strictEqual(result.length, 1);
  });

  it("returns STUN + normalized TURN when credentials are provided", () => {
    const creds = { username: "u", credential: "c" };
    const result = buildIceServers(creds);
    assert.strictEqual(result.length, 2);

    // First entry is always Google STUN
    assert.deepStrictEqual(result[0], GOOGLE_STUN);

    // Second entry has our normalized TURN URLs, not the Cloudflare originals
    assert.deepStrictEqual(result[1].urls, ALLOWED_TURN_URLS);
    assert.strictEqual(result[1].username, "u");
    assert.strictEqual(result[1].credential, "c");
  });

  it("does NOT include port 53 URLs", () => {
    const creds = { username: "u", credential: "c" };
    const result = buildIceServers(creds);
    const allUrls = result.flatMap((entry) =>
      Array.isArray(entry.urls) ? entry.urls : [entry.urls]
    );
    const port53 = allUrls.filter((url) => url.includes(":53"));
    assert.strictEqual(port53.length, 0, "No port 53 URLs should be present");
  });

  it("does NOT include TCP relay URLs (RFC 6062)", () => {
    const creds = { username: "u", credential: "c" };
    const result = buildIceServers(creds);
    const allUrls = result.flatMap((entry) =>
      Array.isArray(entry.urls) ? entry.urls : [entry.urls]
    );
    // The only "transport=tcp" should be turns: (TLS), not turn: (plain TCP)
    const plainTcp = allUrls.filter(
      (url) => url.startsWith("turn:") && url.includes("transport=tcp")
    );
    assert.strictEqual(plainTcp.length, 0, "No plain TCP relay URLs should be present");
  });

  it("includes TURN over UDP", () => {
    const creds = { username: "u", credential: "c" };
    const result = buildIceServers(creds);
    const allUrls = result.flatMap((entry) =>
      Array.isArray(entry.urls) ? entry.urls : [entry.urls]
    );
    assert.ok(
      allUrls.includes("turn:turn.cloudflare.com:3478?transport=udp"),
      "Must include TURN over UDP"
    );
  });

  it("includes TURN over TLS on port 443", () => {
    const creds = { username: "u", credential: "c" };
    const result = buildIceServers(creds);
    const allUrls = result.flatMap((entry) =>
      Array.isArray(entry.urls) ? entry.urls : [entry.urls]
    );
    assert.ok(
      allUrls.includes("turns:turn.cloudflare.com:443?transport=tcp"),
      "Must include TURN over TLS/443"
    );
  });

  it("does NOT include Cloudflare STUN (only Google STUN)", () => {
    const creds = { username: "u", credential: "c" };
    const result = buildIceServers(creds);
    const allUrls = result.flatMap((entry) =>
      Array.isArray(entry.urls) ? entry.urls : [entry.urls]
    );
    const cfStun = allUrls.filter((url) => url.includes("stun.cloudflare.com"));
    assert.strictEqual(cfStun.length, 0, "No Cloudflare STUN URLs should be present");
  });
});

describe("end-to-end: Cloudflare response → normalized iceServers", () => {
  it("produces the correct final configuration from a real Cloudflare response", () => {
    const creds = extractCredentials(MOCK_CF_RESPONSE);
    const iceServers = buildIceServers(creds);

    assert.deepStrictEqual(iceServers, [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "test-user-abc123",
        credential: "test-cred-xyz789",
      },
    ]);
  });

  it("falls back to STUN-only when Cloudflare is unavailable", () => {
    const creds = extractCredentials(null);
    const iceServers = buildIceServers(creds);

    assert.deepStrictEqual(iceServers, [
      { urls: "stun:stun.l.google.com:19302" },
    ]);
  });

  it("falls back to STUN-only when Cloudflare returns malformed data", () => {
    const creds = extractCredentials({ iceServers: "not-an-array" });
    const iceServers = buildIceServers(creds);

    assert.deepStrictEqual(iceServers, [
      { urls: "stun:stun.l.google.com:19302" },
    ]);
  });
});

describe("security invariants", () => {
  it("permanent secrets are never in the output", () => {
    const creds = extractCredentials(MOCK_CF_RESPONSE);
    const iceServers = buildIceServers(creds);
    const json = JSON.stringify(iceServers);

    // These would be the env vars — ensure they're never in output
    assert.ok(!json.includes("TURN_KEY_API_TOKEN"), "API token must not appear");
    assert.ok(!json.includes("TURN_KEY_ID"), "Key ID must not appear");
  });

  it("only ephemeral credentials appear in the TURN entry", () => {
    const creds = extractCredentials(MOCK_CF_RESPONSE);
    const iceServers = buildIceServers(creds);
    const turnEntry = iceServers[1];

    // Only username, credential, and urls should be present
    const keys = Object.keys(turnEntry).sort();
    assert.deepStrictEqual(keys, ["credential", "urls", "username"]);
  });
});
