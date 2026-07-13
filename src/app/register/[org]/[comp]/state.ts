/**
 * A rejected application carries the applicant's answers back with it.
 *
 * React resets an uncontrolled form once its action has run, so without this a captain who mistyped
 * one field would get the error *and an empty form*, and have to type the whole thing again. The
 * values are echoed back as `defaultValue`s, which is the only way the form survives its own
 * refusal.
 */
export type ApplicationValues = {
  teamName: string;
  school: string;
  contactName: string;
  contactEmail: string;
  rosterSize: string;
  auditionUrl: string;
  waiverAccepted: boolean;
};

export type ApplyState =
  | { status: "idle" }
  | { status: "error"; message: string; values: ApplicationValues }
  | { status: "applied"; bidCode: string };

export const IDLE: ApplyState = { status: "idle" };

export const EMPTY: ApplicationValues = {
  teamName: "",
  school: "",
  contactName: "",
  contactEmail: "",
  rosterSize: "",
  auditionUrl: "",
  waiverAccepted: false,
};
