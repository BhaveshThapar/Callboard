export type BoardActionState = { status: "idle" | "ok" | "error"; message?: string };

export const IDLE: BoardActionState = { status: "idle" };

/**
 * What every board form carries, and the two halves are deliberately not one value.
 *
 * `compId` is the **authorization subject**: `resolveBoardAccess` proves the holder may open that
 * comp, and a forged one resolves to nothing. `basePath` is **display only** — it exists so an
 * action can `revalidatePath` the right entry and so a link can point somewhere, and the worst a
 * forged one does is refresh a page the sender could already refresh.
 *
 * One string doing both jobs would be trusted for the second reason on the day somebody needed it
 * for the first. It lives here rather than in `actions.ts` so a client component can import the type
 * without importing a `"use server"` module.
 */
export type BoardFormScope = { compId: string; basePath: string };
