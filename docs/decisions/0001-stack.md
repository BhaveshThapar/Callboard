# ADR-0001 — Stack

**Status:** accepted · July 9, 2026

## Context

Greenfield. The buyer is a broke student board; the builder is one person with a ten-week selling window before the fall crush. Whatever we pick has to be boring, cheap to host, and fast to move in alone.

## Decision

Next.js 15 (App Router) · TypeScript strict · Tailwind · Drizzle ORM · Neon Postgres · Vercel · Vitest · Playwright · Bun.

## Why

**Next.js + Tailwind on Vercel** matches the most recent project in this account (TerpAdvisor), so there is nothing new to learn and deploys are free at this scale. Server components and server actions mean the judge scoring form is a plain `<form>` that works before JavaScript loads — which matters when three judges are on venue wifi.

**Neon Postgres** is already provisioned in this org. Branch-per-PR gives throwaway test databases. Relational is not a close call: the product's entire thesis is one canonical record with foreign keys between teams, money, scores, and schedule.

**Drizzle over Prisma.** TypeScript-first, no codegen daemon, no generated client to keep in sync, and no classes — which fits the functional style the repo enforces. Migrations are plain SQL files we can read.

**Bun** for install and scripts. It is installed and it is fast. Nothing depends on it; `npm` would work.

**Vitest for the math, Playwright for the promise.** The tabulation core is pure, so it gets unit tests that run in milliseconds. The acceptance bar in PRD §8.3 is written in terms of phones and minutes, so it gets a real browser on a mobile viewport.

## Rejected

**Firebase**, used in several older projects here. Wrong shape: no joins, and the money model in [PAYMENTS.md](../PAYMENTS.md) is relational to its bones.

**A monorepo with a separate API.** One person, one deployable. Split it when there is a second consumer.

**An auth library** (Auth.js, Clerk, Neon Auth). Judges must score with no install and no account (PRD §8.2 B2), so the credential is a signed link either way — see [ADR-0003](0003-judge-auth-via-signed-links.md). Adding a session provider for a single board user would be ceremony. It arrives with Module A, when there is something worth protecting beyond one comp's scores.
