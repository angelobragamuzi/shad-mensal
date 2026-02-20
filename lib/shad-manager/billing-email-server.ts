import nodemailer from "nodemailer";

export interface BillingEmailInput {
  studentName?: string | null;
  amountCents?: number | null;
  dueDate?: string | null;
  subject?: string | null;
  customMessage?: string | null;
  pixPayload?: string | null;
  pixQrCodeDataUrl?: string | null;
  pixCopyUrl?: string | null;
}

export interface BillingEmailBrandingContext {
  organizationName: string;
  accentColor?: string | null;
}

export interface BuiltBillingEmailPayload {
  subject: string;
  html: string;
  text: string;
  attachments: BillingEmailAttachment[];
}

export interface BillingEmailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
  cid?: string;
}

interface ParsedInlineImage {
  mimeType: string;
  base64Content: string;
  fileExtension: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePixQrCodeDataUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  return /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(normalized)
    ? normalized
    : null;
}

function parsePixQrCodeDataUrl(value: string | null | undefined): ParsedInlineImage | null {
  const normalized = normalizePixQrCodeDataUrl(value);
  if (!normalized) return null;

  const match = normalized.match(
    /^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([a-z0-9+/=\r\n]+)$/i
  );
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const base64Content = match[2].replace(/\s+/g, "");
  if (!base64Content) return null;

  const fileExtension =
    mimeType === "image/jpeg" || mimeType === "image/jpg"
      ? "jpg"
      : mimeType === "image/svg+xml"
        ? "svg"
        : mimeType.split("/")[1] ?? "png";

  return {
    mimeType,
    base64Content,
    fileExtension,
  };
}

function normalizePixCopyUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  return /^https?:\/\/[^\s]+$/i.test(normalized) ? normalized : null;
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

function removeGreetingParagraphs(paragraphs: string[]): string[] {
  return paragraphs.filter((paragraph) => {
    const normalized = paragraph
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return !/^ola\b/.test(normalized);
  });
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
    return `Atrasada ha ${days} dia${days === 1 ? "" : "s"}`;
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
  const todayLabel = formatDate(new Date());

  const hasAmount = Number.isFinite(input.amountCents) && Number(input.amountCents) > 0;
  const amountLabel = hasAmount ? formatCurrency(Number(input.amountCents)) : null;
  const dueDate = input.dueDate?.trim() ? parseIsoDate(input.dueDate.trim()) : null;
  const dueDateLabel = dueDate ? formatDate(dueDate) : null;
  const dueStatusLabel = dueDate ? getDueStatusLabel(dueDate) : null;
  const pixPayload = input.pixPayload?.trim() || null;
  const pixQrCodeImage = parsePixQrCodeDataUrl(input.pixQrCodeDataUrl);
  const pixCopyUrl = normalizePixCopyUrl(input.pixCopyUrl);
  const pixQrCodeCid = pixQrCodeImage ? "pix-qrcode-inline" : null;

  const subject =
    input.subject?.trim() ||
    (dueDateLabel ? `Lembrete de cobranca - vencimento ${dueDateLabel}` : `Lembrete de cobranca para ${studentName}`);

  const fallbackMessage = [
    hasAmount ? `Identificamos um valor em aberto de ${amountLabel} para ${studentName}.` : "Identificamos uma cobranca em aberto.",
    dueDateLabel ? `Vencimento: ${dueDateLabel}.` : "",
    "Se voce ja realizou o pagamento, desconsidere este e-mail.",
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

  const amountSummary = amountLabel ?? "Nao informado";
  const dueSummary = dueDateLabel ?? "Nao informado";
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

  const noticeDate = new Date();
  const issueDateStamp = noticeDate.toISOString().slice(0, 10).replaceAll("-", "");
  const noticeNumber = `CBR-${issueDateStamp}-${Math.floor(Math.random() * 9000 + 1000)}`;

  const htmlMessage = messageParagraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 10px; font-size: 14px; line-height: 1.65; color: #334155;">${escapeHtml(paragraph)}</p>`
    )
    .join("");
  const htmlMessageSection = htmlMessage
    ? `<div style="margin-top: 18px; padding: 16px; border: 1px solid #d1d5db; border-left: 4px solid ${accentColor}; border-radius: 8px; background: #f8fafc;">
         <p style="margin: 0 0 10px; font-size: 12px; letter-spacing: 0.06em; color: #475569; text-transform: uppercase; font-weight: 700;">
           Mensagem do financeiro
         </p>
         ${htmlMessage}
       </div>`
    : "";

  const pixImageBlock = pixQrCodeCid
    ? `<div style="margin: 0 0 12px; text-align: center;">
        <img src="cid:${escapeHtml(
          pixQrCodeCid
        )}" alt="QR Code PIX" width="220" height="220" style="display: inline-block; width: 220px; height: 220px; border-radius: 8px; border: 1px solid #d1d5db; background: #ffffff; padding: 8px;" />
      </div>`
    : "";

  const pixCopyButtonBlock = pixPayload && pixCopyUrl
    ? `<div style="margin: 0 0 12px;">
        <a href="${escapeHtml(
          pixCopyUrl
        )}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: ${accentColor}; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 10px 14px; border-radius: 8px;">
          Copiar codigo PIX
        </a>
        <p style="margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: #475569;">
          O botao abre uma pagina para copiar o codigo automaticamente.
        </p>
      </div>`
    : "";

  const pixSection = pixPayload || pixImageBlock
    ? `<div style="margin-top: 20px; border: 1px solid #d1d5db; border-radius: 8px; background: #f8fafc; padding: 16px;">
        <p style="margin: 0 0 6px; font-size: 12px; letter-spacing: 0.06em; color: #475569; text-transform: uppercase; font-weight: 700;">
          Pagamento via PIX
        </p>
        <p style="margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: #334155;">
          Utilize o QR Code ou o codigo copia e cola abaixo para concluir o pagamento.
        </p>
        ${pixImageBlock}
        ${pixCopyButtonBlock}
        ${
          pixPayload
            ? `<p style="margin: 0 0 8px; font-size: 13px; color: #334155; font-weight: 700;">PIX copia e cola</p>
        <pre style="margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.6; color: #0f172a;">${escapeHtml(
          pixPayload
        )}</pre>`
            : ""
        }
      </div>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin: 0; padding: 0; background: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
      <tr>
        <td style="padding: 24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 680px; margin: 0 auto; border-collapse: collapse; background: #ffffff; border: 1px solid #d1d5db; border-radius: 10px; overflow: hidden;">
            <tr>
              <td style="background: #0f172a; padding: 18px 22px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                  <tr>
                    <td style="vertical-align: top;">
                      <p style="margin: 0; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8;">Departamento financeiro</p>
                      <p style="margin: 6px 0 0; font-size: 17px; font-weight: 700; color: #ffffff;">${escapeHtml(
                        organizationName
                      )}</p>
                    </td>
                    <td align="right" style="vertical-align: top;">
                      <p style="margin: 0; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #cbd5e1;">Aviso de cobranca</p>
                      <p style="margin: 6px 0 0; font-size: 13px; font-weight: 600; color: #ffffff;">${escapeHtml(
                        noticeNumber
                      )}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="height: 4px; background: ${accentColor}; font-size: 0; line-height: 0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding: 22px;">
                <p style="margin: 0 0 14px; font-size: 13px; line-height: 1.7; color: #334155;">
                  Este e-mail formaliza uma cobranca pendente em nome de <strong>${escapeHtml(
                    studentName
                  )}</strong>.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border: 1px solid #d1d5db; border-radius: 8px; overflow: hidden;">
                  <tr>
                    <td style="padding: 12px 14px; width: 40%; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #64748b;">Cliente</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(
                      studentName
                    )}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 14px; width: 40%; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #64748b;">Valor em aberto</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-size: 27px; font-weight: 800; line-height: 1.2; color: #0f172a;">${escapeHtml(
                      amountSummary
                    )}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 14px; width: 40%; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #64748b;">Vencimento</td>
                    <td style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(
                      dueSummary
                    )}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 14px; width: 40%; font-size: 12px; color: #64748b;">Status</td>
                    <td style="padding: 12px 14px;">
                      <span style="display: inline-block; padding: 5px 10px; border-radius: 999px; background: ${dueBadgeBg}; color: ${dueBadgeColor}; font-size: 12px; font-weight: 700;">
                        ${escapeHtml(dueStatusSummary)}
                      </span>
                    </td>
                  </tr>
                </table>

                ${htmlMessageSection}
                ${pixSection}

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 20px; border-collapse: collapse;">
                  <tr>
                    <td style="padding-top: 14px; border-top: 1px solid #e5e7eb;">
                      <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #475569;">
                        Caso o pagamento ja tenha sido realizado, desconsidere este aviso.
                      </p>
                      <p style="margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: #475569;">
                        Para suporte, responda este e-mail diretamente.
                      </p>
                      <p style="margin: 8px 0 0; font-size: 11px; color: #6b7280;">
                        ${escapeHtml(organizationName)} | Emitido em ${escapeHtml(todayLabel)}
                      </p>
                    </td>
                  </tr>
                </table>
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
    `${organizationName} - Aviso de cobranca`,
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
    if (pixCopyUrl) {
      textLines.push("Link para copiar: " + pixCopyUrl);
    }
  }

  const attachments: BillingEmailAttachment[] = [];
  if (pixQrCodeImage && pixQrCodeCid) {
    attachments.push({
      filename: `pix-qrcode.${pixQrCodeImage.fileExtension}`,
      contentType: pixQrCodeImage.mimeType,
      contentBase64: pixQrCodeImage.base64Content,
      cid: pixQrCodeCid,
    });
  }

  return {
    subject,
    html,
    text: textLines.join("\n"),
    attachments,
  };
}

async function sendWithResend(args: {
  apiKey: string;
  from: string;
  to: string;
  email: BuiltBillingEmailPayload;
}): Promise<{ id: string | null }> {
  const resendAttachments =
    args.email.attachments.length > 0
      ? args.email.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.contentBase64,
          content_type: attachment.contentType,
          ...(attachment.cid ? { content_id: attachment.cid } : {}),
        }))
      : undefined;

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
      attachments: resendAttachments,
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
    throw new Error("SMTP_USER e SMTP_PASS sao obrigatorios para envio SMTP.");
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
    attachments: args.email.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.contentBase64,
      encoding: "base64",
      contentType: attachment.contentType,
      cid: attachment.cid,
    })),
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
