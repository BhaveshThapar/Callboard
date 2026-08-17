"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass, pillClass, primaryButtonClass } from "@/components/styles";
import { moveInShowOrderAction, setShowOrderAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import { IDLE } from "../state";

export type DrawRow = {
  id: string;
  name: string;
  bidCode: string;
  position: number | null;
};

/**
 * G1's screen — the Friday-night draw.
 *
 * Two forms, because they are two acts. **Draw** states the whole order at once, which is what a
 * board does after the mixer game; the arrows **trade** two adjacent slots, which is what it does
 * when something changes afterwards. A single save-everything form would renumber every team to move
 * one act, and a running order is already printed on an emcee's sheet and open on eight phones.
 *
 * The draw form posts one `order` field per row in the order the rows are rendered, so it works with
 * JavaScript off — B2's no-install rule applied to a board screen. Reordering before submitting is
 * what the arrows are for.
 */
export function ShowOrderPanel({
  compId,
  basePath,
  rows,
}: {
  compId: string;
  basePath: string;
  rows: DrawRow[];
}) {
  const [drawState, draw, drawing] = useActionState(setShowOrderAction, IDLE);
  const [moveState, moveOne, moving] = useActionState(moveInShowOrderAction, IDLE);
  const state = moveState.status === "idle" ? drawState : moveState;

  const drawn = rows.filter((row) => row.position !== null);
  const undrawn = rows.filter((row) => row.position === null);

  return (
    <section className={cx(cardClass, "mt-6")} data-testid="show-order">
      <h3 className={eyebrowClass}>Running order</h3>

      {rows.length === 0 ? (
        <p className="mt-3 text-body text-muted" data-testid="show-order-empty">
          No team is accepted yet, so there is no running order to draw. Accept teams on the roster
          screen first.
        </p>
      ) : (
        <>
          <p className="mt-2 text-caption text-subtle">
            The draw comes from the mixer game; Callboard records the result, it does not run the
            game. Everything else on comp day derives from this order.
          </p>

          <ol className="mt-4 space-y-2" data-testid="show-order-list">
            {drawn.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3"
                data-testid={`show-order-row-${row.bidCode}`}
              >
                <span className={cx(pillClass, "tabular-nums")} data-testid={`show-order-position-${row.bidCode}`}>
                  {row.position}
                </span>
                <span className="text-body text-heading flex-1">{row.name}</span>
                <form action={moveOne} className="flex gap-1">
                  <ScopeFields scope={{ compId, basePath }} />
                  <input type="hidden" name="teamId" value={row.id} />
                  <button
                    type="submit"
                    name="direction"
                    value="up"
                    disabled={moving}
                    aria-label={`Move ${row.name} earlier`}
                    data-testid={`show-order-up-${row.bidCode}`}
                    className="rounded-md border border-border px-2 py-1 text-caption text-muted hover:text-heading disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="submit"
                    name="direction"
                    value="down"
                    disabled={moving}
                    aria-label={`Move ${row.name} later`}
                    data-testid={`show-order-down-${row.bidCode}`}
                    className="rounded-md border border-border px-2 py-1 text-caption text-muted hover:text-heading disabled:opacity-40"
                  >
                    ↓
                  </button>
                </form>
              </li>
            ))}
          </ol>

          {undrawn.length > 0 && (
            <p className="mt-3 text-caption text-subtle" data-testid="show-order-undrawn">
              Not in the running order yet: {undrawn.map((row) => row.name).join(", ")}. Drawing puts
              every accepted team in, so nobody is left off the show by accident.
            </p>
          )}

          <form action={draw} className="mt-4">
            <ScopeFields scope={{ compId, basePath }} />
            {[...drawn, ...undrawn].map((row) => (
              <input key={row.id} type="hidden" name="order" value={row.id} />
            ))}
            <button
              type="submit"
              disabled={drawing}
              className={primaryButtonClass}
              data-testid="show-order-draw"
            >
              {drawn.length === 0 ? "Number the running order" : "Renumber 1–" + rows.length}
            </button>
            <span className="ml-3 text-caption text-subtle">
              Closes any gap a dropped team left behind.
            </span>
          </form>
        </>
      )}

      {state.message && (
        <p
          className={cx(
            "mt-3 text-caption",
            state.status === "error" ? "text-danger" : "text-subtle",
          )}
          data-testid="show-order-message"
        >
          {state.message}
        </p>
      )}
    </section>
  );
}
