import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildBillingEmailPayload,
  dispatchBillingEmail,
  type BillingEmailInput,
} from "@/lib/shad-manager/billing-email-server";

export const runtime = "nodejs";

interface SendChargeEmailBody extends BillingEmailInput {
  organizationId: string;
  to: string;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const billingEmailFrom = process.env.BILLING_EMAIL_FROM;

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError("Supabase não configurado no servidor.", 500);
  }

  if (!billingEmailFrom) {
    return jsonError("Configuração de e-mail ausente (BILLING_EMAIL_FROM).", 500);
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return jsonError("Autenticação obrigatória.", 401);
  }

  const body = (await request.json().catch(() => null)) as SendChargeEmailBody | null;
  if (!body) {
    return jsonError("Payload inválido.");
  }

  const organizationId = String(body.organizationId || "").trim();
  const to = String(body.to || "").trim();

  if (!organizationId) return jsonError("organizationId é obrigatório.");
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return jsonError("E-mail de destino inválido.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return jsonError(userError?.message ?? "Sessão inválida.", 401);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return jsonError(membershipError.message, 403);
  }
  if (!membership) {
    return jsonError("Acesso negado para esta organização.", 403);
  }

  let organizationName = "ShadManager";
  let siteAccentColor: string | null = null;

  const { data: organizationRow } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationRow?.name && typeof organizationRow.name === "string") {
    organizationName = organizationRow.name.trim() || organizationName;
  }

  const { data: settingsRow, error: settingsError } = await supabase
    .from("organization_settings")
    .select("site_accent_color")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!settingsError && settingsRow && typeof settingsRow.site_accent_color === "string") {
    siteAccentColor = settingsRow.site_accent_color;
  }

  const emailPayload = buildBillingEmailPayload(body, {
    organizationName,
    accentColor: siteAccentColor,
  });

  try {
    const result = await dispatchBillingEmail({
      from: billingEmailFrom,
      to,
      email: emailPayload,
    });

    return NextResponse.json({ ok: true, provider: result.provider, id: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar e-mail.";
    return jsonError(message, 502);
  }
}
