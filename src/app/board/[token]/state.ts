export type BoardActionState = { status: "idle" | "ok" | "error"; message?: string };

export const IDLE: BoardActionState = { status: "idle" };
