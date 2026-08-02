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

/** One parsed list line, before it is nested. */
interface Row {
  /** Leading whitespace, in columns — what decides parent vs sibling. */
  indent: number;
  ordered: boolean;
  /** The number the source actually wrote, so a split list can resume where it left off. */
  num: number;
  text: string;
}

/**
 * Rows → nested <ol>/<ul>.
 *
 * The two things this exists to get right, both of which the flat version got wrong on
 * every ranking the assistant writes:
 *
 *   1. A deeper-indented row belongs INSIDE the item above it. "1. Player" followed by
 *      "  - Stats: …" used to end the ordered list and start a new one, so the next
 *      player was numbered 1 again — the whole top-ten read "1., 1., 1.".
 *   2. When a list genuinely is split (a same-indent bullet between numbered items, which
 *      is the un-indented flavour of the same output), the new <ol> carries `start` from
 *      the source number instead of silently restarting at 1.
 */
function renderRows(rows: Row[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let group: { ordered: boolean; start: number; items: ReactNode[] } | null = null;

  const close = () => {
    const g = group;
    if (!g) return;
    const key = `${keyBase}-g${out.length}`;
    out.push(
      g.ordered ? (
        <ol key={key} start={g.start}>
          {g.items}
        </ol>
      ) : (
        <ul key={key}>{g.items}</ul>
      )
    );
    group = null;
  };

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    // Everything indented past this row, up to the next row at this level or shallower,
    // is this item's sub-list.
    let j = i + 1;
    while (j < rows.length && rows[j].indent > row.indent) j++;
    const children =
      j > i + 1 ? renderRows(rows.slice(i + 1, j), `${keyBase}-${i}c`) : null;

    if (!group || group.ordered !== row.ordered) {
      close();
      group = { ordered: row.ordered, start: row.num, items: [] };
    }
    group.items.push(
      <li key={`${keyBase}-${i}`}>
        {inline(row.text, `${keyBase}-${i}`)}
        {children}
      </li>
    );
    i = j;
  }
  close();
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let rows: Row[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (!rows.length) return;
    const key = `l${blocks.length}`;
    blocks.push(<Fragment key={key}>{renderRows(rows, key)}</Fragment>);
    rows = [];
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
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);

    if (!line.trim()) {
      flushPara();
      // A blank line does NOT end a list: Markdown's "loose" lists put one between every
      // item, and models write them constantly. Only a non-list line ends it (below), so
      // the numbering survives the gap. An empty tail is harmless — flushList at the end
      // renders whatever is still open.
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
      // Tabs count as two columns so a tab-indented sub-bullet still nests.
      const lead = (bullet ?? numbered)![1].replace(/\t/g, "  ").length;
      rows.push(
        numbered
          ? { indent: lead, ordered: true, num: Number(numbered[2]) || 1, text: numbered[3] }
          : { indent: lead, ordered: false, num: 1, text: bullet![2] }
      );
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();

  return <div className="md">{blocks}</div>;
}
