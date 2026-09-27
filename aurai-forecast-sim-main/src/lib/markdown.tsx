/**
 * Renders the small Markdown subset the API's written answers use.
 *
 * Everything here builds React nodes rather than HTML. Answers quote the
 * user's own dataset names, column names and report titles back at them, so
 * anything rendered as HTML would execute whatever they had imported.
 *
 * The subset is deliberately narrow, and matches what `gemini_system_prompt()`
 * permits: bold, `##` headings, bullet and numbered lists, paragraphs. Anything
 * else is shown as the literal text it is.
 */
import type { ReactNode } from "react";

/** `**bold**` within a line. */
export function renderBold(text: string): ReactNode[] {
  return String(text ?? "").split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  );
}

/**
 * A whole answer: headings, lists and paragraphs, with bold inside each.
 *
 * Consecutive list items are gathered into one list so they render as a list
 * rather than as separate one-item lists — the difference is visible as
 * spacing, and a written recommendation reads as a scattered mess without it.
 */
export function renderRichText(text: string): ReactNode {
  const lines = String(text ?? "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={i} className="leading-relaxed">{renderBold(item)}</li>
    ));
    blocks.push(
      list.ordered
        ? <ol key={blocks.length} className="list-decimal pl-5 space-y-1.5 my-2">{items}</ol>
        : <ul key={blocks.length} className="list-disc pl-5 space-y-1.5 my-2">{items}</ul>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") { flushList(); continue; }

    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet || numbered) {
      const ordered = !!numbered;
      // A change of list type starts a new list rather than mixing markers.
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ? bullet[1] : numbered![1]));
      continue;
    }

    flushList();

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <h3 key={blocks.length} className="text-sm font-semibold text-foreground mt-4 first:mt-0">
          {renderBold(heading[2])}
        </h3>,
      );
      continue;
    }

    blocks.push(
      <p key={blocks.length} className="leading-relaxed my-2 first:mt-0">{renderBold(line)}</p>,
    );
  }
  flushList();

  return <>{blocks}</>;
}
