/**
 * One comp's buffers and one draw, shared by every test in this directory.
 *
 * The numbers are the repo's own guess and are labelled as such, exactly as the fee schedule's are.
 * No founding partner has sent a Gita (`docs/INTAKE.md` Part 3, "Not yet"), so these are calibrated
 * on the one workbook PRD §14 describes and nothing else. INTAKE says the consequence out loud: "A
 * schedule engine calibrated on one comp's workbook is a schedule engine that runs one comp."
 */
import type { BufferConfig, ScheduleInput } from "../types";

export const BUFFERS: BufferConfig = {
  // Doors at the anchor, first act two hours later.
  firstSlotAtMinute: 120,
  slotMinutes: 8,
  changeoverMinutes: 4,
  rooms: [
    { id: "stage", label: "Main stage" },
    { id: "green", label: "Green room" },
    { id: "stretch", label: "Stretch space" },
  ],
  teamBuffers: [
    { kind: "stretch", durationMinutes: 20, endsBeforePerformance: 30, room: "stretch" },
    { kind: "lobby", durationMinutes: 10, endsBeforePerformance: 12, room: "green" },
    { kind: "walk", durationMinutes: 6, endsBeforePerformance: 0, room: "stage" },
    { kind: "tech_out", durationMinutes: 5, endsBeforePerformance: -8, room: "stage" },
    // Zero, not null: this comp does not run a props segment. It produces no row and no gap.
    { kind: "props", durationMinutes: 0, endsBeforePerformance: 10, room: "stage" },
  ],
  compSegments: [
    {
      kind: "food",
      id: "dinner",
      label: "Dinner",
      startsAtMinute: 300,
      durationMinutes: 60,
      room: null,
      // Ordered for a clock time. The caterer did not hear that the show slipped.
      movesWithShow: false,
    },
    {
      kind: "judge_cutoff",
      id: "cutoff",
      label: "Judges' cutoff",
      startsAtMinute: 400,
      durationMinutes: 30,
      room: null,
      // Defined relative to the last performance, so it rides the delay.
      movesWithShow: true,
    },
  ],
  slack: [
    { id: "filler", label: "Filler act", minutes: 8 },
    // PRD §14 and INTAKE.md: 20 minutes told, 30 minutes held. The ten-minute difference is real
    // scheduling slack, and a system that does not know about it spends it without telling anybody.
    { id: "judge_held", label: "Judge buffer, held over told", minutes: 10 },
  ],
};

export const EIGHT_TEAMS: ScheduleInput = {
  // Deliberately not in position order: `showOrder` arrives from a query and Postgres promises
  // nothing about row order, so the engine has to sort. A fixture already sorted would hide that.
  showOrder: [
    { teamId: "team-c", position: 3 },
    { teamId: "team-a", position: 1 },
    { teamId: "team-h", position: 8 },
    { teamId: "team-b", position: 2 },
    { teamId: "team-e", position: 5 },
    { teamId: "team-d", position: 4 },
    { teamId: "team-g", position: 7 },
    { teamId: "team-f", position: 6 },
  ],
  delays: [],
};
