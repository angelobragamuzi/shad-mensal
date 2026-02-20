import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildBillingEmailPayload,
  dispatchBillingEmail,
  type BillingEmailInput,
} from "@/lib/shad-manager/billing-email-server";
import {
  buildPixPayloadFromOption,
  buildPixQrCodeDataUrl,
  parsePixPaymentOption,
} from "@/lib/shad-manager/pix-payment-option";

export const runtime = "nodejs";

interface SendChargeEmailBody extends BillingEmailInput {
  organizationId: string;
  to: string;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parsePositiveCents(value: unknown): number | null {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;

  if (/^https?:\/\//i.test(normalized)) {
    return normalized.replace(/\/+$/, "");
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(normalized)) {
    return `https://${normalized}`.replace(/\/+$/, "");
  }

  return null;
}

function resolvePublicAppUrl(): string | null {
  const explicitUrl =
    process.env.BILLING_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const normalizedExplicit = normalizeBaseUrl(explicitUrl);
  if (normalizedExplicit) return normalizedExplicit;

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return normalizeBaseUrl(vercelUrl);
}

function buildPixCopyUrl(pixPayload: string): string | null {
  const appUrl = resolvePublicAppUrl();
  if (!appUrl) return null;
  return `${appUrl}/pix/copiar?code=${encodeURIComponent(pixPayload)}`;
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
  let organizationSettingsRow: Record<string, unknown> | null = null;

  const { data: organizationRow } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationRow?.name && typeof organizationRow.name === "string") {
    organizationName = organizationRow.name.trim() || organizationName;
  }

  const settingsColumns =
    "site_accent_color, pix_payment_enabled, pix_key, pix_merchant_name, pix_merchant_city, pix_description, pix_txid, pix_saved_payload, pix_saved_qr_image_data_url";
  const settingsResponse = await supabase
    .from("organization_settings")
    .select(settingsColumns)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (settingsResponse.error) {
    const normalized = settingsResponse.error.message.toLowerCase();
    const missingPixColumns = normalized.includes("pix_") && normalized.includes("does not exist");
    if (missingPixColumns) {
      const fallbackResponse = await supabase
        .from("organization_settings")
        .select("site_accent_color")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!fallbackResponse.error) {
        organizationSettingsRow = (fallbackResponse.data ?? null) as Record<string, unknown> | null;
      }
    }
  } else {
    organizationSettingsRow = (settingsResponse.data ?? null) as Record<string, unknown> | null;
  }

  if (organizationSettingsRow && typeof organizationSettingsRow.site_accent_color === "string") {
    siteAccentColor = organizationSettingsRow.site_accent_color;
  }

  try {
    const amountCents = parsePositiveCents(body.amountCents);
    const pixOption = parsePixPaymentOption(organizationSettingsRow);

    let pixPayload = body.pixPayload?.trim() || null;
    let pixQrCodeDataUrl: string | null = null;

    if (!pixPayload && pixOption) {
      if (amountCents) {
        pixPayload = buildPixPayloadFromOption(pixOption, amountCents);
        pixQrCodeDataUrl = await buildPixQrCodeDataUrl(pixPayload);
      } else {
        pixPayload = buildPixPayloadFromOption(pixOption);
        pixQrCodeDataUrl = pixOption.savedQrCodeDataUrl;
      }
    }

    if (pixPayload && !pixQrCodeDataUrl) {
      pixQrCodeDataUrl = await buildPixQrCodeDataUrl(pixPayload);
    }
    const pixCopyUrl = pixPayload ? buildPixCopyUrl(pixPayload) : null;

    const emailPayload = buildBillingEmailPayload(
      {
        ...body,
        amountCents,
        pixPayload,
        pixQrCodeDataUrl,
        pixCopyUrl,
      },
      {
        organizationName,
        accentColor: siteAccentColor,
      }
    );

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
