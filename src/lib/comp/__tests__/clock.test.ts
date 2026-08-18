import { describe, expect, it } from "vitest";
import { clockAt, instantAt, zoneOffsetMs } from "../clock";

const NY = "America/New_York";

describe("instantAt", () => {
  it("reads the anchor in the comp's zone, not the server's", () => {
    // Noon in Maryland in March is 16:00 UTC. `new Date("2027-03-06T12:00")` on a UTC server would
    // give 12:00 UTC and put every call time four hours early -- in production only, silently.
    expect(instantAt("2027-03-06T12:00", NY, 0).toISOString()).toBe("2027-03-06T17:00:00.000Z");
  });

  it("adds minutes as minutes", () => {
    expect(instantAt("2027-03-06T12:00", NY, 90).toISOString()).toBe("2027-03-06T18:30:00.000Z");
  });

  it("carries a show past midnight, which comp_date alone cannot express", () => {
    // 12:00 anchor + 13 hours: the show ends the next calendar day. `comps.comp_date` is a bare
    // `date`, so this is exactly the case the schedule config exists to hold.
    expect(instantAt("2027-03-06T12:00", NY, 13 * 60).toISOString()).toBe(
      "2027-03-07T06:00:00.000Z",
    );
  });

  it("is right on both sides of a daylight-saving boundary", () => {
    // US DST began 2027-03-14. Same wall-clock anchor, one week apart, different UTC offsets.
    expect(instantAt("2027-03-13T12:00", NY, 0).toISOString()).toBe("2027-03-13T17:00:00.000Z");
    expect(instantAt("2027-03-20T12:00", NY, 0).toISOString()).toBe("2027-03-20T16:00:00.000Z");
  });

  it("handles a zone on the other side of UTC", () => {
    expect(instantAt("2027-03-06T12:00", "Asia/Kolkata", 0).toISOString()).toBe(
      "2027-03-06T06:30:00.000Z",
    );
  });
});

describe("zoneOffsetMs", () => {
  it("is negative west of UTC and positive east of it", () => {
    const winter = new Date("2027-01-15T12:00:00Z");
    expect(zoneOffsetMs(winter, NY)).toBe(-5 * 3_600_000);
    expect(zoneOffsetMs(winter, "Asia/Kolkata")).toBe(5.5 * 3_600_000);
    expect(zoneOffsetMs(winter, "UTC")).toBe(0);
  });
});

describe("clockAt", () => {
  it("renders the comp's local time, whatever the server's zone is", () => {
    expect(clockAt("2027-03-06T12:00", NY, 0)).toBe("Sat 12:00 PM");
    expect(clockAt("2027-03-06T12:00", NY, 225)).toBe("Sat 3:45 PM");
  });

  it("names the next day once the show runs past midnight", () => {
    expect(clockAt("2027-03-06T12:00", NY, 13 * 60)).toBe("Sun 1:00 AM");
  });
});
