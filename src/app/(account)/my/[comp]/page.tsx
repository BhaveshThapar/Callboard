import { notFound, redirect } from "next/navigation";
import { compSlugsById } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

/**
 * Where `/my/[comp]` used to be, kept because it is in sent email.
 *
 * The captain's page moved into the comp shell at `/app/[org]/[comp]/team` ([ADR-0022]). This link
 * shape went out in `invitation.created` bodies and in whatever a board pasted into a group chat, so
 * it redirects rather than 404s — a URL a product printed and mailed is a URL that product owes an
 * answer to.
 *
 * It authorizes nothing and reads no membership: it translates an id into slugs and forwards. The
 * page it forwards to does the whole check, so an id belonging to a comp this visitor has never
 * heard of gets exactly as far as the sign-in redirect.
 *
 * [ADR-0022]: ../../../../../docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md
 */
export default async function LegacyMyTeam({ params }: { params: Promise<{ comp: string }> }) {
  const { comp } = await params;

  const slugs = await compSlugsById(comp);
  if (!slugs) notFound();

  redirect(`/app/${slugs.orgSlug}/${slugs.compSlug}/team`);
}
