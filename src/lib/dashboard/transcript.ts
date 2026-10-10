import { detectPriceLeak } from "@/lib/rules/price-leak";

export interface Turn {
  speaker: "agent" | "caller";
  time: string | null;
  text: string;
  /** The agent said something that looks like a price (P5). Kinds only, never the figure. */
  leak: boolean;
}

/** Vaani's "[hh:mm:ss] AGENT: …" / "USER: …" transcript as turns, with price-leak turns marked. */
export function parseTranscript(transcript: string | null | undefined): Turn[] {
  if (!transcript) return [];
  const turns: Array<Omit<Turn, "leak">> = [];
  for (const line of transcript.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:\[([^\]]*)\]\s*)?(AGENT|ASSISTANT|BOT|USER|CALLER|HUMAN)\s*:\s*(.*)$/i);
    if (m) {
      turns.push({ speaker: /^(AGENT|ASSISTANT|BOT)$/i.test(m[2]) ? "agent" : "caller", time: m[1] ?? null, text: m[3] });
    } else if (turns.length && line.trim()) {
      turns[turns.length - 1].text += ` ${line.trim()}`;
    }
  }
  const agentIdx = turns.flatMap((t, i) => (t.speaker === "agent" ? [i] : []));
  const leaked = new Set(detectPriceLeak(agentIdx.map((i) => turns[i].text), null).turns.map((n) => agentIdx[n]));
  return turns.map((t, i) => ({ ...t, leak: leaked.has(i) }));
}
