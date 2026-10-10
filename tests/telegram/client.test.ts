import { describe, expect, it } from "vitest";
import { editMessage, escapeHtml, sendMessage, TelegramError, type TelegramConfig } from "@/lib/telegram/client";

const TOKEN = "123456:SECRET-bot-token";

function scripted(responses: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return responses[Math.min(i++, responses.length - 1)]();
  }) as typeof fetch;
  const sleeps: number[] = [];
  const cfg: TelegramConfig = { botToken: TOKEN, fetchImpl, sleep: async (ms) => void sleeps.push(ms) };
  return { cfg, calls, sleeps };
}
const ok = (messageId = 7, chatId = -1001) => () => Response.json({ ok: true, result: { message_id: messageId, chat: { id: chatId } } });
const fail = (code: number, description: string, parameters?: Record<string, unknown>) => () =>
  Response.json({ ok: false, error_code: code, description, ...(parameters ? { parameters } : {}) }, { status: code });

describe("escapeHtml", () => {
  it("escapes the three characters Telegram's HTML mode needs", () => {
    expect(escapeHtml(`a < b & c > d "q"`)).toBe(`a &lt; b &amp; c &gt; d "q"`);
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("sendMessage", () => {
  it("posts HTML text with previews off and a dashboard button", async () => {
    const t = scripted([ok(42, -1001)]);
    const r = await sendMessage(t.cfg, { chatId: "-1001", text: "<b>hi</b>", button: { text: "Open in dashboard", url: "https://x.example/dashboard/calls/abc" } });
    expect(r).toEqual({ chatId: "-1001", messageId: "42" });
    expect(t.calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(t.calls[0].body).toMatchObject({
      chat_id: "-1001",
      text: "<b>hi</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Open in dashboard", url: "https://x.example/dashboard/calls/abc" }]] },
    });
  });

  it("cuts text at the 4096-character limit", async () => {
    const t = scripted([ok()]);
    await sendMessage(t.cfg, { chatId: "1", text: "x".repeat(5000) });
    expect(String(t.calls[0].body.text)).toHaveLength(4096);
  });

  it("honours retry_after on a 429, then succeeds (3 attempts allowed)", async () => {
    const t = scripted([fail(429, "Too Many Requests: retry after 7", { retry_after: 7 }), ok(9)]);
    const r = await sendMessage(t.cfg, { chatId: "1", text: "x" });
    expect(r.messageId).toBe("9");
    expect(t.calls).toHaveLength(2);
    expect(t.sleeps[0]).toBeGreaterThanOrEqual(7000);
  });

  it("retries a 500 up to 3 times with backoff, then fails with a TelegramError", async () => {
    const t = scripted([fail(500, "Internal Server Error")]);
    await expect(sendMessage(t.cfg, { chatId: "1", text: "x" })).rejects.toBeInstanceOf(TelegramError);
    expect(t.calls).toHaveLength(3);
    expect(t.sleeps).toHaveLength(2);
    expect(t.sleeps[1]).toBeGreaterThan(t.sleeps[0] - 1);
  });

  it("does not retry a 400 (a bad request will not improve)", async () => {
    const t = scripted([fail(400, "Bad Request: chat not found")]);
    await expect(sendMessage(t.cfg, { chatId: "1", text: "x" })).rejects.toMatchObject({ status: 400 });
    expect(t.calls).toHaveLength(1);
  });

  it("never puts the bot token in an error", async () => {
    const t = scripted([fail(403, "Forbidden: bot was blocked")]);
    try {
      await sendMessage(t.cfg, { chatId: "1", text: "x" });
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("SECRET");
    }
  });
});

describe("editMessage", () => {
  it("edits by chat and message ID", async () => {
    const t = scripted([ok()]);
    await editMessage(t.cfg, { chatId: "-1001", messageId: "55", text: "new" });
    expect(t.calls[0].url).toMatch(/editMessageText$/);
    expect(t.calls[0].body).toMatchObject({ chat_id: "-1001", message_id: 55, text: "new", parse_mode: "HTML" });
  });

  it('treats "message is not modified" as success', async () => {
    const t = scripted([fail(400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same")]);
    await expect(editMessage(t.cfg, { chatId: "1", messageId: "5", text: "same" })).resolves.toEqual({ chatId: "1", messageId: "5" });
  });

  it("surfaces any other 400 so the caller can send a fresh message", async () => {
    const t = scripted([fail(400, "Bad Request: message to edit not found")]);
    await expect(editMessage(t.cfg, { chatId: "1", messageId: "5", text: "x" })).rejects.toMatchObject({ status: 400 });
  });
});
