import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { safeChatHref } from "./chatMarkdown.js";

const plugins = [remarkGfm, remarkBreaks];

function heading({ children }: { children?: ReactNode | undefined }) {
  return <p className="inky-md-heading">{children}</p>;
}

const components: Components = {
  a({ href, children }) {
    const safe = safeChatHref(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  img({ alt }) {
    return alt ? <em>{alt}</em> : null;
  },
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="inky-markdown">
      <Markdown
        remarkPlugins={plugins}
        urlTransform={(url) => safeChatHref(url) ?? ""}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
