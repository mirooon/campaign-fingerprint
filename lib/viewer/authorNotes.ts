/**
 * Author's notes left in the HTML of a page (B-028): `<!-- COMMENT 3: … — skeptic -->` marks the fake comment a
 * script author wrote for a role, `<!-- X-POST: … -->` a mock social-media post. They are evidence of how the page was
 * staged, so the card shows them apart from ordinary code comments. Pure: takes the comment texts (or feature labels).
 */

export interface AuthorNote {
  kind: "comment" | "post";
  /** What the note is, in words of the interface. */
  label: string;
  text: string;
}

/** Strips the quotes and the ellipsis a feature label wraps around a comment („…”). */
function bare(label: string): string {
  return label.replace(/^[„"]\s*/, "").replace(/\s*[”"]$/, "").replace(/…$/, "").trim();
}

/** Author's notes among the comments of a page, in the order given; ordinary code comments are left out. */
export function authorNotes(comments: string[]): AuthorNote[] {
  const notes: AuthorNote[] = [];
  for (const raw of comments) {
    const text = bare(raw);
    const c = text.match(/^comment\s*(\d+)\s*:\s*(.+?)(?:\s+[—–-]\s+([^—–]{1,40}))?$/i);
    if (c) {
      notes.push({ kind: "comment", label: `komentarz scenariusza nr ${c[1]}${c[3] ? ` (rola: ${c[3].trim()})` : ""}`, text: c[2].trim() });
      continue;
    }
    const p = text.match(/^x-post\s*:\s*(.+)$/i);
    if (p) notes.push({ kind: "post", label: "scenariusz posta w serwisie społecznościowym", text: p[1].trim() });
  }
  return notes;
}
