import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn";

/**
 * The one place model output is turned into readable text.
 *
 * Harness answers are markdown — headings, fenced code, tables, task lists —
 * and every surface that shows one (chat bubbles, a board card's output tab)
 * has to render it the same way. Styling lives here rather than at the call
 * sites because the container's own text rules matter: a `whitespace-pre-wrap`
 * wrapper, which is right for plain text, doubles every blank line once the
 * markdown itself is producing the block spacing.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("hive-md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ children: code, ...props }) => (
            <code
              {...props}
              className={cn(
                "font-mono text-[12px] px-1.5 py-0.5 rounded bg-surface-2 border border-line",
                props.className,
              )}
            >
              {code}
            </code>
          ),
          pre: ({ children: pre, ...props }) => (
            <pre
              {...props}
              className={cn(
                "font-mono text-[12px] p-3 my-2 rounded-md bg-surface-2 border border-line overflow-x-auto",
                // A fence sets its own type; the inline rule above must not
                // paint a second box around every line inside it.
                "[&_code]:bg-transparent [&_code]:border-0 [&_code]:p-0",
                props.className,
              )}
            >
              {pre}
            </pre>
          ),
          a: ({ children: text, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-2"
            >
              {text}
            </a>
          ),
          table: ({ children: rows, ...props }) => (
            // Wide tables scroll inside the message rather than stretching it.
            <div className="my-2 overflow-x-auto">
              <table {...props} className="text-[12px] border-collapse">
                {rows}
              </table>
            </div>
          ),
          th: ({ children: cell, ...props }) => (
            <th
              {...props}
              className="border border-line px-2 py-1 text-left font-medium bg-surface-2"
            >
              {cell}
            </th>
          ),
          td: ({ children: cell, ...props }) => (
            <td {...props} className="border border-line px-2 py-1 align-top">
              {cell}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
