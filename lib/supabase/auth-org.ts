"use client";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

interface UserOrgContext {
  user: User;
  organizationId: string;
  role: "owner" | "admin" | "staff";
}

type CachedContext = {
  userId: string;
  data: UserOrgContext;
  cachedAt: number;
};

const CACHE_TTL_MS = 60_000;
let cachedContext: CachedContext | null = null;

export async function getUserOrgContext(
  supabase: SupabaseClient,
  options?: { force?: boolean; session?: Session | null }
): Promise<{ data: UserOrgContext | null; error: string | null }> {
  let session = options?.session ?? null;
  if (!session) {
    const {
      data: { session: fetchedSession },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      return { data: null, error: sessionError.message };
    }
    session = fetchedSession;
  }

  if (!session?.user) {
    cachedContext = null;
    return { data: null, error: "Não autenticado." };
  }

  const now = Date.now();
  if (
    !options?.force &&
    cachedContext &&
    cachedContext.userId === session.user.id &&
    now - cachedContext.cachedAt < CACHE_TTL_MS
  ) {
    return { data: cachedContext.data, error: null };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", session.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return { data: null, error: membershipError.message };
  }

  if (!membership?.organization_id) {
    cachedContext = null;
    return { data: null, error: "Usuário sem organização vinculada." };
  }

  const data: UserOrgContext = {
    user: session.user,
    organizationId: membership.organization_id as string,
    role: (membership.role as UserOrgContext["role"]) ?? "staff",
  };

  cachedContext = {
    userId: session.user.id,
    data,
    cachedAt: now,
  };

  return { data, error: null };
}
