import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Brain",
  description: "Your second brain dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-[var(--border)] py-4 text-center text-xs text-[var(--text-secondary)]">
          Inspired by{" "}
          <a
            href="https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[var(--text-primary)]"
          >
            Andrej Karpathy&rsquo;s LLM Wiki
          </a>{" "}
          via{" "}
          <a
            href="https://www.youtube.com/watch?v=dxq7WtWxi44"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[var(--text-primary)]"
          >
            Nate B Jones
          </a>
          .
        </footer>
      </body>
    </html>
  );
}
