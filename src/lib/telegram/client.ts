import { isTimeout, RetryError, withRetry } from "@/lib/http/retry";

/**
 * Telegram Bot API client (docs/PLATFORM_NOTES.md section 4, checked 2026-10-09 against
 * core.telegram.org/bots/api). POST https://api.telegram.org/bot<token>/<method>, JSON body,
 * response {ok, result} or {ok:false, error_code, description, parameters?}.
 * A 429 carries parameters.retry_after (seconds), which we honour. Up to 3 attempts with backoff.
 * The bot token is never logged and never part of an error message.
 */

export interface TelegramConfig {
  botToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface InlineButton {
  text: string;
  url: string;
}

export interface SendOptions {
  chatId: string;
  /** HTML (parse_mode HTML). Every caller-supplied string must go through escapeHtml first. */
  text: string;
  button?: InlineButton;
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterSec: number | null,
    readonly migrateToChatId: string | null = null,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

const MAX_TEXT = 4096;

/** Telegram HTML mode needs only these three escaped (docs: "HTML style"). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const retryable = (err: unknown) =>
  isTimeout(err) ||
  (err instanceof TelegramError && (err.status === null || err.status === 429 || err.status >= 500));

async function call<T>(cfg: TelegramConfig, method: string, body: Record<string, unknown>): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await (cfg.fetchImpl ?? fetch)(`${(cfg.baseUrl ?? "https://api.telegram.org").replace(/\/$/, "")}/bot${cfg.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (err) {
    if (isTimeout(err)) throw err;
    throw new TelegramError("Telegram unreachable", null, null);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  } | null;
  if (!res.ok || !json?.ok) {
    throw new TelegramError(
      `Telegram ${method} ${json?.error_code ?? res.status}: ${String(json?.description ?? "").slice(0, 120)}`,
      json?.error_code ?? res.status,
      json?.parameters?.retry_after ?? null,
      json?.parameters?.migrate_to_chat_id != null ? String(json.parameters.migrate_to_chat_id) : null,
    );
  }
  return json.result as T;
}

function payload(o: SendOptions): Record<string, unknown> {
  const text = o.text.length > MAX_TEXT ? `${o.text.slice(0, MAX_TEXT - 1)}…` : o.text;
  return {
    chat_id: o.chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(o.button ? { reply_markup: { inline_keyboard: [[{ text: o.button.text, url: o.button.url }]] } } : {}),
  };
}

/** Up to 3 attempts; surfaces the underlying TelegramError (not a RetryError wrapper). */
async function withTelegramRetry<T>(cfg: TelegramConfig, fn: () => Promise<T>): Promise<T> {
  try {
    const { value } = await withRetry(fn, {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      retryable,
      retryAfterMs: (err) => (err instanceof TelegramError && err.retryAfterSec ? err.retryAfterSec * 1000 : undefined),
      sleep: cfg.sleep,
    });
    return value;
  } catch (err) {
    throw err instanceof RetryError ? err.lastError : err;
  }
}

export interface SentMessage {
  chatId: string;
  messageId: string;
}

export async function sendMessage(cfg: TelegramConfig, o: SendOptions): Promise<SentMessage> {
  const msg = await withTelegramRetry(cfg, () => call<{ message_id: number; chat: { id: number } }>(cfg, "sendMessage", payload(o)));
  return { chatId: String(msg.chat?.id ?? o.chatId), messageId: String(msg.message_id) };
}

/** Edit the bot's earlier message. "message is not modified" counts as success. */
export async function editMessage(cfg: TelegramConfig, o: SendOptions & { messageId: string }): Promise<SentMessage> {
  const { messageId, ...rest } = o;
  const body = { ...payload(rest), message_id: Number(messageId) };
  try {
    await withTelegramRetry(cfg, () => call<unknown>(cfg, "editMessageText", body));
  } catch (err) {
    if (err instanceof TelegramError && err.status === 400 && /not modified/i.test(err.message)) return { chatId: o.chatId, messageId };
    throw err;
  }
  return { chatId: o.chatId, messageId };
}
