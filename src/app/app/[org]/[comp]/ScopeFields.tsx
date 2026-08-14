import type { BoardFormScope } from "./state";

/**
 * The two hidden fields every board form needs, in one place so no form can carry only one.
 *
 * Before [ADR-0022] this was a single `name="token"` input repeated twenty-two times, and a form
 * that forgot it simply failed. Now there are two fields with different jobs — one authorizes, one
 * addresses — and a form carrying only the second would authorize nothing while looking complete.
 * A component is what makes "both, always" structural rather than remembered.
 */
export function ScopeFields({ scope }: { scope: BoardFormScope }) {
  return (
    <>
      <input type="hidden" name="compId" value={scope.compId} />
      <input type="hidden" name="basePath" value={scope.basePath} />
    </>
  );
}
