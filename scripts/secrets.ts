/**
 * Secret handling without ever printing a secret.
 *
 *   pnpm secrets:rotate [--env-file=.env.main-branch.local] [--names=VAANI_TOOL_SECRET,VAANI_WEBHOOK_SECRET]
 *       Generates new random 64-character values and writes them into the env file. Prints only the names.
 *       Default names: VAANI_TOOL_SECRET, VAANI_WEBHOOK_SECRET, CRON_SECRET, SESSION_SECRET.
 *   pnpm secrets:copy NAME [--env-file=.env.main-branch.local]
 *       Copies one value to the clipboard (macOS pbcopy), so you can paste it into Vercel or Vaani.
 *       NAME can also be VAANI_WEBHOOK_URL, which builds the full webhook URL with its token.
 *
 * Rotation changes three places for the tool secret (the env file, Vercel, and the X-Tool-Secret header on
 * each of the three Vaani tools) and two for the webhook secret (the env file, Vercel, and the URL in Vaani's
 * webhook settings). See docs/SETUP_CHECKLIST.md, "Rotating secrets".
 */
import { config, parse } from "dotenv";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const envFile = flag("env-file") ?? ".env.local";
const DEFAULT_NAMES = ["VAANI_TOOL_SECRET", "VAANI_WEBHOOK_SECRET", "CRON_SECRET", "SESSION_SECRET"];

function rotate() {
  if (!existsSync(envFile)) throw new Error(`${envFile} not found`);
  const names = (flag("names") ?? DEFAULT_NAMES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  let text = readFileSync(envFile, "utf8");
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`bad name: ${name}`);
    const line = `${name}=${randomBytes(32).toString("hex")}`;
    text = new RegExp(`^${name}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${name}=.*$`, "m"), line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(envFile, text, { mode: 0o600 });
  console.log(`Wrote new 64-character values for ${names.join(", ")} into ${envFile}. Nothing was printed or sent anywhere.`);
  console.log("Next: update Vercel, redeploy, and update Vaani (see docs/SETUP_CHECKLIST.md). Use `pnpm secrets:copy NAME` to copy each value.");
}

function copy() {
  const name = rest.find((a) => !a.startsWith("--"));
  if (!name) throw new Error("usage: pnpm secrets:copy NAME");
  config({ path: envFile, quiet: true });
  const env = parse(readFileSync(envFile, "utf8"));
  let value = env[name];
  if (name === "VAANI_WEBHOOK_URL") {
    if (!env.VAANI_WEBHOOK_SECRET) throw new Error("VAANI_WEBHOOK_SECRET is not set");
    const base = env.APP_BASE_URL || "https://aangan-voice-agent-inky.vercel.app";
    value = `${base.replace(/\/$/, "")}/api/webhooks/vaani/call-ended?token=${env.VAANI_WEBHOOK_SECRET}`;
  }
  if (!value) throw new Error(`${name} is not set in ${envFile}`);
  const r = spawnSync("pbcopy", { input: value, env: { ...process.env, LANG: "en_US.UTF-8" } });
  if (r.status !== 0) throw new Error("pbcopy failed (this helper needs macOS)");
  console.log(`Copied ${name} (${value.length} characters) to the clipboard. It was not printed.`);
}

try {
  if (command === "rotate") rotate();
  else if (command === "copy") copy();
  else throw new Error("usage: pnpm secrets:rotate | pnpm secrets:copy NAME");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
