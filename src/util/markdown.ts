import {marked} from "marked"
import insane from "insane"

const ALLOWED_TAGS = [
  "p",
  "br",
  "b",
  "i",
  "em",
  "strong",
  "del",
  "s",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]

/**
 * Markdown → sanitized HTML for chat-style content (DMs, BRO/NODE channel
 * messages): single newlines render as <br> ("breaks"), since chat authors
 * don't write blank-line-separated paragraphs the way long-form posts do.
 */
export const renderChatMarkdown = (content: string): string =>
  insane(marked.parse(content, {breaks: true, gfm: true}) as string, {allowedTags: ALLOWED_TAGS})
