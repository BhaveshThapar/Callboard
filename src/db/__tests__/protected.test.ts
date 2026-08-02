import { afterEach, describe, expect, it } from "vitest";
import { hostnameOf, isProtectedDatabase, protectedComputeId } from "../protected";

const url = (host: string) => `postgresql://neondb_owner:pw@${host}/neondb?sslmode=require`;

const PROD = "ep-round-fire-a6dyy8t8";
const CI = "ep-lingering-shape-a6r1cfde";
const DEV = "ep-empty-bird-a65n0aeo";
const REGION = "us-west-2.aws.neon.tech";

afterEach(() => {
  delete process.env.CALLBOARD_PROTECTED_COMPUTE_ID;
});

describe("isProtectedDatabase", () => {
  it.each([
    ["unpooled", `${PROD}.${REGION}`],
    ["pooled", `${PROD}-pooler.${REGION}`],
    ["per-binding", `${PROD}-fwr.${REGION}`],
    ["per-binding pooled", `${PROD}-fwr-pooler.${REGION}`],
  ])("protects the deployed demo's %s host", (_spelling, host) => {
    expect(isProtectedDatabase(url(host))).toBe(true);
  });

  it.each([
    ["ci", `${CI}-pooler.${REGION}`],
    ["dev", `${DEV}-pooler.${REGION}`],
  ])("allows the %s branch", (_branch, host) => {
    expect(isProtectedDatabase(url(host))).toBe(false);
  });

  it("allows a local database", () => {
    expect(isProtectedDatabase("postgresql://postgres@localhost:5432/callboard")).toBe(false);
  });

  it("allows an absent connection string", () => {
    expect(isProtectedDatabase(undefined)).toBe(false);
    expect(isProtectedDatabase("")).toBe(false);
  });

  it("does not match a compute id that merely shares a prefix", () => {
    expect(isProtectedDatabase(url(`${PROD}x.${REGION}`))).toBe(false);
  });

  it.each([
    ["a bare host", `${PROD}-pooler.${REGION}`],
    ["a bad port", `postgresql://u:p@${PROD}.${REGION}:notaport/neondb`],
  ])("refuses %s that will not parse but names the protected compute", (_shape, value) => {
    expect(isProtectedDatabase(value)).toBe(true);
  });

  it("allows an unparseable string that names another compute", () => {
    expect(isProtectedDatabase(`postgresql://u:p@${CI}.${REGION}:notaport/neondb`)).toBe(false);
  });

  it("allows a string that is not a connection string at all", () => {
    expect(isProtectedDatabase("not a connection string")).toBe(false);
  });

  it("lets the environment override which compute is protected", () => {
    process.env.CALLBOARD_PROTECTED_COMPUTE_ID = CI;

    expect(protectedComputeId()).toBe(CI);
    expect(isProtectedDatabase(url(`${CI}-pooler.${REGION}`))).toBe(true);
    expect(isProtectedDatabase(url(`${PROD}-pooler.${REGION}`))).toBe(false);
  });
});

/**
 * `db:doctor` prints this beside its verdict, because a preflight that says "healthy" without
 * naming its target is how the deployed demo stayed broken for nineteen days while a green check
 * scrolled past for the `dev` branch.
 */
describe("hostnameOf", () => {
  it.each([
    ["unpooled", `${PROD}.${REGION}`],
    ["pooled", `${PROD}-pooler.${REGION}`],
    ["per-binding", `${PROD}-fwr.${REGION}`],
    ["dev", `${DEV}-pooler.${REGION}`],
  ])("reads the host out of a %s connection string", (_label, host) => {
    expect(hostnameOf(url(host))).toBe(host);
  });

  it("is undefined for a string that will not parse, so the caller can say so", () => {
    expect(hostnameOf("not a connection string")).toBeUndefined();
  });
});
