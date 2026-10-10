# Telegram setup

Two chats receive messages from one bot:

| Variable | Chat | Receives |
|---|---|---|
| `TELEGRAM_CHAT_ID` | Designers' group | Green and Amber leads (labelled with their tier), existing-client callback requests, dropped calls with a number, calls the voice agent did not rate, and the 09:00 IST digest |
| `TELEGRAM_ESCALATION_CHAT_ID` | Founder chat | Complaints (escalations) and price leaks. If this is not set, they fall back to the designers' group and say so |

Red leads send no message. Test calls never send one.

## 1. Create the bot (about 2 minutes)

1. In Telegram, open **@BotFather** and send `/newbot`.
2. Give it a name (for example "Aangan Studio alerts") and a username ending in `bot`.
3. BotFather replies with a token like `123456:ABC…`. **Keep it secret.** Do not paste it into chat with me or any website; put it only in `.env.local` as `TELEGRAM_BOT_TOKEN=…`, and later in Vercel.

## 2. Create the two chats

1. Create a group "Aangan designers" and add every designer and the bot.
2. For the founder, either create a second group with just Nikhil and the bot, or use a private chat: open the bot, press **Start**, and send it any message.
3. In **each group**, send `/start@YourBotUsername` (the bot's privacy mode hides ordinary messages, but it does see commands addressed to it).

## 3. Find the chat IDs

```bash
pnpm telegram:chats
```

It lists the chats the bot has seen as `ID  type  title`, never printing the token. Group IDs are negative numbers (supergroups start `-100`). Put the designers' group in `TELEGRAM_CHAT_ID` and the founder chat in `TELEGRAM_ESCALATION_CHAT_ID`. If it shows nothing, send `/start@YourBotUsername` in the group again and rerun it (updates are kept for 24 hours).

## 4. Check it

```bash
pnpm telegram:chats --send-test
```

sends one short test message to each configured chat. Then add the three variables in Vercel (Settings → Environment Variables, Production) and redeploy.

## Notes

- If a group is upgraded to a supergroup, its ID changes and sends fail with an error naming the new ID; update the variable.
- Telegram allows about 20 messages a minute per group; alerts retry 3 times with backoff and honour its "retry after".
- A redial within 24 hours edits the first alert instead of adding a second one.
