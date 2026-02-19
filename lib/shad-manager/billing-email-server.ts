import nodemailer from "nodemailer";

export interface BillingEmailInput {
  studentName?: string | null;
  amountCents?: number | null;
  dueDate?: string | null;
  subject?: string | null;
  customMessage?: string | null;
  pixPayload?: string | null;
}

export interface BillingEmailBrandingContext {
  organizationName: string;
  accentColor?: string | null;
}

export interface BuiltBillingEmailPayload {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrency(valueCents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueCents / 100);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function normalizeHexColor(value: string | null | undefined, fallback = "#f07f1d"): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function hexToRgba(hexColor: string, alpha: number): string {
  const safeHex = normalizeHexColor(hexColor).slice(1);
  const r = Number.parseInt(safeHex.slice(0, 2), 16);
  const g = Number.parseInt(safeHex.slice(2, 4), 16);
  const b = Number.parseInt(safeHex.slice(4, 6), 16);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function removeGreetingParagraphs(paragraphs: string[]): string[] {
  return paragraphs.filter((paragraph) => !/^ol[áa]\b[\s\S]*$/i.test(paragraph.trim()));
}

function parseIsoDate(isoDate: string): Date | null {
  const value = isoDate.trim();
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getDueStatusLabel(dueDate: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const days = Math.abs(diffDays);
    return `Atrasada há ${days} dia${days === 1 ? "" : "s"}`;
  }
  if (diffDays === 0) {
    return "Vence hoje";
  }
  return `Vence em ${diffDays} dia${diffDays === 1 ? "" : "s"}`;
}

export function buildBillingEmailPayload(
  input: BillingEmailInput,
  branding: BillingEmailBrandingContext
): BuiltBillingEmailPayload {
  const studentName = input.studentName?.trim() || "cliente";
  const organizationName = branding.organizationName.trim() || "ShadManager";
  const accentColor = normalizeHexColor(branding.accentColor);
  const accentSoft = hexToRgba(accentColor, 0.1);
  const accentMid = hexToRgba(accentColor, 0.22);
  const todayLabel = formatDate(new Date());

  const hasAmount = Number.isFinite(input.amountCents) && Number(input.amountCents) > 0;
  const amountLabel = hasAmount ? formatCurrency(Number(input.amountCents)) : null;
  const dueDate = input.dueDate?.trim() ? parseIsoDate(input.dueDate.trim()) : null;
  const dueDateLabel = dueDate ? formatDate(dueDate) : null;
  const dueStatusLabel = dueDate ? getDueStatusLabel(dueDate) : null;
  const pixPayload = input.pixPayload?.trim() || null;

  const subject =
    input.subject?.trim() ||
    (dueDateLabel ? `Lembrete de cobrança - vencimento ${dueDateLabel}` : `Lembrete de cobrança para ${studentName}`);

  const fallbackMessage = [
    hasAmount ? `Identificamos um valor em aberto de ${amountLabel} para ${studentName}.` : "Identificamos uma cobrança em aberto.",
    dueDateLabel ? `Vencimento: ${dueDateLabel}.` : "",
    "Se você já realizou o pagamento, desconsidere este e-mail.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const message = input.customMessage?.trim() || fallbackMessage;
  const messageParagraphs = removeGreetingParagraphs(
    message
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
  );

  const amountSummary = amountLabel ?? "Não informado";
  const dueSummary = dueDateLabel ?? "Não informado";
  const dueStatusSummary = dueStatusLabel ?? "Sem data de vencimento";
  const dueBadgeBg = dueStatusLabel?.startsWith("Atrasada")
    ? "#fee2e2"
    : dueStatusLabel === "Vence hoje"
      ? "#fef3c7"
      : "#dcfce7";
  const dueBadgeColor = dueStatusLabel?.startsWith("Atrasada")
    ? "#991b1b"
    : dueStatusLabel === "Vence hoje"
      ? "#92400e"
      : "#166534";

  const htmlMessage = messageParagraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 12px; font-size: 15px; line-height: 1.65; color: #334155;">${escapeHtml(paragraph)}</p>`
    )
    .join("");
  const htmlMessageSection = htmlMessage
    ? `<div style="border-top: 1px solid #e2e8f0; margin: 16px 0; padding-top: 16px;">
         ${htmlMessage}
       </div>`
    : "";

  const pixSection = pixPayload
    ? `<div style="margin-top: 20px; border: 1px dashed #cbd5e1; border-radius: 12px; background: #f8fafc; padding: 14px;">
        <p style="margin: 0 0 8px; font-size: 13px; color: #334155; font-weight: 700;">PIX copia e cola</p>
        <pre style="margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.6; color: #0f172a;">${escapeHtml(
          pixPayload
        )}</pre>
      </div>`
    : "";

  const statusCardBg = dueStatusLabel?.startsWith("Atrasada")
    ? "#fef2f2"
    : dueStatusLabel === "Vence hoje"
      ? "#fffbeb"
      : "#f0fdf4";
  const statusCardBorder = dueStatusLabel?.startsWith("Atrasada")
    ? "#fecaca"
    : dueStatusLabel === "Vence hoje"
      ? "#fde68a"
      : "#bbf7d0";

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin: 0; padding: 20px; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto; border-collapse: collapse;">
      <tr>
        <td style="background: linear-gradient(125deg, ${accentColor} 0%, #0f172a 75%); padding: 22px 24px; border-radius: 16px 16px 0 0;">
          <p style="margin: 0; font-size: 11px; letter-spacing: 0.06em; color: #dbeafe; text-transform: uppercase; text-align: right;">Aviso financeiro</p>
          <p style="margin: 6px 0 0; font-size: 15px; font-weight: 700; color: #ffffff; text-align: right;">${escapeHtml(
            organizationName
          )}</p>
        </td>
      </tr>
      <tr>
        <td style="background: #ffffff; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 16px 16px; padding: 24px;">
          <div style="margin-bottom: 16px; padding: 14px 16px; border-radius: 12px; border: 1px solid ${accentMid}; background: ${accentSoft};">
            <p style="margin: 0; font-size: 13px; color: #334155;">
              Este é um comunicado automático do financeiro da <strong>${escapeHtml(
                organizationName
              )}</strong>.
            </p>
          </div>

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: separate; border-spacing: 0 10px;">
            <tr>
              <td style="padding: 0;">
                <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px;">
                  <p style="margin: 0 0 6px; font-size: 12px; color: #64748b;">Cliente</p>
                  <p style="margin: 0; font-size: 16px; color: #0f172a; font-weight: 700;">${escapeHtml(
                    studentName
                  )}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 0;">
                <div style="border: 1px solid #fed7aa; background: #fff7ed; border-radius: 12px; padding: 12px 14px;">
                  <p style="margin: 0 0 6px; font-size: 12px; color: #9a3412;">Valor em aberto</p>
                  <p style="margin: 0; font-size: 26px; line-height: 1.2; color: #9a3412; font-weight: 800;">${escapeHtml(
                    amountSummary
                  )}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 0;">
                <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px;">
                  <p style="margin: 0 0 6px; font-size: 12px; color: #64748b;">Vencimento</p>
                  <p style="margin: 0 0 10px; font-size: 16px; color: #0f172a; font-weight: 700;">${escapeHtml(
                    dueSummary
                  )}</p>
                  <span style="display: inline-block; padding: 5px 10px; border-radius: 999px; background: ${dueBadgeBg}; color: ${dueBadgeColor}; font-size: 12px; font-weight: 700;">
                    ${escapeHtml(dueStatusSummary)}
                  </span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 0;">
                <div style="border: 1px solid ${statusCardBorder}; background: ${statusCardBg}; border-radius: 12px; padding: 12px 14px;">
                  <p style="margin: 0; font-size: 13px; color: #334155;">
                    Caso já tenha efetuado o pagamento, desconsidere este aviso. Se precisar de suporte, responda este e-mail.
                  </p>
                </div>
              </td>
            </tr>
          </table>

          ${htmlMessageSection}
          ${pixSection}
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 20px; border-collapse: collapse;">
            <tr>
              <td style="padding-top: 12px; border-top: 1px solid #e2e8f0;">
                <p style="margin: 0; font-size: 12px; color: #64748b;">${escapeHtml(
                  organizationName
                )} • Emitido em ${escapeHtml(todayLabel)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const plainMessage = messageParagraphs.join("\n\n").trim();

  const textLines = [
    `${organizationName} - Aviso de cobrança`,
    `Emitido em: ${todayLabel}`,
    "",
    `Cliente: ${studentName}`,
    `Valor em aberto: ${amountSummary}`,
    `Vencimento: ${dueSummary}`,
    `Status: ${dueStatusSummary}`,
  ];
  if (plainMessage) {
    textLines.push("", plainMessage);
  }
  if (pixPayload) {
    textLines.push("", "PIX copia e cola:", pixPayload);
  }

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}

async function sendWithResend(args: {
  apiKey: string;
  from: string;
  to: string;
  email: BuiltBillingEmailPayload;
}): Promise<{ id: string | null }> {
  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.email.subject,
      html: args.email.html,
      text: args.email.text,
    }),
  });

  const resendJson = (await resendResponse.json().catch(() => null)) as
    | { id?: string; message?: string; error?: { message?: string } }
    | null;

  if (!resendResponse.ok) {
    throw new Error(resendJson?.error?.message || resendJson?.message || "Falha ao enviar e-mail.");
  }

  return { id: resendJson?.id ?? null };
}

async function sendWithSmtp(args: {
  from: string;
  to: string;
  email: BuiltBillingEmailPayload;
}): Promise<{ id: string | null }> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    throw new Error("SMTP_USER e SMTP_PASS são obrigatórios para envio SMTP.");
  }

  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || "465");
  const smtpSecureRaw = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  const smtpSecure =
    smtpSecureRaw === "true" || smtpSecureRaw === "1" || smtpSecureRaw === "yes"
      ? true
      : smtpSecureRaw === "false" || smtpSecureRaw === "0" || smtpSecureRaw === "no"
        ? false
        : smtpPort === 465;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const info = await transporter.sendMail({
    from: args.from,
    to: args.to,
    subject: args.email.subject,
    html: args.email.html,
    text: args.email.text,
  });

  return { id: info.messageId || null };
}

export async function dispatchBillingEmail(args: {
  from: string;
  to: string;
  email: BuiltBillingEmailPayload;
}): Promise<{ provider: "resend" | "smtp"; id: string | null }> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const hasSmtpConfig = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

  if (resendApiKey) {
    const result = await sendWithResend({
      apiKey: resendApiKey,
      from: args.from,
      to: args.to,
      email: args.email,
    });
    return { provider: "resend", id: result.id };
  }

  if (hasSmtpConfig) {
    const result = await sendWithSmtp({
      from: args.from,
      to: args.to,
      email: args.email,
    });
    return { provider: "smtp", id: result.id };
  }

  throw new Error("Configure RESEND_API_KEY ou SMTP_USER/SMTP_PASS para habilitar envio de e-mail.");
}
