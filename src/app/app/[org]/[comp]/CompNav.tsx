"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/styles";

export type NavItem = { href: string; label: string };

/**
 * The nav the board tree never had.
 *
 * Until this existed, each of the five board screens rendered its own wordmark and its own ad-hoc
 * links to whichever siblings its author remembered — which is why A9's dashboard shipped reachable
 * only by typing the URL and stayed that way for a day. A single list, built once from the visitor's
 * role, makes *linked from somewhere* a property of the shell rather than something each new page
 * has to remember to do.
 *
 * A client component only because a layout is not told its own pathname; the links themselves are
 * static and the highlight is the entire reason for the boundary.
 */
export function CompNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="mt-5 flex flex-wrap gap-1 border-b border-border-soft" aria-label="Comp">
      {items.map((item) => {
        const current = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            data-testid={`nav-${item.label.toLowerCase()}`}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-card font-medium transition-colors",
              current
                ? "border-primary text-heading"
                : "border-transparent text-muted hover:text-heading",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
