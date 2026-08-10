import type { ExpoPushMessage } from "expo-server-sdk";
import { describe, expect, it } from "vitest";
import {
  APNS_PAYLOAD_BYTE_LIMIT,
  EXPO_MESSAGE_BYTE_BUDGET,
  fitPushMessage,
  PUSH_FIELD_DROP_ORDER,
  truncatePushText,
} from "./push-preview";

function messageBytes(message: ExpoPushMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function data(message: ExpoPushMessage): Record<string, unknown> {
  return (message.data ?? {}) as Record<string, unknown>;
}

/** Deterministic pseudo-random generator so failures reproduce exactly. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLYPHS = ["a", "Z", "9", " ", "é", "ß", "気", "配", "🚀", "🔥", "👩‍👩‍👧‍👦", "\n", '"', "\\"];

function randomText(random: () => number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += GLYPHS[Math.floor(random() * GLYPHS.length)];
  }
  return text;
}

/** Longest values the public schemas accept: 2,048-char URLs, 80-char titles. */
const MAX_URL = `https://example.com/${"u".repeat(2_028)}`;
const MAX_IMAGE_URL = `https://example.com/${"i".repeat(2_024)}.png`;
const MAX_EMOJI_TITLE = "🚀".repeat(40);

interface OrdinaryOptions {
  title?: string;
  imageUrl?: string;
  url?: string;
  projectId?: string;
}

/** Mirrors buildPushMessages: image duplicated in richContent + data.avatarUrl. */
function ordinaryMessage(body: string, options: OrdinaryOptions = {}): ExpoPushMessage {
  const title = options.title ?? "Acme CRM";
  return {
    to: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    title,
    body,
    priority: "high",
    mutableContent: true,
    ...(options.imageUrl ? { richContent: { image: options.imageUrl } } : {}),
    data: {
      v: 1,
      eventId: "evt_0123456789abcdef",
      serviceId: "svc_0123456789abcdef",
      sourceId: "svc_0123456789abcdef",
      sourceName: title,
      ...(options.imageUrl ? { avatarUrl: options.imageUrl } : {}),
      ...(options.url ? { url: options.url } : {}),
      conversationId: "hark-svc_0123456789abcdef",
      ...(options.projectId ? { projectId: options.projectId } : {}),
    },
  };
}

/** Mirrors buildInteractionPushMessages with every optional field present. */
function interactionMessage(prompt: string, options: OrdinaryOptions = {}): ExpoPushMessage {
  const title = options.title ?? "Release";
  return {
    to: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    title,
    body: prompt,
    categoryId: "HARK_APPROVAL_V1",
    priority: "high",
    mutableContent: true,
    ...(options.imageUrl ? { richContent: { image: options.imageUrl } } : {}),
    data: {
      v: 1,
      interactionId: "int_0123456789abcdef",
      eventId: "evt_0123456789abcdef",
      interactionKind: "approval",
      sourceName: title,
      conversationId: "hark-interaction-int_0123456789abcdef",
      categoryId: "HARK_APPROVAL_V1",
      actionDigest: "a".repeat(64),
      responseToken: "r".repeat(43),
      ...(options.imageUrl ? { avatarUrl: options.imageUrl } : {}),
      ...(options.url ? { url: options.url } : {}),
    },
  };
}

const maxedOptions: OrdinaryOptions = {
  title: MAX_EMOJI_TITLE,
  imageUrl: MAX_IMAGE_URL,
  url: MAX_URL,
  projectId: "prj_0123456789abcdef",
};

/** Compatibility-critical keys that must survive fitting bit-for-bit. */
const CRITICAL_DATA_KEYS = [
  "v",
  "eventId",
  "serviceId",
  "sourceId",
  "sourceName",
  "conversationId",
  "projectId",
  "interactionId",
  "interactionKind",
  "categoryId",
  "actionDigest",
  "responseToken",
  "command",
] as const;

function expectCriticalFieldsPreserved(fitted: ExpoPushMessage, original: ExpoPushMessage): void {
  expect(fitted.to).toEqual(original.to);
  expect(fitted.title).toBe(original.title);
  expect(fitted.priority).toBe(original.priority);
  expect(fitted.mutableContent).toBe(original.mutableContent);
  expect(fitted.categoryId).toBe(original.categoryId);
  for (const key of CRITICAL_DATA_KEYS) {
    expect(data(fitted)[key], key).toEqual(data(original)[key]);
  }
}

/** The documented ladder: url outlives avatarUrl, which outlives richContent. */
function expectDropOrderRespected(fitted: ExpoPushMessage, original: ExpoPushMessage): void {
  const originalData = data(original);
  const fittedData = data(fitted);
  if (originalData.url !== undefined && fittedData.url === undefined) {
    expect(fittedData.avatarUrl).toBeUndefined();
    expect(fitted.richContent).toBeUndefined();
  }
  if (originalData.avatarUrl !== undefined && fittedData.avatarUrl === undefined) {
    expect(fitted.richContent).toBeUndefined();
  }
  // Fields are only ever dropped, never invented or replaced.
  if (fittedData.url !== undefined) expect(fittedData.url).toEqual(originalData.url);
  if (fittedData.avatarUrl !== undefined) {
    expect(fittedData.avatarUrl).toEqual(originalData.avatarUrl);
  }
  if (fitted.richContent !== undefined) expect(fitted.richContent).toEqual(original.richContent);
}

function expectBodyIsPrefix(fitted: ExpoPushMessage, original: ExpoPushMessage): void {
  if (typeof fitted.body === "string" && typeof original.body === "string") {
    expect(
      fitted.body === original.body || original.body.startsWith(fitted.body.replace(/…$/, "")),
    ).toBe(true);
  }
}

describe("truncatePushText", () => {
  it("returns short text unchanged", () => {
    expect(truncatePushText("Deploy finished", 1_000)).toBe("Deploy finished");
  });

  it("appends an ellipsis and never exceeds the JSON byte budget", () => {
    const random = mulberry32(42);
    for (let round = 0; round < 200; round += 1) {
      const text = randomText(random, Math.floor(random() * 400));
      const budget = Math.floor(random() * 96);
      const cut = truncatePushText(text, budget);
      expect(Buffer.byteLength(JSON.stringify(cut), "utf8") - 2).toBeLessThanOrEqual(
        Math.max(budget, 0),
      );
      if (cut !== text && cut.length > 0) expect(cut.endsWith("…")).toBe(true);
      expect(cut.includes("\uFFFD")).toBe(false);
    }
  });

  it("never splits an emoji grapheme", () => {
    const family = "👩‍👩‍👧‍👦";
    for (let budget = 1; budget < 26; budget += 1) {
      const cut = truncatePushText(family.repeat(4), budget);
      const withoutEllipsis = cut.endsWith("…") ? cut.slice(0, -1) : cut;
      expect(withoutEllipsis.length % family.length).toBe(0);
    }
  });
});

describe("fitPushMessage", () => {
  it("documents the optional-field priority order", () => {
    expect(PUSH_FIELD_DROP_ORDER).toEqual(["richContent", "avatarUrl", "url"]);
  });

  it("returns short ordinary and interaction messages unchanged, by reference", () => {
    for (const message of [
      ordinaryMessage("Build 48 passed"),
      interactionMessage("Deploy production?"),
      ordinaryMessage("x".repeat(1_800)),
    ]) {
      expect(fitPushMessage(message)).toBe(message);
    }
  });

  it("bounds ordinary and interaction pushes with max URLs, emoji, and metadata", () => {
    // The review scenario: max imageUrl duplicated in richContent and
    // data.avatarUrl plus a max url serializes near 6.4 KB unfitted.
    for (const message of [
      ordinaryMessage("🚀 deploy finished 気配り".repeat(30), maxedOptions),
      ordinaryMessage("short", maxedOptions),
      interactionMessage("🚀 approve the deploy? 気配り".repeat(20), maxedOptions),
      interactionMessage("?", maxedOptions),
    ]) {
      expect(messageBytes(message)).toBeGreaterThan(EXPO_MESSAGE_BYTE_BUDGET);
      const fitted = fitPushMessage(message);
      expect(messageBytes(fitted)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
      expect(messageBytes(fitted)).toBeLessThanOrEqual(APNS_PAYLOAD_BYTE_LIMIT);
      expectCriticalFieldsPreserved(fitted, message);
      expectDropOrderRespected(fitted, message);
      expectBodyIsPrefix(fitted, message);
      // The tap destination survives every schema-valid combination; only
      // the duplicated image metadata is sacrificed.
      expect(data(fitted).url).toBe(MAX_URL);
    }
  });

  it("drops richContent before avatarUrl, and keeps both when the body alone overflows", () => {
    // Body alone overflows: everything but the body is preserved.
    const bodyOnly = fitPushMessage(
      ordinaryMessage("気配り🚀".repeat(1_500), { imageUrl: "https://example.com/a.png" }),
    );
    expect(bodyOnly.richContent).toEqual({ image: "https://example.com/a.png" });
    expect(data(bodyOnly).avatarUrl).toBe("https://example.com/a.png");
    expect(bodyOnly.body?.endsWith("…")).toBe(true);

    // Removing just the attachment duplication suffices: avatarUrl stays.
    const withHeadroom = fitPushMessage(
      ordinaryMessage("body", { imageUrl: `https://example.com/${"i".repeat(1_500)}.png` }),
      3_328 - 1_400,
    );
    expect(withHeadroom.richContent).toBeUndefined();
    expect(data(withHeadroom).avatarUrl).toBe(`https://example.com/${"i".repeat(1_500)}.png`);

    // Both image copies must go: the tap destination still survives.
    const bothDropped = fitPushMessage(ordinaryMessage("body ".repeat(400), maxedOptions));
    expect(bothDropped.richContent).toBeUndefined();
    expect(data(bothDropped).avatarUrl).toBeUndefined();
    expect(data(bothDropped).url).toBe(MAX_URL);
    expect(messageBytes(bothDropped)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
  });

  it("gives the body every byte left after the cheapest sufficient degradation", () => {
    const fitted = fitPushMessage(ordinaryMessage("b".repeat(4_000), maxedOptions));
    // After dropping both image copies roughly 500+ bytes remain for text,
    // so the preview is never silently emptied when space exists.
    expect((fitted.body ?? "").length).toBeGreaterThan(200);
    expect(messageBytes(fitted)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
  });

  it("drops the tap destination only as a last resort, staying bounded", () => {
    // Beyond-schema input: a token and URLs far past every documented limit.
    const absurd: ExpoPushMessage = {
      ...ordinaryMessage("body", {
        title: "\ud83d".repeat(80), // lone surrogates escape to 6 bytes each
        imageUrl: `https://example.com/${"i".repeat(4_000)}`,
        url: `https://example.com/${"u".repeat(4_000)}`,
      }),
      to: `ExponentPushToken[${"x".repeat(380)}]`,
    };
    const fitted = fitPushMessage(absurd);
    expect(messageBytes(fitted)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
    expect(fitted.richContent).toBeUndefined();
    expect(data(fitted).avatarUrl).toBeUndefined();
    expect(data(fitted).url).toBeUndefined();
    expectCriticalFieldsPreserved(fitted, absurd);
  });

  it("property: every random valid combination fits and respects the ladder", () => {
    const random = mulberry32(7);
    for (let round = 0; round < 200; round += 1) {
      const body = randomText(random, Math.floor(random() * 3_000));
      const urlLength = Math.floor(random() * 2_028);
      const options: OrdinaryOptions = {
        title: randomText(random, 1 + Math.floor(random() * 40)) || "T",
        ...(round % 3 === 0
          ? {}
          : { imageUrl: `https://example.com/${"i".repeat(urlLength)}.png` }),
        ...(round % 4 === 0 ? {} : { url: `https://example.com/${"u".repeat(urlLength)}` }),
        ...(round % 2 === 0 ? { projectId: "prj_0123456789abcdef" } : {}),
      };
      for (const message of [
        ordinaryMessage(body, options),
        interactionMessage(body || "?", options),
      ]) {
        const fitted = fitPushMessage(message);
        expect(messageBytes(fitted)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
        expect(messageBytes(fitted)).toBeLessThanOrEqual(APNS_PAYLOAD_BYTE_LIMIT);
        expectCriticalFieldsPreserved(fitted, message);
        expectDropOrderRespected(fitted, message);
        expectBodyIsPrefix(fitted, message);
        // Schema-valid URLs (≤2,048 ASCII chars) always keep the destination.
        expect(data(fitted).url).toEqual(data(message).url);
      }
    }
  });

  it("boundary: exact-budget messages pass through untouched", () => {
    const base = ordinaryMessage("", { imageUrl: "https://example.com/a.png" });
    const padding = EXPO_MESSAGE_BYTE_BUDGET - messageBytes(base);
    const exact = ordinaryMessage("x".repeat(padding), { imageUrl: "https://example.com/a.png" });
    expect(messageBytes(exact)).toBe(EXPO_MESSAGE_BYTE_BUDGET);
    expect(fitPushMessage(exact)).toBe(exact);

    const oneOver = ordinaryMessage("x".repeat(padding + 1), {
      imageUrl: "https://example.com/a.png",
    });
    const fitted = fitPushMessage(oneOver);
    expect(fitted).not.toBe(oneOver);
    expect(messageBytes(fitted)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
    expect(fitted.richContent).toEqual({ image: "https://example.com/a.png" });
  });

  it("bounds an 8,000-character emoji body under long URLs", () => {
    const message = ordinaryMessage("🚀".repeat(4_000), {
      imageUrl: `https://example.com/${"i".repeat(900)}.png`,
      url: `https://example.com/${"u".repeat(900)}`,
    });
    const fitted = fitPushMessage(message);
    expect(messageBytes(fitted)).toBeLessThanOrEqual(EXPO_MESSAGE_BYTE_BUDGET);
    expect(fitted.body?.length ?? 0).toBeLessThan(4_000);
    expect(data(fitted).url).toBe(`https://example.com/${"u".repeat(900)}`);
  });

  it("keeps a maximal plain-text body intact when it fits the budget", () => {
    const body = "b".repeat(2_000);
    const fitted = fitPushMessage(ordinaryMessage(body));
    expect(fitted.body).toBe(body);
  });

  it("leaves messages without a body untouched", () => {
    const withdrawal = {
      to: "ExponentPushToken[a]",
      data: { v: 1, command: "notification.withdraw", eventId: "evt_1" },
      _contentAvailable: true,
    } as ExpoPushMessage;
    expect(fitPushMessage(withdrawal)).toBe(withdrawal);
  });
});
