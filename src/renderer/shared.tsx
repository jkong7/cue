import type { ReactNode } from "react";

export interface CueApi {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  on<T = unknown>(channel: string, fn: (payload: T) => void): () => void;
  sendPcm(buf: ArrayBuffer): void;
}

declare global {
  interface Window {
    cue: CueApi;
  }
}

export const cue = window.cue;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong> : <code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`}>{list}</ul>);
    list = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      blocks.push(<pre key={`pre-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
      i++;
      continue;
    }
    const li = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      list.push(<li key={`li-${i}`}>{inline(li[1], `li-${i}`)}</li>);
    } else if (line.trim() === "") {
      flush();
    } else if (/^#{1,4}\s/.test(line)) {
      flush();
      blocks.push(<h4 key={`h-${i}`}>{inline(line.replace(/^#+\s/, ""), `h-${i}`)}</h4>);
    } else if (/^---+$/.test(line.trim())) {
      flush();
      blocks.push(<hr key={`hr-${i}`} />);
    } else {
      flush();
      blocks.push(<p key={`p-${i}`}>{inline(line, `p-${i}`)}</p>);
    }
    i++;
  }
  flush();
  return <div className="md">{blocks}</div>;
}

export const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const KIND_LABEL: Record<string, string> = {
  answer: "Answer",
  suggest: "Say this",
  define: "Define",
  recall: "Remember",
  fact: "Check",
  tip: "Move",
  coach: "Coach",
  practice: "They ask",
  brief: "Brief",
};
