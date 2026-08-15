import { describe, expect, it } from "vitest";
import { authUrl, DRIVE_SCOPE, folderIdFrom } from "../google";

const CONFIG = {
  clientId: "client-123.apps.googleusercontent.com",
  clientSecret: "never-in-a-url",
  redirectUri: "https://callboard.example/api/drive/callback",
};

describe("authUrl", () => {
  it("asks for offline access and forces consent, which is what yields a refresh token at all", () => {
    const url = new URL(authUrl(CONFIG, "state-abc"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("asks only for read access, so a bug cannot write to somebody's Drive", () => {
    const scope = new URL(authUrl(CONFIG, "s")).searchParams.get("scope") ?? "";
    expect(scope).toContain(DRIVE_SCOPE);
    expect(scope).not.toContain("drive.file");
    expect(DRIVE_SCOPE.endsWith(".readonly")).toBe(true);
  });

  it("carries the CSRF state and never the client secret", () => {
    const url = authUrl(CONFIG, "state-abc");
    expect(new URL(url).searchParams.get("state")).toBe("state-abc");
    expect(url).not.toContain("never-in-a-url");
  });

  it("does not accumulate previously granted scopes", () => {
    expect(new URL(authUrl(CONFIG, "s")).searchParams.get("include_granted_scopes")).toBeNull();
  });
});

describe("folderIdFrom", () => {
  it("takes the id out of a pasted folder URL, because a board copies the address bar", () => {
    expect(folderIdFrom("https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0j")).toBe(
      "1A2b3C4d5E6f7G8h9I0j",
    );
  });

  it("handles a URL with query junk after the id", () => {
    expect(folderIdFrom("https://drive.google.com/drive/folders/1A2b3C4d5E?usp=sharing")).toBe(
      "1A2b3C4d5E",
    );
  });

  it("takes the open?id= form too", () => {
    expect(folderIdFrom("https://drive.google.com/open?id=1A2b3C4d5E")).toBe("1A2b3C4d5E");
  });

  it("accepts a bare id", () => {
    expect(folderIdFrom("  1A2b3C4d5E6f7G8h9I0j  ")).toBe("1A2b3C4d5E6f7G8h9I0j");
  });

  /**
   * The folder id is quoted into Drive's `q` grammar, which is string-delimited. An id carrying a
   * quote could close the string and rewrite the query, so anything that is not URL-safe is refused
   * rather than escaped -- no real Drive id looks like this, so refusing costs nothing.
   */
  it.each([
    "1A2b' or '1'='1",
    "abc\"def",
    "../../etc/passwd",
    "https://evil.example/folders/../x",
    "",
    "   ",
    "ab",
  ])("refuses %j", (hostile) => {
    expect(folderIdFrom(hostile)).toBeNull();
  });
});
