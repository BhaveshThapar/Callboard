export type SubmitState = { status: "idle" | "saved" | "error"; message?: string };

export const IDLE: SubmitState = { status: "idle" };
