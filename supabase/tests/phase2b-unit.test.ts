/**
 * CreditVoice OS — Phase 2B unit tests.
 * Twilio signature validation, TwiML safety and DTMF amount precision.
 * No Twilio credentials and no telephone calls are required.
 */
import { describe, expect, test } from "bun:test";

import { parseDtmfAmount } from "../../src/lib/voice/money";
import {
  canonicalWebhookUrl,
  computeTwilioSignature,
  verifyTwilioSignature,
} from "../../src/lib/voice/twilio-signature.server";
import { TwiMLResponse, sayAndHangup } from "../../src/lib/voice/twiml/builder";

const TOKEN = "test_auth_token_value";
const URL_ = "https://example.test/api/public/voice/twilio?step=pin";
const PARAMS = { CallSid: "CA123", From: "+2348100000000", To: "+2349000000001", Digits: "1234" };

describe("Twilio signature", () => {
  test("a correctly signed request is accepted", async () => {
    const signature = await computeTwilioSignature(TOKEN, URL_, PARAMS);
    expect(await verifyTwilioSignature({ authToken: TOKEN, url: URL_, params: PARAMS, signature })).toBe(true);
  });

  test("an invalid signature is rejected", async () => {
    expect(
      await verifyTwilioSignature({ authToken: TOKEN, url: URL_, params: PARAMS, signature: "not-a-signature" }),
    ).toBe(false);
  });

  test("a missing signature is rejected", async () => {
    expect(await verifyTwilioSignature({ authToken: TOKEN, url: URL_, params: PARAMS, signature: null })).toBe(false);
  });

  test("a modified parameter invalidates the signature", async () => {
    const signature = await computeTwilioSignature(TOKEN, URL_, PARAMS);
    const tampered = { ...PARAMS, Digits: "9999" };
    expect(await verifyTwilioSignature({ authToken: TOKEN, url: URL_, params: tampered, signature })).toBe(false);
  });

  test("a modified URL invalidates the signature", async () => {
    const signature = await computeTwilioSignature(TOKEN, URL_, PARAMS);
    expect(
      await verifyTwilioSignature({
        authToken: TOKEN,
        url: "https://attacker.test/api/public/voice/twilio?step=pin",
        params: PARAMS,
        signature,
      }),
    ).toBe(false);
  });

  test("a wrong auth token invalidates the signature", async () => {
    const signature = await computeTwilioSignature(TOKEN, URL_, PARAMS);
    expect(await verifyTwilioSignature({ authToken: "other", url: URL_, params: PARAMS, signature })).toBe(false);
  });

  test("the canonical URL comes from configuration, not the request host", () => {
    const url = canonicalWebhookUrl(
      "https://voice.creditvoice.test",
      "http://127.0.0.1:8080/api/public/voice/twilio?step=menu",
    );
    expect(url).toBe("https://voice.creditvoice.test/api/public/voice/twilio?step=menu");
  });
});

describe("TwiML", () => {
  test("configured prompt text cannot inject markup", () => {
    const xml = new TwiMLResponse().say('</Say><Dial>+15550001111</Dial><Say>').toXml();
    expect(xml).not.toContain("<Dial>");
    expect(xml).toContain("&lt;Dial&gt;");
  });

  test("gather renders a POST action and digit limit", () => {
    const xml = new TwiMLResponse()
      .gather({ action: "/api/public/voice/twilio?step=pin", prompt: "PIN", numDigits: 4 })
      .toXml();
    expect(xml).toContain('input="dtmf"');
    expect(xml).toContain('numDigits="4"');
    expect(xml).toContain('method="POST"');
  });

  test("terminal responses hang up", () => {
    expect(sayAndHangup("Goodbye.")).toContain("<Hangup/>");
  });
});

describe("DTMF amounts (2 decimal places)", () => {
  const dp = 2;
  const cases: [string, string | null][] = [
    ["5000", "5000.00"],
    ["50*25", "50.25"],
    ["50*2", "50.20"],
    ["001000", "1000.00"],
    ["0*01", "0.01"],
    ["", null],
    ["0", null],
    ["0*00", null],
    ["12a4", null],
    ["12**4", null],
    ["-100", null],
    ["50*255", null],
  ];

  for (const [input, expected] of cases) {
    test(`"${input}" -> ${expected ?? "rejected"}`, () => {
      const result = parseDtmfAmount(input, dp);
      if (expected === null) {
        expect(result.ok).toBe(false);
      } else {
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.display).toBe(expected);
      }
    });
  }

  test("a very large amount is rejected rather than truncated", () => {
    expect(parseDtmfAmount("9".repeat(20), dp).ok).toBe(false);
  });

  test("precision is never silently rounded", () => {
    const result = parseDtmfAmount("10*999", dp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TOO_MANY_DECIMALS");
  });
});

describe("DTMF amounts (zero decimal currency)", () => {
  test("whole units only", () => {
    const result = parseDtmfAmount("1500", 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.display).toBe("1500");
      expect(result.value.minorUnits).toBe(1500n);
    }
  });

  test("a decimal part is rejected", () => {
    expect(parseDtmfAmount("15*5", 0).ok).toBe(false);
  });
});

describe("DTMF amounts (three decimal currency)", () => {
  test("three places are allowed", () => {
    const result = parseDtmfAmount("2*125", 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.minorUnits).toBe(2125n);
  });
});
