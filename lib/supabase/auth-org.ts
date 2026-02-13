"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";

interface UserOrgContext {
  user: User;
  organizationId: string;
}

export async function getUserOrgContext(
  supabase: SupabaseClient
): Promise<{ data: UserOrgContext | null; error: string | null }> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return { data: null, error: sessionError.message };
  }

  if (!session?.user) {
    return { data: null, error: "Não autenticado." };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", session.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return { data: null, error: membershipError.message };
  }

  if (!membership?.organization_id) {
    return { data: null, error: "Usuário sem organização vinculada." };
  }

  return {
    data: {
      user: session.user,
      organizationId: membership.organization_id as string,
    },
    error: null,
  };
}
