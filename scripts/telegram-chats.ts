/**
 * pnpm telegram:chats [--env-file=.env.local] [--send-test]
 *
 * Lists the chats the bot has recently seen (getUpdates: only works while no webhook is set; updates
 * are kept 24 hours), so you can copy the group IDs into TELEGRAM_CHAT_ID and
 * TELEGRAM_ESCALATION_CHAT_ID. Prints chat IDs, types and titles, never the bot token.
 * --send-test sends one short test message to each configured chat (the only thing here that posts).
 * Before running it, send "/start@YourBotName" in each group (privacy mode hides ordinary messages).
 */
import { config } from "dotenv";
import { sendMessage } from "../src/lib/telegram/client";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const envFile = arg("env-file") ?? ".env.local";
config({ path: envFile, quiet: true });

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error(`TELEGRAM_BOT_TOKEN is not set in ${envFile}. Create the bot with @BotFather first, see docs/TELEGRAM_SETUP.md.`);
    process.exit(1);
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const body = (await res.json()) as { ok: boolean; description?: string; result?: Array<Record<string, { chat?: { id: number; type: string; title?: string; username?: string; first_name?: string } }>> };
  if (!body.ok) {
    console.error(`getUpdates failed: ${body.description ?? res.status}`);
    process.exit(1);
  }
  const chats = new Map<number, string>();
  for (const u of body.result ?? []) {
    const msg = u.message ?? u.channel_post ?? u.my_chat_member ?? u.edited_message;
    if (msg?.chat) chats.set(msg.chat.id, `${msg.chat.type}  ${msg.chat.title ?? msg.chat.username ?? msg.chat.first_name ?? ""}`.trim());
  }
  if (!chats.size) console.log("No chats yet. Add the bot to your group, send /start@YourBotName there, and run this again.");
  for (const [id, label] of chats) console.log(`${String(id).padStart(16)}  ${label}`);

  if (process.argv.includes("--send-test")) {
    for (const [name, chatId] of [["TELEGRAM_CHAT_ID", process.env.TELEGRAM_CHAT_ID], ["TELEGRAM_ESCALATION_CHAT_ID", process.env.TELEGRAM_ESCALATION_CHAT_ID]] as const) {
      if (!chatId) {
        console.log(`${name}: not set, skipped`);
        continue;
      }
      await sendMessage({ botToken: token }, { chatId, text: `Aangan voice agent: test message for ${name}. You can ignore this.` });
      console.log(`${name}: test message sent`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
