// Display-only helper. A leading @mention is used as a routing prefix when
// composing wall messages; strip it when rendering so the reader sees the plain
// message. A mid-sentence @mention (e.g. "I think @Advaith should review") is
// left untouched — only a prefix at the very start is removed. The stored DB
// content is never modified; this is applied at render time only.
export function stripMentionPrefix(content: string): string {
  return content.replace(/^@\w[\w._-]*\s+/, "").trim();
}
