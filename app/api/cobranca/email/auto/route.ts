import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildBillingEmailPayload, dispatchBillingEmail } from "@/lib/shad-manager/billing-email-server";

export const runtime = "nodejs";

type NotificationKind = "pre_due_3" | "due_today" | "overdue_followup";

interface InvoiceTarget {
  invoiceId: string;
  organizationId: string;
  studentId: string;
  studentName: string;
  recipientEmail: string;
  dueDate: string;
  openCents: number;
  notificationKey: string;
  notificationKind: NotificationKind;
  daysOffset: number;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseIsoDate(isoDate: string): Date | null {
  const value = isoDate.trim();
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDate(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function dateDiffInDays(from: Date, to: Date): number {
  const fromDate = new Date(from);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(to);
  toDate.setHours(0, 0, 0, 0);
  return Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildNotificationPlan(dueDate: string, today: Date): {
  notificationKind: NotificationKind;
  notificationKey: string;
  daysOffset: number;
} | null {
  const due = parseIsoDate(dueDate);
  if (!due) return null;

  const daysUntilDue = dateDiffInDays(today, due);
  const daysOffset = -daysUntilDue;

  if (daysUntilDue === 3) {
    return {
      notificationKind: "pre_due_3",
      notificationKey: `pre_due_3:${dueDate}`,
      daysOffset,
    };
  }

  if (daysUntilDue === 0) {
    return {
      notificationKind: "due_today",
      notificationKey: `due_today:${dueDate}`,
      daysOffset,
    };
  }

  if (daysUntilDue <= -1) {
    const daysOverdue = Math.abs(daysUntilDue);
    if ((daysOverdue - 1) % 2 === 0) {
      return {
        notificationKind: "overdue_followup",
        notificationKey: `overdue_followup:${dueDate}:d${daysOverdue}`,
        daysOffset,
      };
    }
  }

  return null;
}

function buildAutomationMessage(target: InvoiceTarget): { subject: string; message: string } {
  if (target.notificationKind === "pre_due_3") {
    return {
      subject: `Lembrete de vencimento em 3 dias - ${target.studentName}`,
      message: `Lembrete: sua cobrança vence em 3 dias, no dia ${formatDate(target.dueDate)}.`,
    };
  }

  if (target.notificationKind === "due_today") {
    return {
      subject: `Vencimento hoje - ${target.studentName}`,
      message: `Lembrete: sua cobrança vence hoje (${formatDate(target.dueDate)}).`,
    };
  }

  const daysOverdue = Math.max(1, target.daysOffset);
  return {
    subject: `Cobrança em atraso - ${target.studentName}`,
    message: `Sua cobrança está em atraso há ${daysOverdue} dia${daysOverdue === 1 ? "" : "s"}.`,
  };
}

async function runAutomation(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const billingEmailFrom = process.env.BILLING_EMAIL_FROM;
  const cronSecret = process.env.CRON_SECRET;

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonError("Supabase service role não configurado (SUPABASE_SERVICE_ROLE_KEY).", 500);
  }
  if (!billingEmailFrom) {
    return jsonError("Configuração de e-mail ausente (BILLING_EMAIL_FROM).", 500);
  }
  if (!cronSecret) {
    return jsonError("Configuração ausente (CRON_SECRET).", 500);
  }

  const authHeader = request.headers.get("authorization") || "";
  const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const customSecret = (request.headers.get("x-cron-secret") || "").trim();
  if (bearerSecret !== cronSecret && customSecret !== cronSecret) {
    return jsonError("Não autorizado.", 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: invoiceRows, error: invoiceError } = await supabase
    .from("invoices")
    .select(
      "id, organization_id, student_id, due_date, amount_cents, paid_amount_cents, status, students!inner(full_name, email)"
    )
    .in("status", ["pending", "partial", "overdue"])
    .order("due_date", { ascending: true })
    .limit(5000);

  if (invoiceError) {
    return jsonError(invoiceError.message, 500);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let skippedNoEmail = 0;
  const targets: InvoiceTarget[] = [];

  for (const rawRow of invoiceRows ?? []) {
    const row = rawRow as Record<string, unknown>;
    const dueDate = String(row.due_date ?? "");
    const amountCents = Number(row.amount_cents ?? 0);
    const paidAmountCents = Number(row.paid_amount_cents ?? 0);
    const openCents = Math.max(0, amountCents - paidAmountCents);
    if (!dueDate || openCents <= 0) continue;

    const plan = buildNotificationPlan(dueDate, today);
    if (!plan) continue;

    const studentsRaw = row.students as
      | { full_name?: string | null; email?: string | null }
      | Array<{ full_name?: string | null; email?: string | null }>
      | null
      | undefined;
    const student = Array.isArray(studentsRaw) ? studentsRaw[0] : studentsRaw;

    const recipientEmail = String(student?.email ?? "").trim().toLowerCase();
    if (!isValidEmail(recipientEmail)) {
      skippedNoEmail += 1;
      continue;
    }

    targets.push({
      invoiceId: String(row.id ?? ""),
      organizationId: String(row.organization_id ?? ""),
      studentId: String(row.student_id ?? ""),
      studentName: String(student?.full_name ?? "cliente"),
      recipientEmail,
      dueDate,
      openCents,
      notificationKind: plan.notificationKind,
      notificationKey: plan.notificationKey,
      daysOffset: plan.daysOffset,
    });
  }

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Nenhuma cobrança elegível para envio automático hoje.",
      summary: {
        evaluated: invoiceRows?.length ?? 0,
        eligible: 0,
        skippedNoEmail,
        alreadySent: 0,
        sent: 0,
        failed: 0,
      },
    });
  }

  const invoiceIds = Array.from(new Set(targets.map((target) => target.invoiceId)));
  const { data: sentLogs, error: sentLogsError } = await supabase
    .from("invoice_email_dispatch_logs")
    .select("invoice_id, notification_key")
    .eq("status", "sent")
    .in("invoice_id", invoiceIds);

  if (sentLogsError) {
    return jsonError(sentLogsError.message, 500);
  }

  const sentKeys = new Set(
    (sentLogs ?? []).map((row) => `${String(row.invoice_id)}|${String(row.notification_key)}`)
  );
  const pendingTargets = targets.filter(
    (target) => !sentKeys.has(`${target.invoiceId}|${target.notificationKey}`)
  );
  const alreadySent = targets.length - pendingTargets.length;

  if (pendingTargets.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Todas as notificações elegíveis já foram enviadas hoje.",
      summary: {
        evaluated: invoiceRows?.length ?? 0,
        eligible: targets.length,
        skippedNoEmail,
        alreadySent,
        sent: 0,
        failed: 0,
      },
    });
  }

  const orgIds = Array.from(new Set(pendingTargets.map((target) => target.organizationId)));
  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", orgIds);
  if (organizationsError) {
    return jsonError(organizationsError.message, 500);
  }

  const { data: organizationSettings, error: settingsError } = await supabase
    .from("organization_settings")
    .select("organization_id, site_accent_color")
    .in("organization_id", orgIds);

  if (settingsError) {
    const normalized = settingsError.message.toLowerCase();
    const missingAccentColumn =
      normalized.includes("site_accent_color") && normalized.includes("does not exist");
    if (!missingAccentColumn) {
      return jsonError(settingsError.message, 500);
    }
  }

  const organizationNameById = new Map<string, string>();
  for (const row of organizations ?? []) {
    if (typeof row.id === "string" && typeof row.name === "string") {
      organizationNameById.set(row.id, row.name.trim() || "ShadManager");
    }
  }

  const organizationAccentById = new Map<string, string>();
  for (const row of organizationSettings ?? []) {
    if (typeof row.organization_id === "string" && typeof row.site_accent_color === "string") {
      organizationAccentById.set(row.organization_id, row.site_accent_color);
    }
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const target of pendingTargets) {
    const organizationName = organizationNameById.get(target.organizationId) ?? "ShadManager";
    const accentColor = organizationAccentById.get(target.organizationId) ?? null;
    const automationContent = buildAutomationMessage(target);

    const emailPayload = buildBillingEmailPayload(
      {
        studentName: target.studentName,
        amountCents: target.openCents,
        dueDate: target.dueDate,
        subject: automationContent.subject,
        customMessage: automationContent.message,
      },
      {
        organizationName,
        accentColor,
      }
    );

    try {
      const dispatchResult = await dispatchBillingEmail({
        from: billingEmailFrom,
        to: target.recipientEmail,
        email: emailPayload,
      });

      sentCount += 1;
      await supabase.from("invoice_email_dispatch_logs").insert({
        organization_id: target.organizationId,
        invoice_id: target.invoiceId,
        student_id: target.studentId,
        recipient_email: target.recipientEmail,
        notification_key: target.notificationKey,
        notification_kind: target.notificationKind,
        due_date: target.dueDate,
        days_offset: target.daysOffset,
        status: "sent",
        provider: dispatchResult.provider,
      });
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Falha ao enviar e-mail automático.";
      await supabase.from("invoice_email_dispatch_logs").insert({
        organization_id: target.organizationId,
        invoice_id: target.invoiceId,
        student_id: target.studentId,
        recipient_email: target.recipientEmail,
        notification_key: target.notificationKey,
        notification_kind: target.notificationKind,
        due_date: target.dueDate,
        days_offset: target.daysOffset,
        status: "failed",
        error_message: message.slice(0, 500),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      evaluated: invoiceRows?.length ?? 0,
      eligible: targets.length,
      skippedNoEmail,
      alreadySent,
      sent: sentCount,
      failed: failedCount,
    },
  });
}

export async function GET(request: Request) {
  return runAutomation(request);
}

export async function POST(request: Request) {
  return runAutomation(request);
}
