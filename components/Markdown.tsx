import { Fragment, type ReactNode } from "react";

/**
 * The small slice of Markdown the assistant actually emits: headings, bold, italics,
 * inline code, links, and bullet / numbered lists.
 *
 * Hand-rolled rather than pulled from npm for two reasons. It keeps the dependency list
 * at next + react, and — more importantly — it renders to React ELEMENTS. Model output is
 * untrusted text that can contain anything the web has; routing it through
 * `dangerouslySetInnerHTML` (which is what a "just convert to HTML" markdown lib invites)
 * would make every reply a script-injection surface. Nothing here can produce a tag.
 */

/** Bold / italic / code / links inside one line. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass, alternating between the pattern matches and the plain text between them.
  const pattern =
    /(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const cut = tok.indexOf("](");
      const label = tok.slice(1, cut);
      const href = tok.slice(cut + 2, -1);
      // Only http(s) — a `javascript:` href in model output must never become a link.
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        )
      );
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushList = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    const items = list.items.map((it, i) => <li key={`${key}-${i}`}>{inline(it, `${key}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    list = null;
  };
  const flushPara = () => {
    if (!para.length) return;
    const key = `p${blocks.length}`;
    blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (heading) {
      flushPara();
      flushList();
      const key = `h${blocks.length}`;
      // h1/h2 in a chat reply would out-shout the page title, so everything lands at h3+.
      const Tag = (heading[1].length <= 2 ? "h3" : "h4") as "h3" | "h4";
      blocks.push(<Tag key={key}>{inline(heading[2], key)}</Tag>);
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();

  return <div className="md">{blocks}</div>;
}
