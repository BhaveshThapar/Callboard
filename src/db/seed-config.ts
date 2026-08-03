import type { TeamStatus } from "@/db/schema";
import type { CompConfig } from "./config";

/**
 * The demo comp of PRD §14: eight competing teams, three judges, anonymized bid codes.
 * Kept apart from `seed.ts` so it can be imported without opening a database connection.
 */
export const DEMO_CONFIG: CompConfig = {
  org: { name: "Maryland Mayuri", slug: "maryland-mayuri" },
  comp: {
    name: "Mayuri 2027",
    slug: "mayuri-2027",
    compDate: "2027-02-20",
    venue: "Ritchie Coliseum",
    /**
     * `open`, not `live`, and the demo script is the reason. DEMO.md's closing beat is *"the window
     * says `open` and carries the public form's address; closing it is one click"* — and on a `live`
     * comp the pill reads `live`, the form's address does not render at all (it is gated on `open`),
     * and the only button offered is "Mark complete". The step could not be performed.
     *
     * It is also what the comp being demonstrated actually is. A board is shown this in August for a
     * February comp: registration is open, which is the whole reason there is an applicant on the
     * roster to accept. `live` describes the morning of the show.
     */
    status: "open",
  },
  rubric: {
    name: "Fusion 2027",
    normalization: "zscore",
    tiebreakers: [{ kind: "head_to_head" }],
    criteria: [
      { label: "Choreography", maxPoints: 30, weightBp: 10_000, sortOrder: 0 },
      { label: "Execution", maxPoints: 30, weightBp: 10_000, sortOrder: 1 },
      { label: "Musicality", maxPoints: 20, weightBp: 10_000, sortOrder: 2 },
      { label: "Stage Presence", maxPoints: 20, weightBp: 10_000, sortOrder: 3 },
    ],
  },
  /**
   * Every team carries a captain, and every address is `@example.com` on purpose.
   *
   * A10 chases a team's `contact_person_id`, so a demo roster without one is a roster the reminder
   * button silently declines to chase — the beat would show a board pressing a button and nothing
   * happening. `example.com` is reserved by RFC 2606 and can never be a real mailbox, so a demo
   * comp cannot mail a real person even if `RESEND_API_KEY` and `COMMS_FROM` are set on the very
   * deployment being demonstrated.
   */
  teams: [
    { bidCode: "A-114", name: "NCSU Nazaare", school: "NC State", captain: "Meera Iyer" },
    { bidCode: "B-207", name: "BU Dheem", school: "Boston University", captain: "Rohan Kapoor" },
    { bidCode: "C-331", name: "NSU Veera", school: "Northeastern", captain: "Anika Bose" },
    { bidCode: "D-402", name: "GT Ramblin' Raas", school: "Georgia Tech", captain: "Vikram Shah" },
    { bidCode: "E-518", name: "UMD Moksha", school: "Maryland", captain: "Sana Reddy" },
    { bidCode: "F-623", name: "Pitt Nrityamala", school: "Pittsburgh", captain: "Kiran Nair" },
    { bidCode: "G-745", name: "Cornell Yalla", school: "Cornell", captain: "Dev Malhotra" },
    { bidCode: "H-860", name: "UVA Aayaam", school: "Virginia", captain: "Priya Menon" },
    // Room counts are deliberately partial. The demo must show the *gap* case as well as the happy
    // one: a team whose rooms are unknown gets no hotel charge and a stated reason, rather than a
    // $0 hotel line a treasurer would read as "nothing owed".
  ]
    .map(({ captain, ...team }, i) => ({
      ...team,
      division: "fusion",
      rosterSize: 16,
      rooms: i < 6 ? 4 : undefined,
      performanceOrder: i + 1,
      status: "competing" as TeamStatus,
      contact: {
        name: captain,
        email: `${captain.split(" ")[0]?.toLowerCase()}.${team.bidCode.toLowerCase()}@example.com`,
      },
    }))
    .concat([
      /**
       * The applicant, and the reason it exists: DEMO.md's money beat opens with *"accept a team →
       * it owes what the schedule says"*, and on a roster of eight competing teams there was
       * nothing to accept. The beat could not be run at all, which nobody noticed until it was
       * rehearsed end to end against the deployed host.
       *
       * It is also truer to the comp being demonstrated. Mayuri 2026 had **38 teams apply for 8
       * slots** (PRD §14) — an applicant is the normal state of that roster, and a screen with none
       * shows a comp that never took an application.
       *
       * `rooms` is deliberately unset, so accepting it demonstrates both halves in one move: the
       * charges generate in the same act, and the hotel line is *withheld with a stated reason*
       * rather than billed at $0 — which is then answerable from the roster screen, on the same
       * page, in front of the prospect.
       */
      {
        bidCode: "I-902",
        name: "RU Natya",
        school: "Rutgers",
        division: "fusion",
        rosterSize: 16,
        rooms: undefined,
        performanceOrder: 9,
        status: "applied" as TeamStatus,
        contact: { name: "Arjun Patel", email: "arjun.i-902@example.com" },
      },
    ]),
  judges: [
    { name: "Priya Raghavan", email: "priya@example.com" },
    { name: "Arjun Mehta", email: "arjun@example.com" },
    { name: "Sonia Desai", email: "sonia@example.com" },
  ],
  board: [{ name: "Ananya Krishnan", email: "ananya@example.com" }],
  /**
   * The public form, without which `/register/maryland-mayuri/mayuri-2027` served a 404 on the
   * deployed demo — `openRegistration` returns null unless the comp is `open` **and** carries a
   * `registration` block, and DEMO_CONFIG carried neither. So the roster screen could not show the
   * form's address, ADJ·3's public page had no form to link to, and the one instrument A1 is sold
   * on was unreachable on the only database a prospect ever sees.
   *
   * One custom field, because A1's claim is that a board adds *its own* questions and a form with
   * none demonstrates the half that was always easy. `arrival_day` is the question Mayuri's own
   * intake asks, and its answer lands in `teams.custom_answers` under the label it was asked in.
   */
  registration: {
    waiverText:
      "Teams compete at their own risk. Maryland Mayuri is not liable for injury, loss, or damage " +
      "to property. By applying you confirm every dancer on your roster has been made aware of this.",
    requireAuditionUrl: true,
    maxRosterSize: 30,
    fields: [
      {
        id: "arrival_day",
        label: "Arrival day",
        type: "select",
        required: true,
        options: ["Friday", "Saturday morning"],
      },
    ],
  },
  // Mayuri 2026's real numbers (PRD §14, INTAKE.md): $70/dancer + $140/room + a $100 deposit. Every
  // team therefore owes a different total, which is the normal case rather than the hard one.
  feeSchedule: {
    perDancerCents: 7000,
    perRoomCents: 14000,
    depositCents: 10000,
    lateFeeCents: 2500,
    lateAfter: "2027-02-01",
  },
};
