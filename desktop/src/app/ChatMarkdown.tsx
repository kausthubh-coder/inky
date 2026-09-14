import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { externalLinkUrl } from "../../shared/external-link.js";
import "./chat-markdown.css";

const components: Components = {
  a: ({ href, children }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  // Keep image descriptions without loading remote content from a reply.
  img: ({ alt }) => <span>{alt}</span>,
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={url => externalLinkUrl(url) ?? ""}>
        {text}
      </Markdown>
    </div>
  );
}
