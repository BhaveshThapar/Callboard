import type { AccountRole } from "@/db/schema";
import { cx, pillClass } from "./styles";

/**
 * What a person is at one comp, said in one word wherever their name or their comp appears.
 *
 * Colour carries no severity here — three roles, three hues, so a person holding two of them at
 * different comps can tell their rows apart at a glance. `liaison` is deliberately the quiet one:
 * it is a real membership with no screen behind it until C1, and a badge that shouted would imply
 * there is somewhere to go.
 */
const ROLE_STYLE: Record<AccountRole, string> = {
  board: "bg-primary-light text-primary",
  captain: "bg-secondary-light text-secondary",
  liaison: "bg-hover text-muted",
};

export function RoleBadge({ role, className }: { role: AccountRole; className?: string }) {
  return (
    <span className={cx(pillClass, ROLE_STYLE[role], className)} data-testid={`role-${role}`}>
      {role}
    </span>
  );
}
