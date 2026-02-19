"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Copy, Download, KeyRound, Mail, MessageCircle, QrCode, Wallet } from "lucide-react";
import { buildPixPayload } from "@/lib/shad-manager/pix";
import { emitSessionNotification } from "@/lib/shad-manager/session-notifications";
import { getUserOrgContext } from "@/lib/supabase/auth-org";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

interface ShareClient {
  id: string;
  name: string;
  phone: string;
  email: string;
}

interface TemplateSettingsRow {
  organization_id: string;
  qr_template_logo_url: string | null;
  whatsapp_template: string | null;
}

type PaymentMethod = "pix" | "cash" | "card" | "transfer" | "other";

interface FinancialInvoiceRow {
  id: string;
  student_id: string;
  due_date: string;
  amount_cents: number;
  paid_amount_cents: number;
  status: "pending" | "partial" | "paid" | "overdue" | "canceled";
}

interface FinancialPaymentRow {
  id: string;
  student_id: string;
  invoice_id: string;
  amount_cents: number;
  method: PaymentMethod;
  paid_at: string;
  notes: string | null;
  receipt_url?: string | null;
  receipt_file_name?: string | null;
}

interface OpenInvoiceItem {
  id: string;
  studentId: string;
  studentName: string;
  dueDate: string;
  totalCents: number;
  paidCents: number;
  openCents: number;
  status: FinancialInvoiceRow["status"];
}

interface MonthlyReportData {
  payments: Array<
    FinancialPaymentRow & {
      studentName: string;
    }
  >;
  pendingInvoices: Array<
    OpenInvoiceItem & {
      bucket: "pending" | "overdue";
    }
  >;
}

type ReceiptPreviewKind = "image" | "pdf" | "unknown";

interface ReceiptPreviewState {
  paymentId: string;
  fileName: string;
  url: string;
  kind: ReceiptPreviewKind;
}

interface CollectionOverviewMetrics {
  totalOpenCount: number;
  totalOpenCents: number;
  overdueCount: number;
  overdueCents: number;
  dueTodayCount: number;
  dueTodayCents: number;
  dueNext7Count: number;
  dueNext7Cents: number;
}

interface FollowUpInvoiceItem {
  invoiceId: string;
  studentId: string;
  studentName: string;
  studentPhone: string;
  studentEmail: string;
  dueDate: string;
  openCents: number;
  status: FinancialInvoiceRow["status"];
}

type CobrancasViewMode = "pix" | "operacao" | "baixas" | "relatorios";

interface CobrancasViewProps {
  mode?: CobrancasViewMode;
}

const DEFAULT_WHATSAPP_TEMPLATE =
  "Ola {{student_name}}, sua mensalidade esta em aberto. Podemos regularizar hoje?";

function normalizeWhatsappPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return null;
}

function buildWhatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function formatDateTime(dateTime: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateTime));
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildCollectionMessage(
  template: string,
  input: { studentName: string; amountCents: number; dueDate: string; daysOverdue: number }
): string {
  return template
    .replaceAll("{{student_name}}", input.studentName)
    .replaceAll("{{amount}}", formatCurrency(input.amountCents))
    .replaceAll("{{due_date}}", formatDate(input.dueDate))
    .replaceAll("{{days_overdue}}", String(Math.max(input.daysOverdue, 0)));
}

function detectReceiptPreviewKind(receiptUrl: string, fileName?: string | null): ReceiptPreviewKind {
  const normalizedUrl = receiptUrl.trim().toLowerCase();
  const normalizedFileName = fileName?.trim().toLowerCase() ?? "";

  if (!normalizedUrl) return "unknown";

  if (normalizedUrl.startsWith("data:")) {
    const mimeMatch = /^data:([^;,]+)[;,]/i.exec(normalizedUrl);
    const mimeType = mimeMatch?.[1] ?? "";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType === "application/pdf") return "pdf";
    return "unknown";
  }

  const source = normalizedFileName || normalizedUrl;
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|#|$)/.test(source)) return "image";
  if (/\.(pdf)(\?|#|$)/.test(source)) return "pdf";

  return "unknown";
}

function formatReferenceMonth(value: string): string {
  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month || month < 1 || month > 12) {
    return value;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function escapeCsv(value: string): string {
  if (value.includes(";") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseAmountToCents(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function buildMonthRange(referenceMonth: string) {
  const [yearText, monthText] = referenceMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || !month || month < 1 || month > 12) {
    const now = new Date();
    const fallbackMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return buildMonthRange(fallbackMonth);
  }

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(year, month, 1);
  const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  return { start, nextMonth };
}

function methodLabel(method: PaymentMethod): string {
  if (method === "cash") return "Dinheiro";
  if (method === "card") return "Cartão";
  if (method === "transfer") return "Transferência";
  if (method === "other") return "Outro";
  return "PIX";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Falha ao carregar imagem do QR Code."));
    image.src = src;
  });
}

interface RenderImageOptions {
  fit?: "contain" | "cover";
  positionX?: "left" | "center" | "right";
  positionY?: "top" | "center" | "bottom";
  background?: string | null;
}

async function renderImageAsPngDataUrl(
  src: string,
  maxWidth = 360,
  maxHeight = 100,
  options: RenderImageOptions = {}
): Promise<string> {
  const image = await loadImage(src);
  const sourceWidth = image.naturalWidth || maxWidth;
  const sourceHeight = image.naturalHeight || maxHeight;
  const fit = options.fit ?? "contain";
  const scale =
    fit === "cover"
      ? Math.max(maxWidth / sourceWidth, maxHeight / sourceHeight)
      : Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);

  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(maxWidth));
  canvas.height = Math.max(1, Math.round(maxHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Não foi possível preparar a imagem.");
  }

  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const positionX = options.positionX ?? "center";
  const positionY = options.positionY ?? "center";

  const drawX =
    positionX === "left"
      ? 0
      : positionX === "right"
        ? canvas.width - drawWidth
        : (canvas.width - drawWidth) / 2;
  const drawY =
    positionY === "top"
      ? 0
      : positionY === "bottom"
        ? canvas.height - drawHeight
        : (canvas.height - drawHeight) / 2;

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  return canvas.toDataURL("image/png");
}

interface RenderQrTemplateInput {
  qrCodeDataUrl: string;
  templateLogoUrl: string;
  merchantName: string;
  merchantCity: string;
  amount: string;
  selectedClientName?: string;
}

async function renderQrTemplateDataUrl(input: RenderQrTemplateInput): Promise<string> {
  const rootStyles = getComputedStyle(document.documentElement);
  const background = rootStyles.getPropertyValue("--background").trim() || "#f2f2f2";
  const card = rootStyles.getPropertyValue("--card").trim() || "#ffffff";
  const border = rootStyles.getPropertyValue("--border").trim() || "#d8d8d8";
  const foregroundStrong = rootStyles.getPropertyValue("--foreground-strong").trim() || "#0d0d0d";
  const muted = rootStyles.getPropertyValue("--muted").trim() || "#616161";
  const accent = rootStyles.getPropertyValue("--accent").trim() || "#f07f1d";
  const placeName = input.merchantName.trim() || "Shad Manager";

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Não foi possível preparar o template.");
  }

  const gradient = ctx.createLinearGradient(0, 0, 1080, 1440);
  gradient.addColorStop(0, background);
  gradient.addColorStop(1, card);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.strokeStyle = border;
  ctx.globalAlpha = 0.12;
  for (let x = 0; x <= canvas.width; x += 54) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 54) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();

  const cardX = 90;
  const cardY = 110;
  const cardWidth = 900;
  const cardHeight = 1220;

  drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 40);
  ctx.fillStyle = card;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = border;
  ctx.stroke();

  drawRoundedRect(ctx, cardX, cardY, cardWidth, 14, 8);
  ctx.fillStyle = accent;
  ctx.fill();

  ctx.fillStyle = foregroundStrong;
  ctx.font = "700 52px Sora, Segoe UI, sans-serif";
  ctx.fillText("Cobrança PIX", cardX + 54, cardY + 96);

  ctx.fillStyle = muted;
  ctx.font = "500 30px Sora, Segoe UI, sans-serif";
  const clientLabel = input.selectedClientName
    ? `Cliente: ${input.selectedClientName}`
    : "Cliente: não informado";
  ctx.fillText(clientLabel, cardX + 54, cardY + 150);

  const customLogo = input.templateLogoUrl.trim();
  if (customLogo) {
    try {
      const logoImage = await loadImage(customLogo);
      const logoSize = 120;
      const logoX = cardX + cardWidth - logoSize - 54;
      const logoY = cardY + 48;

      drawRoundedRect(ctx, logoX - 8, logoY - 8, logoSize + 16, logoSize + 16, 18);
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
    } catch {
      // Keep template generation running even if logo URL is unreachable.
    }
  }

  if (input.amount.trim()) {
    ctx.fillStyle = foregroundStrong;
    ctx.font = "700 46px Sora, Segoe UI, sans-serif";
    ctx.fillText(`R$ ${input.amount.trim()}`, cardX + 54, cardY + 218);
  }

  const qrContainerSize = 640;
  const qrContainerX = cardX + (cardWidth - qrContainerSize) / 2;
  const qrContainerY = cardY + 260;

  drawRoundedRect(ctx, qrContainerX, qrContainerY, qrContainerSize, qrContainerSize, 28);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const qrImage = await loadImage(input.qrCodeDataUrl);
  const qrSize = 560;
  const qrX = qrContainerX + (qrContainerSize - qrSize) / 2;
  const qrY = qrContainerY + (qrContainerSize - qrSize) / 2;
  ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = foregroundStrong;
  ctx.font = "600 34px Sora, Segoe UI, sans-serif";
  ctx.fillText("Escaneie para pagar", cardX + 54, qrContainerY + qrContainerSize + 78);

  ctx.fillStyle = muted;
  ctx.font = "500 25px Sora, Segoe UI, sans-serif";
  const cityLine = `Recebedor: ${placeName} • ${input.merchantCity}`;
  ctx.fillText(cityLine, cardX + 54, qrContainerY + qrContainerSize + 126);

  ctx.font = "500 20px Sora, Segoe UI, sans-serif";
  const generatedAt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  ctx.fillText(`Gerado em ${generatedAt}`, cardX + 54, cardY + cardHeight - 72);

  return canvas.toDataURL("image/png");
}

export function CobrancasView({ mode = "pix" }: CobrancasViewProps) {
  const [pixKey, setPixKey] = useState("");
  const [amount, setAmount] = useState("");
  const [merchantName, setMerchantName] = useState("Shad Manager");
  const [merchantCity, setMerchantCity] = useState("São Paulo");
  const [txid, setTxid] = useState("SHADMENSAL");
  const [description, setDescription] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isBuildingQrCode, setIsBuildingQrCode] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [clients, setClients] = useState<ShareClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [templateLogoUrl, setTemplateLogoUrl] = useState("");
  const [whatsappTemplate, setWhatsappTemplate] = useState(DEFAULT_WHATSAPP_TEMPLATE);
  const [isLoadingTemplateSettings, setIsLoadingTemplateSettings] = useState(true);
  const [isSavingTemplateSettings, setIsSavingTemplateSettings] = useState(false);
  const [isLogoColumnAvailable, setIsLogoColumnAvailable] = useState(true);
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string | null>(null);
  const [isBuildingTemplatePreview, setIsBuildingTemplatePreview] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [referenceMonth, setReferenceMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [generationMonth, setGenerationMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceItem[]>([]);
  const [followUpInvoices, setFollowUpInvoices] = useState<FollowUpInvoiceItem[]>([]);
  const [collectionOverview, setCollectionOverview] = useState<CollectionOverviewMetrics>({
    totalOpenCount: 0,
    totalOpenCents: 0,
    overdueCount: 0,
    overdueCents: 0,
    dueTodayCount: 0,
    dueTodayCents: 0,
    dueNext7Count: 0,
    dueNext7Cents: 0,
  });
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReportData>({
    payments: [],
    pendingInvoices: [],
  });
  const [isLoadingCollectionOperations, setIsLoadingCollectionOperations] = useState(true);
  const [isGeneratingInvoices, setIsGeneratingInvoices] = useState(false);
  const [isMarkingOverdue, setIsMarkingOverdue] = useState(false);
  const [isSendingPixEmail, setIsSendingPixEmail] = useState(false);
  const [isSendingFollowUpEmailId, setIsSendingFollowUpEmailId] = useState<string | null>(null);
  const [isSendingFollowUpEmailsBatch, setIsSendingFollowUpEmailsBatch] = useState(false);
  const [showFollowUpBatchEmailModal, setShowFollowUpBatchEmailModal] = useState(false);
  const [isLoadingFinance, setIsLoadingFinance] = useState(true);
  const [isLoadingMonthlyReport, setIsLoadingMonthlyReport] = useState(true);
  const [isReceiptColumnAvailable, setIsReceiptColumnAvailable] = useState(true);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [settlementAmount, setSettlementAmount] = useState("");
  const [settlementMethod, setSettlementMethod] = useState<PaymentMethod>("pix");
  const [settlementNotes, setSettlementNotes] = useState("");
  const [receiptDataUrl, setReceiptDataUrl] = useState("");
  const [receiptFileName, setReceiptFileName] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreviewState | null>(null);
  const [isSettlingInvoice, setIsSettlingInvoice] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const showPix = mode === "pix";
  const showOperacao = mode === "operacao";
  const showBaixas = mode === "baixas";
  const showRelatorios = mode === "relatorios";

  const payloadResult = useMemo(() => {
    if (!pixKey.trim()) {
      return { payload: "", error: null as string | null };
    }

    try {
      return {
        payload: buildPixPayload({
          key: pixKey,
          amount,
          merchantName,
          merchantCity,
          txid,
          description,
        }),
        error: null as string | null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao gerar o código PIX.";
      return { payload: "", error: message };
    }
  }, [amount, description, merchantCity, merchantName, pixKey, txid]);

  const pixPayload = payloadResult.payload;
  const payloadError = payloadResult.error;
  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );
  const selectedSettlementInvoice = useMemo(
    () => openInvoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
    [openInvoices, selectedInvoiceId]
  );
  const monthlySummary = useMemo(() => {
    const receivedCents = monthlyReport.payments.reduce((total, item) => total + item.amount_cents, 0);
    const pendingCents = monthlyReport.pendingInvoices
      .filter((item) => item.bucket === "pending")
      .reduce((total, item) => total + item.openCents, 0);
    const overdueCents = monthlyReport.pendingInvoices
      .filter((item) => item.bucket === "overdue")
      .reduce((total, item) => total + item.openCents, 0);
    return {
      receivedCents,
      pendingCents,
      overdueCents,
    };
  }, [monthlyReport]);
  const todayIsoDate = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return toIsoDate(now);
  }, []);
  const followUpWithEmailCount = useMemo(
    () => followUpInvoices.filter((item) => item.studentEmail.trim().length > 0).length,
    [followUpInvoices]
  );
  const followUpWithoutEmailCount = followUpInvoices.length - followUpWithEmailCount;

  const resetFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  useEffect(() => {
    if (!showPix) {
      setQrCodeDataUrl(null);
      setIsBuildingQrCode(false);
      return;
    }

    let isCancelled = false;

    const buildQr = async () => {
      if (!pixPayload) {
        setQrCodeDataUrl(null);
        return;
      }

      setIsBuildingQrCode(true);
      try {
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(pixPayload, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: "M",
          color: {
            dark: "#111111",
            light: "#FFFFFF",
          },
        });
        if (!isCancelled) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch {
        if (!isCancelled) {
          setQrCodeDataUrl(null);
          setErrorMessage("Não foi possível gerar o QR Code PIX.");
        }
      } finally {
        if (!isCancelled) {
          setIsBuildingQrCode(false);
        }
      }
    };

    void buildQr();

    return () => {
      isCancelled = true;
    };
  }, [pixPayload, showPix]);

  useEffect(() => {
    if (!showPix || !organizationId) {
      setIsLoadingClients(false);
      setClientsError(null);
      setClients([]);
      setSelectedClientId("");
      return;
    }

    let isCancelled = false;

    const loadClients = async () => {
      setIsLoadingClients(true);
      setClientsError(null);

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("students")
          .select("id, full_name, phone, email")
          .eq("organization_id", organizationId)
          .order("full_name", { ascending: true });

        if (error) {
          throw new Error(error.message);
        }

        const nextClients = (data ?? []).map((row) => ({
          id: String(row.id),
          name: String(row.full_name ?? "Cliente"),
          phone: String(row.phone ?? ""),
          email: String(row.email ?? ""),
        }));

        if (isCancelled) return;

        setClients(nextClients);
        setSelectedClientId((current) => {
          if (current && nextClients.some((client) => client.id === current)) {
            return current;
          }
          return nextClients[0]?.id ?? "";
        });
      } catch (error) {
        if (isCancelled) return;
        const message = error instanceof Error ? error.message : "Erro ao carregar clientes.";
        setClientsError(message);
        setClients([]);
        setSelectedClientId("");
      } finally {
        if (!isCancelled) {
          setIsLoadingClients(false);
        }
      }
    };

    void loadClients();

    return () => {
      isCancelled = true;
    };
  }, [organizationId, showPix]);

  const loadOpenInvoices = useCallback(async () => {
    if (!showBaixas || !organizationId) {
      setOpenInvoices([]);
      setIsLoadingFinance(false);
      return;
    }

    setIsLoadingFinance(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const [studentsResponse, invoicesResponse] = await Promise.all([
        supabase
          .from("students")
          .select("id, full_name")
          .eq("organization_id", organizationId)
          .order("full_name", { ascending: true }),
        supabase
          .from("invoices")
          .select("id, student_id, due_date, amount_cents, paid_amount_cents, status")
          .eq("organization_id", organizationId)
          .in("status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true }),
      ]);

      if (studentsResponse.error) throw new Error(studentsResponse.error.message);
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);

      const studentNameById = new Map(
        (studentsResponse.data ?? []).map((row) => [String(row.id), String(row.full_name ?? "Cliente")])
      );

      const nextOpenInvoices = ((invoicesResponse.data ?? []) as FinancialInvoiceRow[])
        .map((invoice) => {
          const openCents = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
          return {
            id: invoice.id,
            studentId: invoice.student_id,
            studentName: studentNameById.get(invoice.student_id) ?? "Cliente",
            dueDate: invoice.due_date,
            totalCents: invoice.amount_cents,
            paidCents: invoice.paid_amount_cents,
            openCents,
            status: invoice.status,
          } satisfies OpenInvoiceItem;
        })
        .filter((invoice) => invoice.openCents > 0);

      setOpenInvoices(nextOpenInvoices);
      setSelectedInvoiceId((current) => {
        if (current && nextOpenInvoices.some((invoice) => invoice.id === current)) return current;
        return nextOpenInvoices[0]?.id ?? "";
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar faturas em aberto.";
      setErrorMessage(message);
      setOpenInvoices([]);
      setSelectedInvoiceId("");
    } finally {
      setIsLoadingFinance(false);
    }
  }, [organizationId, showBaixas]);

  const loadCollectionOperations = useCallback(async () => {
    if (!showOperacao || !organizationId) {
      setFollowUpInvoices([]);
      setCollectionOverview({
        totalOpenCount: 0,
        totalOpenCents: 0,
        overdueCount: 0,
        overdueCents: 0,
        dueTodayCount: 0,
        dueTodayCents: 0,
        dueNext7Count: 0,
        dueNext7Cents: 0,
      });
      setIsLoadingCollectionOperations(false);
      return;
    }

    setIsLoadingCollectionOperations(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const [studentsResponse, invoicesResponse] = await Promise.all([
        supabase
          .from("students")
          .select("id, full_name, phone, email")
          .eq("organization_id", organizationId),
        supabase
          .from("invoices")
          .select("id, student_id, due_date, amount_cents, paid_amount_cents, status")
          .eq("organization_id", organizationId)
          .in("status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true })
          .limit(500),
      ]);

      if (studentsResponse.error) throw new Error(studentsResponse.error.message);
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);

      const studentById = new Map(
        (studentsResponse.data ?? []).map((row) => [
          String(row.id),
          {
            name: String(row.full_name ?? "Cliente"),
            phone: String(row.phone ?? ""),
            email: String(row.email ?? ""),
          },
        ])
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = toIsoDate(today);
      const dueNext7Date = new Date(today);
      dueNext7Date.setDate(dueNext7Date.getDate() + 7);
      const dueNext7Iso = toIsoDate(dueNext7Date);

      let totalOpenCount = 0;
      let totalOpenCents = 0;
      let overdueCount = 0;
      let overdueCents = 0;
      let dueTodayCount = 0;
      let dueTodayCents = 0;
      let dueNext7Count = 0;
      let dueNext7Cents = 0;

      const items = ((invoicesResponse.data ?? []) as FinancialInvoiceRow[])
        .map((invoice) => {
          const student = studentById.get(invoice.student_id);
          if (!student) return null;

          const openCents = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
          if (openCents <= 0) return null;

          totalOpenCount += 1;
          totalOpenCents += openCents;

          const isOverdue = invoice.status === "overdue" || invoice.due_date < todayIso;
          if (isOverdue) {
            overdueCount += 1;
            overdueCents += openCents;
          } else if (invoice.due_date === todayIso) {
            dueTodayCount += 1;
            dueTodayCents += openCents;
          } else if (invoice.due_date > todayIso && invoice.due_date <= dueNext7Iso) {
            dueNext7Count += 1;
            dueNext7Cents += openCents;
          }

          return {
            invoiceId: invoice.id,
            studentId: invoice.student_id,
            studentName: student.name,
            studentPhone: student.phone,
            studentEmail: student.email,
            dueDate: invoice.due_date,
            openCents,
            status: invoice.status,
          } satisfies FollowUpInvoiceItem;
        })
        .filter((item): item is FollowUpInvoiceItem => Boolean(item));

      items.sort((a, b) => {
        const aOverdue = a.status === "overdue" || a.dueDate < todayIso;
        const bOverdue = b.status === "overdue" || b.dueDate < todayIso;
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return b.openCents - a.openCents;
      });

      setFollowUpInvoices(items.slice(0, 12));
      setCollectionOverview({
        totalOpenCount,
        totalOpenCents,
        overdueCount,
        overdueCents,
        dueTodayCount,
        dueTodayCents,
        dueNext7Count,
        dueNext7Cents,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível carregar a operação de cobrança.";
      setErrorMessage(message);
      setFollowUpInvoices([]);
      setCollectionOverview({
        totalOpenCount: 0,
        totalOpenCents: 0,
        overdueCount: 0,
        overdueCents: 0,
        dueTodayCount: 0,
        dueTodayCents: 0,
        dueNext7Count: 0,
        dueNext7Cents: 0,
      });
    } finally {
      setIsLoadingCollectionOperations(false);
    }
  }, [organizationId, showOperacao]);

  const loadMonthlyReport = useCallback(async () => {
    if (!showRelatorios || !organizationId) {
      setMonthlyReport({ payments: [], pendingInvoices: [] });
      setIsLoadingMonthlyReport(false);
      return;
    }

    setIsLoadingMonthlyReport(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const range = buildMonthRange(referenceMonth);
      const paidStart = `${range.start}T00:00:00`;
      const paidEnd = `${range.nextMonth}T00:00:00`;

      const studentsResponse = await supabase
        .from("students")
        .select("id, full_name")
        .eq("organization_id", organizationId)
        .order("full_name", { ascending: true });
      if (studentsResponse.error) throw new Error(studentsResponse.error.message);

      const studentNameById = new Map(
        (studentsResponse.data ?? []).map((row) => [String(row.id), String(row.full_name ?? "Cliente")])
      );

      const invoicesResponse = await supabase
        .from("invoices")
        .select("id, student_id, due_date, amount_cents, paid_amount_cents, status")
        .eq("organization_id", organizationId)
        .gte("due_date", range.start)
        .lt("due_date", range.nextMonth)
        .neq("status", "canceled")
        .order("due_date", { ascending: true });
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);

      let paymentsData: FinancialPaymentRow[] = [];
      const paymentsWithReceiptResponse = await supabase
        .from("payments")
        .select(
          "id, student_id, invoice_id, amount_cents, method, paid_at, notes, receipt_url, receipt_file_name"
        )
        .eq("organization_id", organizationId)
        .gte("paid_at", paidStart)
        .lt("paid_at", paidEnd)
        .order("paid_at", { ascending: false });

      if (paymentsWithReceiptResponse.error) {
        const normalizedMessage = paymentsWithReceiptResponse.error.message.toLowerCase();
        const missingReceiptColumn =
          (normalizedMessage.includes("receipt_url") || normalizedMessage.includes("receipt_file_name")) &&
          normalizedMessage.includes("does not exist");

        if (!missingReceiptColumn) {
          throw new Error(paymentsWithReceiptResponse.error.message);
        }

        setIsReceiptColumnAvailable(false);
        const fallbackResponse = await supabase
          .from("payments")
          .select("id, student_id, invoice_id, amount_cents, method, paid_at, notes")
          .eq("organization_id", organizationId)
          .gte("paid_at", paidStart)
          .lt("paid_at", paidEnd)
          .order("paid_at", { ascending: false });
        if (fallbackResponse.error) throw new Error(fallbackResponse.error.message);
        paymentsData = (fallbackResponse.data ?? []) as FinancialPaymentRow[];
      } else {
        setIsReceiptColumnAvailable(true);
        paymentsData = (paymentsWithReceiptResponse.data ?? []) as FinancialPaymentRow[];
      }

      const pendingInvoices = ((invoicesResponse.data ?? []) as FinancialInvoiceRow[])
        .map((invoice) => {
          const openCents = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
          if (openCents <= 0 || !["pending", "partial", "overdue"].includes(invoice.status)) {
            return null;
          }
          return {
            id: invoice.id,
            studentId: invoice.student_id,
            studentName: studentNameById.get(invoice.student_id) ?? "Cliente",
            dueDate: invoice.due_date,
            totalCents: invoice.amount_cents,
            paidCents: invoice.paid_amount_cents,
            openCents,
            status: invoice.status,
            bucket: invoice.status === "overdue" ? ("overdue" as const) : ("pending" as const),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const payments = paymentsData.map((payment) => ({
        ...payment,
        studentName: studentNameById.get(payment.student_id) ?? "Cliente",
      }));

      setMonthlyReport({
        payments,
        pendingInvoices,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar o relatório mensal.";
      setErrorMessage(message);
      setMonthlyReport({ payments: [], pendingInvoices: [] });
    } finally {
      setIsLoadingMonthlyReport(false);
    }
  }, [organizationId, referenceMonth, showRelatorios]);

  useEffect(() => {
    void loadOpenInvoices();
  }, [loadOpenInvoices]);

  useEffect(() => {
    void loadCollectionOperations();
  }, [loadCollectionOperations]);

  useEffect(() => {
    void loadMonthlyReport();
  }, [loadMonthlyReport]);

  useEffect(() => {
    if (!showRelatorios) {
      setReceiptPreview(null);
    }
  }, [showRelatorios]);

  useEffect(() => {
    if (!selectedSettlementInvoice) {
      setSettlementAmount("");
      return;
    }

    setSettlementAmount((selectedSettlementInvoice.openCents / 100).toFixed(2));
  }, [selectedSettlementInvoice]);

  useEffect(() => {
    if (!showPix) {
      setTemplatePreviewUrl(null);
      setIsBuildingTemplatePreview(false);
      return;
    }

    let isCancelled = false;

    const buildTemplatePreview = async () => {
      if (!qrCodeDataUrl || !pixPayload) {
        setTemplatePreviewUrl(null);
        setIsBuildingTemplatePreview(false);
        return;
      }

      setIsBuildingTemplatePreview(true);
      try {
        const previewDataUrl = await renderQrTemplateDataUrl({
          qrCodeDataUrl,
          templateLogoUrl,
          merchantName,
          merchantCity,
          amount,
          selectedClientName: selectedClient?.name,
        });

        if (!isCancelled) {
          setTemplatePreviewUrl(previewDataUrl);
        }
      } catch {
        if (!isCancelled) {
          setTemplatePreviewUrl(null);
        }
      } finally {
        if (!isCancelled) {
          setIsBuildingTemplatePreview(false);
        }
      }
    };

    void buildTemplatePreview();

    return () => {
      isCancelled = true;
    };
  }, [amount, merchantCity, merchantName, pixPayload, qrCodeDataUrl, selectedClient?.name, showPix, templateLogoUrl]);

  useEffect(() => {
    let isCancelled = false;

    const loadTemplateSettings = async () => {
      setIsLoadingTemplateSettings(true);

      try {
        const supabase = getSupabaseBrowserClient();
        const { data: context, error: contextError } = await getUserOrgContext(supabase, { force: true });
        if (contextError || !context) {
          throw new Error(contextError ?? "Falha ao carregar a organização.");
        }

        if (isCancelled) return;

        setOrganizationId(context.organizationId);
        setUserId(context.user.id);

        let hasQrLogoColumn = showPix;
        const primaryColumns = showPix
          ? "organization_id, qr_template_logo_url, whatsapp_template"
          : "organization_id, whatsapp_template";

        const primaryResponse = await supabase
          .from("organization_settings")
          .select(primaryColumns)
          .eq("organization_id", context.organizationId)
          .maybeSingle();

        let settingsData: Record<string, unknown> | null = null;
        if (primaryResponse.error) {
          const normalizedMessage = primaryResponse.error.message.toLowerCase();
          const missingLogoColumn =
            normalizedMessage.includes("qr_template_logo_url") &&
            normalizedMessage.includes("does not exist");

          if (missingLogoColumn && showPix) {
            hasQrLogoColumn = false;
            const fallbackResponse = await supabase
              .from("organization_settings")
              .select("organization_id, whatsapp_template")
              .eq("organization_id", context.organizationId)
              .maybeSingle();
            if (fallbackResponse.error) {
              throw new Error(fallbackResponse.error.message);
            }
            settingsData = (fallbackResponse.data ?? null) as Record<string, unknown> | null;
          } else {
            throw new Error(primaryResponse.error.message);
          }
        } else {
          settingsData = (primaryResponse.data ?? null) as Record<string, unknown> | null;
        }

        if (isCancelled) return;

        setIsLogoColumnAvailable(hasQrLogoColumn);
        if (!hasQrLogoColumn && showPix) {
          setErrorMessage(
            "A coluna qr_template_logo_url ainda não existe no banco. Rode a migration 202602140001 para habilitar o salvamento do logo."
          );
        }

        const row = settingsData as Partial<TemplateSettingsRow> | null;
        setTemplateLogoUrl(hasQrLogoColumn ? String(row?.qr_template_logo_url ?? "").trim() : "");
        setWhatsappTemplate(String(row?.whatsapp_template ?? "").trim() || DEFAULT_WHATSAPP_TEMPLATE);
      } catch (error) {
        if (isCancelled) return;
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar as preferências de template.";
        setErrorMessage(message);
      } finally {
        if (!isCancelled) {
          setIsLoadingTemplateSettings(false);
        }
      }
    };

    void loadTemplateSettings();

    return () => {
      isCancelled = true;
    };
  }, [showPix]);

  const handleCopyKey = async () => {
    resetFeedback();
    if (!pixKey.trim()) {
      setErrorMessage("Informe uma chave PIX para copiar.");
      return;
    }
    try {
      await copyToClipboard(pixKey.trim());
      setSuccessMessage("Chave PIX copiada.");
    } catch {
      setErrorMessage("Não foi possível copiar a chave PIX.");
    }
  };

  const handleCopyPayload = async () => {
    resetFeedback();
    if (!pixPayload) {
      setErrorMessage("Preencha uma chave PIX válida para copiar o código.");
      return;
    }
    try {
      await copyToClipboard(pixPayload);
      setSuccessMessage("Código PIX copia e cola copiado.");
    } catch {
      setErrorMessage("Não foi possível copiar o código PIX.");
    }
  };

  const handleShareKeyWhatsapp = () => {
    resetFeedback();
    const key = pixKey.trim();
    if (!key) {
      setErrorMessage("Informe uma chave PIX para compartilhar.");
      return;
    }

    if (!selectedClient) {
      setErrorMessage("Selecione um cliente para enviar a cobrança.");
      return;
    }

    const phone = normalizeWhatsappPhone(selectedClient.phone);
    if (!phone) {
      setErrorMessage("Telefone do cliente inválido para WhatsApp.");
      return;
    }

    const message = [
      `Olá ${selectedClient.name}, segue minha chave PIX para pagamento:`,
      key,
      "",
      "Se preferir, posso enviar o QR Code também.",
    ].join("\n");

    window.open(buildWhatsappUrl(phone, message), "_blank", "noopener,noreferrer");
  };

  const handleSharePayloadWhatsapp = () => {
    resetFeedback();
    if (!pixPayload) {
      setErrorMessage("Preencha uma chave PIX válida para compartilhar o código.");
      return;
    }

    if (!selectedClient) {
      setErrorMessage("Selecione um cliente para enviar a cobrança.");
      return;
    }

    const phone = normalizeWhatsappPhone(selectedClient.phone);
    if (!phone) {
      setErrorMessage("Telefone do cliente inválido para WhatsApp.");
      return;
    }

    const message = [
      `Olá ${selectedClient.name}, segue o PIX copia e cola para pagamento:`,
      pixPayload,
      amount.trim() ? `Valor sugerido: R$ ${amount.trim()}` : "",
      "",
      "Cole o código no app do banco para pagar.",
    ]
      .filter(Boolean)
      .join("\n");

    window.open(buildWhatsappUrl(phone, message), "_blank", "noopener,noreferrer");
  };

  const logCollectionAction = async (input: {
    invoiceId: string;
    channel?: "whatsapp" | "email" | "phone" | "manual";
    templateKind: "reminder" | "overdue" | "custom";
    outcome: "sent" | "failed" | "no_reply" | "promised" | "paid" | "other";
    message: string;
    notes?: string;
  }) => {
    if (!organizationId) return;
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.rpc("log_collection_event", {
        p_org_id: organizationId,
        p_invoice_id: input.invoiceId,
        p_channel: input.channel ?? "whatsapp",
        p_template_kind: input.templateKind,
        p_outcome: input.outcome,
        p_message: input.message,
        p_notes: input.notes ?? null,
      });
    } catch {
      // Do not block main cobrança workflow when audit logging fails.
    }
  };

  const handleSendFollowUpWhatsapp = (item: FollowUpInvoiceItem) => {
    resetFeedback();
    const phone = normalizeWhatsappPhone(item.studentPhone);
    if (!phone) {
      setErrorMessage(`Telefone inválido para WhatsApp em ${item.studentName}.`);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(`${item.dueDate}T00:00:00`);
    const daysOverdue = Math.max(
      0,
      Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    const templateKind = daysOverdue > 0 ? "overdue" : "reminder";
    const message = buildCollectionMessage(whatsappTemplate, {
      studentName: item.studentName,
      amountCents: item.openCents,
      dueDate: item.dueDate,
      daysOverdue,
    });

    window.open(buildWhatsappUrl(phone, message), "_blank", "noopener,noreferrer");
    void logCollectionAction({
      invoiceId: item.invoiceId,
      templateKind,
      outcome: "sent",
      message,
      notes: `Follow-up operacional (${templateKind}).`,
    });
    setSuccessMessage(`Cobrança enviada para ${item.studentName} no WhatsApp.`);
  };

  const sendChargeEmail = useCallback(
    async (input: {
      to: string;
      studentName: string;
      amountCents?: number | null;
      dueDate?: string | null;
      subject?: string | null;
      customMessage?: string | null;
      pixPayload?: string | null;
    }) => {
      if (!organizationId) {
        throw new Error("Organização não identificada.");
      }

      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error(sessionError?.message ?? "Sessão inválida para envio de e-mail.");
      }

      const response = await fetch("/api/cobranca/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          organizationId,
          to: input.to,
          studentName: input.studentName,
          amountCents: input.amountCents ?? null,
          dueDate: input.dueDate ?? null,
          subject: input.subject ?? null,
          customMessage: input.customMessage ?? null,
          pixPayload: input.pixPayload ?? null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Não foi possível enviar o e-mail.");
      }

      emitSessionNotification({
        tone: "success",
        message: `E-mail enviado para ${input.studentName} (${input.to}).`,
      });
    },
    [organizationId]
  );

  const handleSendPixEmail = async () => {
    resetFeedback();
    if (!selectedClient) {
      setErrorMessage("Selecione um cliente para envio por e-mail.");
      return;
    }
    if (!selectedClient.email.trim()) {
      setErrorMessage(`Cliente ${selectedClient.name} sem e-mail cadastrado.`);
      return;
    }

    setIsSendingPixEmail(true);
    try {
      const amountCents = parseAmountToCents(amount);
      const effectivePixPayload =
        pixPayload || (pixKey.trim() ? `Chave PIX para pagamento: ${pixKey.trim()}` : null);
      const message = [
        `Olá ${selectedClient.name},`,
        amountCents
          ? `Sua cobrança está em aberto no valor de ${formatCurrency(amountCents)}.`
          : "Sua cobrança está disponível para pagamento.",
        effectivePixPayload
          ? "Abaixo você encontra os dados de pagamento via PIX."
          : "Entre em contato para receber os dados de pagamento.",
      ].join("\n\n");

      await sendChargeEmail({
        to: selectedClient.email.trim(),
        studentName: selectedClient.name,
        amountCents: amountCents ?? null,
        subject: `Cobrança via PIX - ${merchantName || "Financeiro"}`,
        customMessage: message,
        pixPayload: effectivePixPayload,
      });

      setSuccessMessage(`E-mail de cobrança enviado para ${selectedClient.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível enviar e-mail.";
      setErrorMessage(message);
    } finally {
      setIsSendingPixEmail(false);
    }
  };

  const handleSendFollowUpEmail = async (
    item: FollowUpInvoiceItem,
    options?: { silent?: boolean }
  ): Promise<boolean> => {
    const isSilent = Boolean(options?.silent);
    if (!isSilent) {
      resetFeedback();
    }

    if (!item.studentEmail.trim()) {
      if (!isSilent) {
        setErrorMessage(`Cliente ${item.studentName} sem e-mail cadastrado.`);
      }
      await logCollectionAction({
        invoiceId: item.invoiceId,
        channel: "email",
        templateKind: "custom",
        outcome: "failed",
        message: "",
        notes: "Tentativa de envio sem e-mail cadastrado.",
      });
      return false;
    }

    setIsSendingFollowUpEmailId(item.invoiceId);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(`${item.dueDate}T00:00:00`);
      const daysOverdue = Math.max(
        0,
        Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      );
      const templateKind = daysOverdue > 0 ? "overdue" : "reminder";
      const message = buildCollectionMessage(whatsappTemplate, {
        studentName: item.studentName,
        amountCents: item.openCents,
        dueDate: item.dueDate,
        daysOverdue,
      });
      const effectivePixPayload =
        pixPayload || (pixKey.trim() ? `Chave PIX para pagamento: ${pixKey.trim()}` : null);

      await sendChargeEmail({
        to: item.studentEmail.trim(),
        studentName: item.studentName,
        amountCents: item.openCents,
        dueDate: item.dueDate,
        subject:
          daysOverdue > 0
            ? `Cobrança em atraso - ${item.studentName}`
            : `Lembrete de vencimento - ${item.studentName}`,
        customMessage: message,
        pixPayload: effectivePixPayload,
      });

      await logCollectionAction({
        invoiceId: item.invoiceId,
        channel: "email",
        templateKind,
        outcome: "sent",
        message,
        notes: "Follow-up por e-mail.",
      });
      if (!isSilent) {
        setSuccessMessage(`E-mail de cobrança enviado para ${item.studentName}.`);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível enviar e-mail.";
      if (!isSilent) {
        setErrorMessage(message);
      }
      await logCollectionAction({
        invoiceId: item.invoiceId,
        channel: "email",
        templateKind: "custom",
        outcome: "failed",
        message: "",
        notes: `Falha no envio de e-mail: ${message}`,
      });
      return false;
    } finally {
      setIsSendingFollowUpEmailId(null);
    }
  };

  const handleSendAllFollowUpEmails = async () => {
    resetFeedback();
    if (followUpInvoices.length === 0) {
      setErrorMessage("Sem cobranças pendentes para follow-up.");
      return;
    }
    setShowFollowUpBatchEmailModal(false);

    setIsSendingFollowUpEmailsBatch(true);
    let sentCount = 0;
    let failedCount = 0;

    try {
      for (const item of followUpInvoices) {
        const sent = await handleSendFollowUpEmail(item, { silent: true });
        if (sent) {
          sentCount += 1;
        } else {
          failedCount += 1;
        }
      }

      if (sentCount > 0 && failedCount === 0) {
        setSuccessMessage(`E-mails enviados com sucesso para ${sentCount} cobrança(s).`);
      } else if (sentCount > 0) {
        setSuccessMessage(`Envio em lote concluído: ${sentCount} enviado(s) e ${failedCount} com falha.`);
      } else {
        setErrorMessage(`Não foi possível enviar os e-mails da fila (${failedCount} falha(s)).`);
      }
    } finally {
      setIsSendingFollowUpEmailsBatch(false);
    }
  };

  const openFollowUpBatchEmailModal = () => {
    resetFeedback();
    if (followUpInvoices.length === 0) {
      setErrorMessage("Sem cobranças pendentes para follow-up.");
      return;
    }
    setShowFollowUpBatchEmailModal(true);
  };

  const closeFollowUpBatchEmailModal = () => {
    if (isSendingFollowUpEmailsBatch) return;
    setShowFollowUpBatchEmailModal(false);
  };

  const handleGenerateInvoicesForMonth = async () => {
    resetFeedback();
    if (!organizationId) {
      setErrorMessage("Organização não identificada para gerar cobranças.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(generationMonth)) {
      setErrorMessage("Selecione um mês válido para gerar cobranças.");
      return;
    }

    setIsGeneratingInvoices(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("generate_invoices_for_period", {
        p_org_id: organizationId,
        p_reference_date: `${generationMonth}-01`,
      });

      if (error) throw new Error(error.message);

      const firstRow = Array.isArray(data)
        ? (data[0] as { created_count?: number; skipped_count?: number } | undefined)
        : undefined;

      const createdCount = Number(firstRow?.created_count ?? 0);
      const skippedCount = Number(firstRow?.skipped_count ?? 0);
      setSuccessMessage(
        `Cobranças processadas: ${createdCount} novas e ${skippedCount} já existentes para o mês.`
      );

      await Promise.all([loadCollectionOperations(), loadOpenInvoices(), loadMonthlyReport()]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível gerar cobranças recorrentes.";
      setErrorMessage(message);
    } finally {
      setIsGeneratingInvoices(false);
    }
  };

  const handleMarkOverdueInvoices = async () => {
    resetFeedback();
    if (!organizationId) {
      setErrorMessage("Organização não identificada para atualizar atrasos.");
      return;
    }

    setIsMarkingOverdue(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("mark_overdue_invoices", {
        p_org_id: organizationId,
      });
      if (error) throw new Error(error.message);

      const updatedCount = Number(data ?? 0);
      setSuccessMessage(`${updatedCount} cobrança(s) atualizada(s) para atraso.`);
      await Promise.all([loadCollectionOperations(), loadOpenInvoices(), loadMonthlyReport()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível atualizar atrasos.";
      setErrorMessage(message);
    } finally {
      setIsMarkingOverdue(false);
    }
  };

  const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Selecione um arquivo de imagem para o logo.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("Logo muito grande. Use uma imagem de até 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setTemplateLogoUrl(String(reader.result ?? ""));
      setSuccessMessage("Logo carregado. Clique em salvar logo.");
    };
    reader.onerror = () => {
      setErrorMessage("Não foi possível ler o arquivo do logo.");
    };
    reader.readAsDataURL(file);
  };

  const handleSaveTemplateSettings = async () => {
    resetFeedback();
    if (!organizationId) {
      setErrorMessage("Configuração da organização não encontrada.");
      return;
    }

    setIsSavingTemplateSettings(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const payload: Record<string, string> = {
        whatsapp_template: whatsappTemplate.trim() || DEFAULT_WHATSAPP_TEMPLATE,
      };
      if (isLogoColumnAvailable) {
        payload.qr_template_logo_url = templateLogoUrl.trim();
      }

      const { error } = await supabase
        .from("organization_settings")
        .update(payload)
        .eq("organization_id", organizationId);

      if (error) {
        const normalizedMessage = error.message.toLowerCase();
        if (
          normalizedMessage.includes("qr_template_logo_url") &&
          normalizedMessage.includes("does not exist")
        ) {
          setIsLogoColumnAvailable(false);
          const fallback = await supabase
            .from("organization_settings")
            .update({
              whatsapp_template: whatsappTemplate.trim() || DEFAULT_WHATSAPP_TEMPLATE,
            })
            .eq("organization_id", organizationId);
          if (fallback.error) {
            throw new Error(fallback.error.message);
          }
          setSuccessMessage(
            "Template WhatsApp salvo. A coluna de logo ainda não existe (rode a migration 202602140001)."
          );
          return;
        }
        throw new Error(error.message);
      }

      setSuccessMessage("Configurações de cobrança salvas.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar o logo do template.";
      setErrorMessage(message);
    } finally {
      setIsSavingTemplateSettings(false);
    }
  };

  const handleDownloadQrTemplate = async () => {
    resetFeedback();
    if (!qrCodeDataUrl || !pixPayload) {
      setErrorMessage("Preencha uma chave PIX válida para baixar o template.");
      return;
    }

    setIsDownloadingTemplate(true);

    try {
      const templateDataUrl = await renderQrTemplateDataUrl({
        qrCodeDataUrl,
        templateLogoUrl,
        merchantName,
        merchantCity,
        amount,
        selectedClientName: selectedClient?.name,
      });

      const fileSuffix = selectedClient?.name ? slugifyName(selectedClient.name) : "cliente";
      const anchor = document.createElement("a");
      anchor.href = templateDataUrl;
      anchor.download = `cobranca-pix-${fileSuffix || "cliente"}.png`;
      anchor.click();

      setSuccessMessage("Template do QR Code baixado.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível baixar o template do QR Code.";
      setErrorMessage(message);
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleReceiptFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setErrorMessage("Use comprovante em imagem ou PDF.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("Comprovante muito grande. Limite de 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setReceiptDataUrl(String(reader.result ?? ""));
      setReceiptFileName(file.name);
      setSuccessMessage("Comprovante anexado.");
    };
    reader.onerror = () => {
      setErrorMessage("Não foi possível ler o comprovante.");
    };
    reader.readAsDataURL(file);
  };

  const handleSettleInvoice = async () => {
    resetFeedback();
    if (!organizationId || !userId) {
      setErrorMessage("Sessão inválida para registrar baixa.");
      return;
    }
    if (!selectedSettlementInvoice) {
      setErrorMessage("Selecione uma fatura em aberto.");
      return;
    }

    const amountCents = parseAmountToCents(settlementAmount);
    if (!amountCents) {
      setErrorMessage("Informe um valor válido para a baixa.");
      return;
    }
    if (amountCents > selectedSettlementInvoice.openCents) {
      setErrorMessage("Valor maior do que o saldo em aberto.");
      return;
    }

    setIsSettlingInvoice(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const payload: Record<string, unknown> = {
        organization_id: organizationId,
        invoice_id: selectedSettlementInvoice.id,
        student_id: selectedSettlementInvoice.studentId,
        amount_cents: amountCents,
        method: settlementMethod,
        notes: settlementNotes.trim() || null,
        created_by: userId,
      };

      if (isReceiptColumnAvailable) {
        payload.receipt_url = receiptDataUrl || null;
        payload.receipt_file_name = receiptFileName || null;
      }

      const { error } = await supabase.from("payments").insert(payload);
      if (error) {
        const normalizedMessage = error.message.toLowerCase();
        const missingReceiptColumn =
          (normalizedMessage.includes("receipt_url") || normalizedMessage.includes("receipt_file_name")) &&
          normalizedMessage.includes("does not exist");
        if (missingReceiptColumn) {
          setIsReceiptColumnAvailable(false);
          throw new Error(
            "As colunas de comprovante ainda não existem no banco. Execute a migration 202602140002."
          );
        }
        throw new Error(error.message);
      }

      setSettlementNotes("");
      setReceiptDataUrl("");
      setReceiptFileName("");
      setSuccessMessage("Baixa registrada com sucesso.");
      await Promise.all([loadOpenInvoices(), loadMonthlyReport(), loadCollectionOperations()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível registrar a baixa.";
      setErrorMessage(message);
    } finally {
      setIsSettlingInvoice(false);
    }
  };

  const handleOpenReceipt = (paymentId: string, receiptUrl: string, fileName?: string | null) => {
    resetFeedback();

    if (!receiptUrl.trim()) {
      setErrorMessage("Comprovante indisponível.");
      return;
    }

    const trimmedFileName = fileName?.trim() || "Comprovante";
    setReceiptPreview({
      paymentId,
      fileName: trimmedFileName,
      url: receiptUrl,
      kind: detectReceiptPreviewKind(receiptUrl, fileName),
    });
  };

  const handleExportCsv = () => {
    resetFeedback();
    setIsExportingCsv(true);
    try {
      const rows: string[] = [];
      rows.push(
        [
          "tipo",
          "cliente",
          "status",
          "vencimento",
          "pago_em",
          "valor_total",
          "valor_pago",
          "valor_aberto",
          "metodo",
          "observacoes",
          "comprovante",
        ]
          .map(escapeCsv)
          .join(";")
      );

      monthlyReport.payments.forEach((payment) => {
        rows.push(
          [
            "Recebido",
            payment.studentName,
            "Pago",
            "",
            formatDateTime(payment.paid_at),
            "",
            formatCurrency(payment.amount_cents),
            "",
            methodLabel(payment.method),
            payment.notes ?? "",
            payment.receipt_file_name ? `Anexo: ${payment.receipt_file_name}` : "",
          ]
            .map((value) => escapeCsv(String(value)))
            .join(";")
        );
      });

      monthlyReport.pendingInvoices.forEach((invoice) => {
        rows.push(
          [
            invoice.bucket === "overdue" ? "Atrasado" : "Pendente",
            invoice.studentName,
            invoice.status,
            formatDate(invoice.dueDate),
            "",
            formatCurrency(invoice.totalCents),
            formatCurrency(invoice.paidCents),
            formatCurrency(invoice.openCents),
            "",
            "",
            "",
          ]
            .map((value) => escapeCsv(String(value)))
            .join(";")
        );
      });

      const csvContent = rows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `financeiro-${referenceMonth}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccessMessage("CSV financeiro exportado.");
    } catch {
      setErrorMessage("Não foi possível exportar o CSV.");
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleExportPdf = async () => {
    resetFeedback();
    setIsExportingPdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 40;
      const marginY = 42;
      const contentWidth = pageWidth - marginX * 2;
      const monthLabel = formatReferenceMonth(referenceMonth);
      const generatedAt = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());
      const headerLogoDataUrl = await renderImageAsPngDataUrl("/manager.svg", 260, 64, {
        fit: "cover",
        positionX: "left",
        positionY: "center",
      }).catch(() => null);

      const palette = {
        accent: [44, 87, 144] as const,
        text: [17, 24, 39] as const,
        muted: [100, 116, 139] as const,
        border: [203, 213, 225] as const,
        panel: [248, 250, 252] as const,
        tableHeader: [241, 245, 249] as const,
      };
      const formatPdfDateTime = (value: string) =>
        new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(new Date(value))
          .replace(",", "");
      const trimForCell = (value: string, maxLength: number) => {
        const normalized = value.replace(/\s+/g, " ").trim();
        if (normalized.length <= maxLength) return normalized;
        return `${normalized.slice(0, Math.max(maxLength - 3, 1))}...`;
      };

      let currentY = marginY;

      const setFill = (color: readonly [number, number, number]) => doc.setFillColor(color[0], color[1], color[2]);
      const setStroke = (color: readonly [number, number, number]) => doc.setDrawColor(color[0], color[1], color[2]);
      const setText = (color: readonly [number, number, number]) => doc.setTextColor(color[0], color[1], color[2]);

      const drawHeader = (isContinuation = false) => {
        const logoWidth = 138;
        const logoHeight = 34;
        const logoX = marginX;
        const logoY = marginY - 13;
        const hasLogo = Boolean(headerLogoDataUrl);
        const titleX = hasLogo ? marginX + logoWidth + 12 : marginX;
        const titleBaseY = marginY + 4;

        if (hasLogo && headerLogoDataUrl) {
          doc.addImage(headerLogoDataUrl, "PNG", logoX, logoY, logoWidth, logoHeight, undefined, "FAST");
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(19);
        setText(palette.text);
        doc.text(
          isContinuation ? "Relatório financeiro mensal (continuação)" : "Relatório financeiro mensal",
          titleX,
          titleBaseY
        );

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        setText(palette.muted);
        doc.text(`Período de referência: ${monthLabel}`, titleX, titleBaseY + 16);
        doc.text(`Gerado em: ${generatedAt}`, titleX, titleBaseY + 31);

        setStroke(palette.accent);
        doc.setLineWidth(1.2);
        doc.line(marginX, marginY + 45, pageWidth - marginX, marginY + 45);

        currentY = marginY + 62;
      };

      const ensureSpace = (neededHeight: number) => {
        if (currentY + neededHeight <= pageHeight - 46) return;
        doc.addPage();
        drawHeader(true);
      };

      const drawSummaryCard = (x: number, label: string, value: string) => {
        const width = (contentWidth - 16) / 3;
        const height = 68;
        setFill(palette.panel);
        doc.roundedRect(x, currentY, width, height, 6, 6, "F");
        setStroke(palette.border);
        doc.roundedRect(x, currentY, width, height, 6, 6, "S");

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        setText(palette.muted);
        doc.text(label, x + 10, currentY + 21);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        setText(palette.text);
        doc.text(value, x + 10, currentY + 44);
      };

      const drawSectionTitle = (title: string) => {
        ensureSpace(32);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        setText(palette.text);
        doc.text(title, marginX, currentY);
        setStroke(palette.border);
        doc.setLineWidth(0.8);
        doc.line(marginX, currentY + 7, pageWidth - marginX, currentY + 7);
        currentY += 24;
      };

      type TableColumn = {
        label: string;
        width: number;
        align?: "left" | "right";
        maxLines?: number;
      };

      const drawTableHeader = (columns: TableColumn[]) => {
        const lineHeight = 9;
        const headerLines = columns.map((column) =>
          doc.splitTextToSize(column.label, Math.max(column.width - 12, 12)) as string[]
        );
        const rowLineCount = Math.max(...headerLines.map((lines) => Math.max(lines.length, 1)));
        const rowHeight = Math.max(24, rowLineCount * lineHeight + 8);

        ensureSpace(rowHeight + 2);
        let cursorX = marginX;
        setFill(palette.tableHeader);
        setStroke(palette.border);
        doc.setLineWidth(0.7);
        columns.forEach((column) => {
          doc.rect(cursorX, currentY, column.width, rowHeight, "FD");
          cursorX += column.width;
        });

        cursorX = marginX;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        setText(palette.text);
        columns.forEach((column, index) => {
          const lines = headerLines[index].length > 0 ? headerLines[index] : [column.label];
          doc.text(lines, cursorX + 6, currentY + 14, { maxWidth: column.width - 12 });
          cursorX += column.width;
        });
        currentY += rowHeight;
      };

      const drawTableRow = (columns: TableColumn[], values: string[]) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);

        const fitText = (text: string, maxWidth: number): string => {
          const trimmed = text.trim();
          if (!trimmed) return "-";
          if (doc.getTextWidth(trimmed) <= maxWidth) return trimmed;

          let output = trimmed;
          while (output.length > 1 && doc.getTextWidth(`${output}...`) > maxWidth) {
            output = output.slice(0, -1);
          }
          return `${output}...`;
        };

        const lineHeight = 11;
        const cellLines = values.map((value, index) => {
          const column = columns[index];
          const text = value?.trim() ? value.trim() : "-";
          const split = doc.splitTextToSize(text, Math.max(column.width - 12, 8)) as string[];
          const maxLines = Math.max(column.maxLines ?? split.length, 1);
          if (split.length <= maxLines) {
            return split.length > 0 ? split : ["-"];
          }

          const truncated = split.slice(0, maxLines);
          truncated[maxLines - 1] = fitText(truncated[maxLines - 1], Math.max(column.width - 12, 8));
          return truncated;
        });
        const rowLineCount = Math.max(...cellLines.map((lines) => Math.max(lines.length, 1)));
        const rowHeight = Math.max(24, rowLineCount * lineHeight + 8);

        ensureSpace(rowHeight + 2);

        let cursorX = marginX;
        setStroke(palette.border);
        doc.setLineWidth(0.6);
        columns.forEach((column) => {
          doc.rect(cursorX, currentY, column.width, rowHeight, "S");
          cursorX += column.width;
        });

        cursorX = marginX;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        setText(palette.text);
        columns.forEach((column, index) => {
          const lines = cellLines[index].length > 0 ? cellLines[index] : ["-"];
          if (column.align === "right") {
            lines.forEach((line, lineIndex) => {
              doc.text(line, cursorX + column.width - 6, currentY + 14 + lineIndex * lineHeight, { align: "right" });
            });
          } else {
            doc.text(lines, cursorX + 6, currentY + 14, { maxWidth: column.width - 12 });
          }
          cursorX += column.width;
        });

        currentY += rowHeight;
      };

      const drawEmptyState = (message: string) => {
        ensureSpace(34);
        setStroke(palette.border);
        doc.rect(marginX, currentY, contentWidth, 28, "S");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        setText(palette.muted);
        doc.text(message, marginX + 8, currentY + 18);
        currentY += 28;
      };

      drawHeader();
      drawSummaryCard(marginX, "Recebido no mês", formatCurrency(monthlySummary.receivedCents));
      drawSummaryCard(marginX + (contentWidth - 16) / 3 + 8, "Pendente", formatCurrency(monthlySummary.pendingCents));
      drawSummaryCard(
        marginX + ((contentWidth - 16) / 3 + 8) * 2,
        "Atrasado",
        formatCurrency(monthlySummary.overdueCents)
      );
      currentY += 84;

      drawSectionTitle("1. Recebimentos");
      if (monthlyReport.payments.length === 0) {
        drawEmptyState("Não há recebimentos registrados para o período selecionado.");
      } else {
        const paymentColumns: TableColumn[] = [
          { label: "Data", width: 82, maxLines: 1 },
          { label: "Cliente", width: 128, maxLines: 2 },
          { label: "Método", width: 70, maxLines: 1 },
          { label: "Valor", width: 80, align: "right", maxLines: 1 },
          { label: "Obs./comprovante", width: contentWidth - 360, maxLines: 2 },
        ];
        drawTableHeader(paymentColumns);

        monthlyReport.payments.forEach((payment) => {
          const details: string[] = [];
          if (payment.notes?.trim()) details.push(`Obs: ${trimForCell(payment.notes, 72)}`);
          if (payment.receipt_file_name?.trim()) {
            details.push(`Comp.: ${trimForCell(payment.receipt_file_name, 48)}`);
          }

          drawTableRow(paymentColumns, [
            formatPdfDateTime(payment.paid_at),
            trimForCell(payment.studentName, 42),
            methodLabel(payment.method),
            formatCurrency(payment.amount_cents),
            details.join(" | ") || "-",
          ]);
        });
      }

      currentY += 18;
      drawSectionTitle("2. Pendências");
      if (monthlyReport.pendingInvoices.length === 0) {
        drawEmptyState("Não há pendências para o período selecionado.");
      } else {
        const pendingColumns: TableColumn[] = [
          { label: "Status", width: 84, maxLines: 1 },
          { label: "Vencimento", width: 86, maxLines: 1 },
          { label: "Cliente", width: 205, maxLines: 2 },
          { label: "Valor em aberto", width: contentWidth - 375, align: "right", maxLines: 1 },
        ];
        drawTableHeader(pendingColumns);

        monthlyReport.pendingInvoices.forEach((invoice) => {
          drawTableRow(pendingColumns, [
            invoice.bucket === "overdue" ? "Atrasado" : "Pendente",
            formatDate(invoice.dueDate),
            trimForCell(invoice.studentName, 60),
            formatCurrency(invoice.openCents),
          ]);
        });
      }

      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        setStroke(palette.border);
        doc.setLineWidth(0.7);
        doc.line(marginX, pageHeight - 28, pageWidth - marginX, pageHeight - 28);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        setText(palette.muted);
        doc.text("Relatório financeiro - shadmanager", marginX, pageHeight - 14);
        doc.text(`Página ${page}/${totalPages}`, pageWidth - marginX, pageHeight - 14, { align: "right" });
      }

      doc.save(`financeiro-${referenceMonth}.pdf`);
      setSuccessMessage("PDF financeiro exportado.");
    } catch {
      setErrorMessage("Não foi possível exportar o PDF.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const pageCopy = useMemo(() => {
    if (mode === "pix") {
      return {
        title: "Gerador PIX",
        description: "Gere QR Code PIX, compartilhe no WhatsApp e baixe o template visual em segundos.",
        badge: "Módulo PIX",
      };
    }
    if (mode === "operacao") {
      return {
        title: "Operação de cobrança",
        description: "Gere cobranças recorrentes, atualize atrasos e acione follow-ups por cliente.",
        badge: "Módulo cobrança",
      };
    }
    if (mode === "baixas") {
      return {
        title: "Baixas e comprovantes",
        description: "Registre pagamentos manuais, anexe comprovantes e mantenha o histórico financeiro auditável.",
        badge: "Controle de baixas",
      };
    }
    if (mode === "relatorios") {
      return {
        title: "Relatórios financeiros",
        description: "Acompanhe recebidos, pendências e exporte o fechamento mensal em CSV ou PDF.",
        badge: "Fechamento mensal",
      };
    }
    return {
      title: "Cobranças",
      description: "Gestão financeira da carteira de cobrança.",
      badge: "Módulo financeiro",
    };
  }, [mode]);

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-md border-l-2 border-[var(--accent)] px-4 py-6 md:px-6 md:py-7">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Cobranças</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100 md:text-3xl">{pageCopy.title}</h2>
            <p className="mt-2 text-sm text-zinc-300">{pageCopy.description}</p>
          </div>
          <span className="surface-soft inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs text-zinc-400">
            {pageCopy.badge}
          </span>
        </div>
      </header>

      {showPix && payloadError ? (
        <div className="surface rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {payloadError}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="surface rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="surface rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {successMessage}
        </div>
      ) : null}

      {showPix || showOperacao ? (
        <div className="flex flex-col gap-4">
        {showOperacao ? (
        <section className="surface rounded-md p-4 md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-100">Operação de cobrança recorrente</p>
              <p className="mt-1 text-xs text-zinc-500">
                Gere cobranças do mês, atualize atrasos e execute follow-up rapidamente no WhatsApp.
              </p>
            </div>
            <label className="w-full max-w-[220px]">
              <span className="mb-1 block text-xs text-zinc-500">Competência</span>
              <input
                type="month"
                value={generationMonth}
                onChange={(event) => setGenerationMonth(event.target.value)}
                className="field glow-focus h-10 w-full rounded-md px-3 text-sm outline-none"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleGenerateInvoicesForMonth()}
              disabled={isGeneratingInvoices || !organizationId}
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGeneratingInvoices ? "Gerando..." : "Gerar cobranças do mês"}
            </button>
            <button
              type="button"
              onClick={() => void handleMarkOverdueInvoices()}
              disabled={isMarkingOverdue || !organizationId}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isMarkingOverdue ? "Atualizando..." : "Atualizar atrasos"}
            </button>
            <button
              type="button"
              onClick={() => void loadCollectionOperations()}
              disabled={isLoadingCollectionOperations || !organizationId}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingCollectionOperations ? "Atualizando painel..." : "Atualizar painel"}
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Carteira aberta</p>
              <p className="mt-1 text-base font-semibold text-zinc-100">
                {formatCurrency(collectionOverview.totalOpenCents)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{collectionOverview.totalOpenCount} cobrança(s)</p>
            </article>
            <article className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-red-200/80">Atrasadas</p>
              <p className="mt-1 text-base font-semibold text-red-200">
                {formatCurrency(collectionOverview.overdueCents)}
              </p>
              <p className="mt-1 text-xs text-red-200/80">{collectionOverview.overdueCount} cobrança(s)</p>
            </article>
            <article className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-amber-200/80">Vence hoje</p>
              <p className="mt-1 text-base font-semibold text-amber-200">
                {formatCurrency(collectionOverview.dueTodayCents)}
              </p>
              <p className="mt-1 text-xs text-amber-200/80">{collectionOverview.dueTodayCount} cobrança(s)</p>
            </article>
            <article className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-emerald-200/80">Próx. 7 dias</p>
              <p className="mt-1 text-base font-semibold text-emerald-200">
                {formatCurrency(collectionOverview.dueNext7Cents)}
              </p>
              <p className="mt-1 text-xs text-emerald-200/80">{collectionOverview.dueNext7Count} cobrança(s)</p>
            </article>
          </div>

          <div className="mt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-100">Fila de follow-up</p>
                <p className="mt-1 text-xs text-zinc-500">
                  As próximas cobranças para contato rápido (prioridade para vencidas).
                </p>
              </div>
              <button
                type="button"
                onClick={openFollowUpBatchEmailModal}
                disabled={
                  isLoadingCollectionOperations ||
                  followUpInvoices.length === 0 ||
                  isSendingFollowUpEmailsBatch ||
                  Boolean(isSendingFollowUpEmailId)
                }
                className="btn-muted inline-flex items-center gap-2 self-start rounded-md px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Mail size={13} />
                {isSendingFollowUpEmailsBatch ? "Enviando em lote..." : "Enviar e-mail para todos"}
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {isLoadingCollectionOperations ? (
                <p className="text-xs text-zinc-500">Carregando fila de cobrança...</p>
              ) : followUpInvoices.length === 0 ? (
                <p className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-zinc-500">
                  Sem cobranças pendentes para follow-up.
                </p>
              ) : (
                followUpInvoices.map((item) => {
                  const hasWhatsapp = Boolean(normalizeWhatsappPhone(item.studentPhone));
                  const isOverdue = item.status === "overdue" || item.dueDate < todayIsoDate;
                  return (
                    <article key={item.invoiceId} className="rounded-md border border-white/10 bg-white/5 p-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-zinc-100">{item.studentName}</p>
                          <p className="mt-1 text-xs text-zinc-400">
                            Vencimento: {formatDate(item.dueDate)} • Aberto: {formatCurrency(item.openCents)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {isOverdue ? "Status: atrasada" : "Status: em aberto"} • Telefone:{" "}
                            {item.studentPhone || "não informado"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            E-mail: {item.studentEmail || "não informado"}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSendFollowUpWhatsapp(item)}
                            disabled={!hasWhatsapp || isSendingFollowUpEmailsBatch}
                            className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <MessageCircle size={13} />
                            WhatsApp
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSendFollowUpEmail(item)}
                            disabled={
                              isSendingFollowUpEmailsBatch ||
                              isSendingFollowUpEmailId === item.invoiceId ||
                              !item.studentEmail.trim()
                            }
                            className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Mail size={13} />
                            {isSendingFollowUpEmailId === item.invoiceId ? "Enviando..." : "E-mail"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>
        ) : null}

        {showPix ? (
        <div id="pix-generator" className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="surface rounded-md p-4 md:p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-2 block text-sm text-zinc-300">Chave PIX</span>
              <input
                value={pixKey}
                onChange={(event) => setPixKey(event.target.value)}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                placeholder="email, telefone, CPF/CNPJ ou chave aleatória"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm text-zinc-300">Valor (opcional)</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                placeholder="150.00"
                inputMode="decimal"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm text-zinc-300">TXID (opcional)</span>
              <input
                value={txid}
                onChange={(event) => setTxid(event.target.value)}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                placeholder="SHADMENSAL"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm text-zinc-300">Nome do local / recebedor</span>
              <input
                value={merchantName}
                onChange={(event) => setMerchantName(event.target.value)}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                placeholder="Shad Manager"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm text-zinc-300">Cidade</span>
              <input
                value={merchantCity}
                onChange={(event) => setMerchantCity(event.target.value)}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                placeholder="São Paulo"
              />
            </label>

            <label className="md:col-span-2">
              <span className="mb-2 block text-sm text-zinc-300">Descrição (opcional)</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                placeholder="Pagamento da mensalidade"
              />
            </label>

            <div className="surface-soft md:col-span-2 rounded-md p-3 sm:p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-sm font-semibold text-zinc-100">Personalização do template</p>
                <button
                  type="button"
                  onClick={() => void handleSaveTemplateSettings()}
                  disabled={isSavingTemplateSettings || isLoadingTemplateSettings}
                  className="btn-primary inline-flex h-9 w-full items-center justify-center rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                >
                  {isSavingTemplateSettings ? "Salvando..." : "Salvar configurações"}
                </button>
              </div>

              <div className="mt-2 space-y-1">
                {isLoadingTemplateSettings ? (
                  <p className="text-xs text-zinc-500">Carregando preferências salvas...</p>
                ) : null}
                {!isLogoColumnAvailable ? (
                  <p className="text-xs text-amber-300">
                    Migration pendente para logo: execute a `202602140001_shad-manager_qr-template-customization.sql`.
                  </p>
                ) : null}
              </div>

              <label className="mt-3 block">
                <span className="mb-1 block text-sm text-zinc-300">Template padrão do WhatsApp</span>
                <textarea
                  value={whatsappTemplate}
                  onChange={(event) => setWhatsappTemplate(event.target.value)}
                  rows={3}
                  className="field glow-focus w-full rounded-md px-3 py-2 text-xs outline-none"
                  placeholder="Ola {{student_name}}, sua mensalidade de {{amount}} vence em {{due_date}}."
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Variáveis: {"{{student_name}}"}, {"{{amount}}"}, {"{{due_date}}"},{" "}
                  {"{{days_overdue}}"}.
                </p>
              </label>

              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_minmax(210px,260px)] md:items-end">
                <div>
                  <span className="mb-1 block text-sm text-zinc-300">Logo do template</span>
                  <p className="text-xs leading-relaxed text-zinc-500">
                    Faça upload de uma imagem (PNG/JPG/WebP/SVG, até 2MB) e salve.
                  </p>
                </div>

                <label className="w-full">
                  <span className="mb-1 block text-xs text-zinc-400">Arquivo</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoFileChange}
                    disabled={!isLogoColumnAvailable}
                    className="field h-10 w-full rounded-md px-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-[var(--accent)] file:px-2.5 file:py-1.5 file:text-[10px] file:font-semibold file:text-[var(--accent-ink)]"
                  />
                </label>
              </div>

              {templateLogoUrl ? (
                <div className="mt-3 rounded-md border border-white/10 p-3">
                  <p className="mb-2 text-xs text-zinc-500">Prévia do logo</p>
                  <div
                    className="h-20 w-20 rounded-md border border-white/10 bg-white/5 bg-contain bg-center bg-no-repeat"
                    style={{ backgroundImage: `url(${templateLogoUrl})` }}
                  />
                </div>
              ) : null}
            </div>

            <div className="surface-soft md:col-span-2 rounded-md p-3 sm:p-4">
              <p className="text-sm font-semibold text-zinc-100">Cliente destino no WhatsApp</p>
              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_minmax(170px,220px)] md:items-center">
                <select
                  value={selectedClientId}
                  onChange={(event) => setSelectedClientId(event.target.value)}
                  disabled={isLoadingClients || clients.length === 0}
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">
                    {isLoadingClients
                      ? "Carregando clientes..."
                      : clients.length > 0
                        ? "Selecione um cliente"
                        : "Nenhum cliente cadastrado"}
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                <div className="inline-flex h-11 w-full items-center rounded-md border border-white/10 px-3 text-xs text-zinc-400">
                  {(selectedClient?.phone || "Telefone não informado") +
                    " • " +
                    (selectedClient?.email || "E-mail não informado")}
                </div>
              </div>
              {clientsError ? <p className="mt-2 text-xs text-red-300">{clientsError}</p> : null}
              {!isLoadingClients && clients.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-500">
                  Cadastre clientes na aba Clientes para compartilhar cobranças pelo WhatsApp.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopyKey}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <KeyRound size={14} />
              Copiar chave
            </button>
            <button
              type="button"
              onClick={handleShareKeyWhatsapp}
              disabled={!selectedClientId || isLoadingClients}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MessageCircle size={14} />
              WhatsApp (chave)
            </button>
            <button
              type="button"
              onClick={() => void handleSendPixEmail()}
              disabled={isSendingPixEmail || !selectedClientId || !selectedClient?.email.trim()}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Mail size={14} />
              {isSendingPixEmail ? "Enviando..." : "E-mail"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetFeedback();
                setPixKey("");
                setAmount("");
                setDescription("");
                setQrCodeDataUrl(null);
              }}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              Limpar
            </button>
          </div>
        </section>

        <aside className="surface rounded-md p-4 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-100">QR Code PIX</p>
            <span className="surface-soft inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-zinc-400">
              <Wallet size={12} />
              Cobrar rápido
            </span>
          </div>

          <div className="mt-3 flex min-h-[280px] items-center justify-center rounded-md border border-white/10 bg-white/5 p-3">
            {isBuildingQrCode ? (
              <p className="text-sm text-zinc-400">Gerando QR Code...</p>
            ) : qrCodeDataUrl ? (
              <Image
                src={qrCodeDataUrl}
                alt="QR Code PIX"
                width={280}
                height={280}
                unoptimized
                className="h-auto w-full max-w-[260px]"
              />
            ) : (
              <div className="text-center">
                <QrCode size={32} className="mx-auto text-zinc-500" />
                <p className="mt-3 text-sm text-zinc-400">Preencha a chave PIX para gerar automaticamente.</p>
              </div>
            )}
          </div>

          <div className="mt-4">
            <p className="text-sm font-semibold text-zinc-100">Pré-visualização do template</p>
            <div className="mt-2 flex min-h-[300px] items-center justify-center rounded-md border border-white/10 bg-white/5 p-3">
              {isBuildingTemplatePreview ? (
                <p className="text-sm text-zinc-400">Gerando pré-visualização...</p>
              ) : templatePreviewUrl ? (
                <Image
                  src={templatePreviewUrl}
                  alt="Prévia do template da cobrança"
                  width={250}
                  height={334}
                  unoptimized
                  className="h-auto w-full max-w-[220px] rounded-md border border-white/10"
                />
              ) : (
                <div className="text-center">
                  <QrCode size={28} className="mx-auto text-zinc-500" />
                  <p className="mt-3 text-sm text-zinc-400">Preencha a chave PIX para ver a arte completa.</p>
                </div>
              )}
            </div>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm text-zinc-300">PIX copia e cola</span>
            <textarea
              value={pixPayload}
              readOnly
              rows={5}
              className="field min-h-[130px] w-full rounded-md px-3 py-2 text-xs leading-relaxed outline-none"
              placeholder="O código PIX copia e cola aparece aqui."
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopyPayload}
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
            >
              <Copy size={14} />
              Copiar PIX
            </button>
            <button
              type="button"
              onClick={handleSharePayloadWhatsapp}
              disabled={!selectedClientId || isLoadingClients}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MessageCircle size={14} />
              WhatsApp (PIX)
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadQrTemplate()}
              disabled={isBuildingQrCode || isDownloadingTemplate}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={14} />
              {isDownloadingTemplate ? "Baixando..." : "Baixar QR (template)"}
            </button>
          </div>
        </aside>
        </div>
        ) : null}
        </div>
      ) : null}

      {showBaixas ? (
        <section className="surface rounded-md p-4 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-zinc-100">Baixa manual com comprovante</p>
              <p className="mt-1 text-xs text-zinc-500">
                Registre pagamento manual, adicione observação e anexe comprovante para auditoria.
              </p>
            </div>
            <span className="text-xs text-zinc-500">{openInvoices.length} em aberto</span>
          </div>

          {!isReceiptColumnAvailable ? (
            <p className="mt-2 text-xs text-amber-300">
              Migration pendente: execute a `202602140002_shad-manager_payment-receipts.sql`.
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-2 block text-sm text-zinc-300">Fatura em aberto</span>
              <select
                value={selectedInvoiceId}
                onChange={(event) => setSelectedInvoiceId(event.target.value)}
                disabled={isLoadingFinance || openInvoices.length === 0}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {isLoadingFinance
                    ? "Carregando faturas..."
                    : openInvoices.length > 0
                      ? "Selecione uma fatura"
                      : "Sem faturas em aberto"}
                </option>
                {openInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.studentName} • venc. {formatDate(invoice.dueDate)} • aberto {formatCurrency(invoice.openCents)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-2 block text-sm text-zinc-300">Valor da baixa</span>
              <input
                value={settlementAmount}
                onChange={(event) => setSettlementAmount(event.target.value)}
                disabled={!selectedSettlementInvoice}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="150.00"
                inputMode="decimal"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm text-zinc-300">Método</span>
              <select
                value={settlementMethod}
                onChange={(event) => setSettlementMethod(event.target.value as PaymentMethod)}
                className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
              >
                <option value="pix">PIX</option>
                <option value="cash">Dinheiro</option>
                <option value="card">Cartão</option>
                <option value="transfer">Transferência</option>
                <option value="other">Outro</option>
              </select>
            </label>

            <label className="md:col-span-2">
              <span className="mb-2 block text-sm text-zinc-300">Observação (opcional)</span>
              <textarea
                value={settlementNotes}
                onChange={(event) => setSettlementNotes(event.target.value)}
                rows={3}
                className="field glow-focus w-full rounded-md px-3 py-2 text-sm outline-none"
                placeholder="Ex.: pagamento confirmado presencialmente."
              />
            </label>

            <label className="md:col-span-2">
              <span className="mb-2 block text-sm text-zinc-300">Comprovante (imagem ou PDF, até 2MB)</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleReceiptFileChange}
                className="field h-10 w-full rounded-md px-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-[var(--accent)] file:px-2.5 file:py-1.5 file:text-[10px] file:font-semibold file:text-[var(--accent-ink)]"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSettleInvoice()}
              disabled={!selectedSettlementInvoice || isSettlingInvoice}
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSettlingInvoice ? "Registrando..." : "Registrar baixa"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSettlementNotes("");
                setReceiptDataUrl("");
                setReceiptFileName("");
              }}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              Limpar anexo
            </button>
          </div>

          {selectedSettlementInvoice ? (
            <div className="mt-3 rounded-md border border-white/10 bg-white/5 p-3 text-xs text-zinc-300">
              <p>Saldo aberto: {formatCurrency(selectedSettlementInvoice.openCents)}</p>
              <p>Total da fatura: {formatCurrency(selectedSettlementInvoice.totalCents)}</p>
              <p>Status: {selectedSettlementInvoice.status}</p>
            </div>
          ) : null}

          {receiptFileName ? (
            <p className="mt-2 text-xs text-zinc-400">Comprovante anexado: {receiptFileName}</p>
          ) : null}
        </section>
      ) : null}

      {showRelatorios ? (
        <section className="surface rounded-md p-4 md:p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-zinc-100">Exportação financeira</p>
              <p className="mt-1 text-xs text-zinc-500">
                Gere CSV ou PDF mensal com recebidos, pendentes e atrasados.
              </p>
            </div>
            <label>
              <span className="sr-only">Mês de referência</span>
              <input
                type="month"
                value={referenceMonth}
                onChange={(event) => setReferenceMonth(event.target.value)}
                className="field glow-focus h-9 rounded-md px-2 text-xs outline-none"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-emerald-200/80">Recebido</p>
              <p className="mt-1 text-sm font-semibold text-emerald-200">{formatCurrency(monthlySummary.receivedCents)}</p>
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-amber-200/80">Pendente</p>
              <p className="mt-1 text-sm font-semibold text-amber-200">{formatCurrency(monthlySummary.pendingCents)}</p>
            </div>
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-red-200/80">Atrasado</p>
              <p className="mt-1 text-sm font-semibold text-red-200">{formatCurrency(monthlySummary.overdueCents)}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isExportingCsv || isLoadingMonthlyReport}
              className="btn-primary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={14} />
              {isExportingCsv ? "Exportando CSV..." : "Exportar CSV"}
            </button>
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={isExportingPdf || isLoadingMonthlyReport}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={14} />
              {isExportingPdf ? "Exportando PDF..." : "Exportar PDF"}
            </button>
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Histórico de recebimentos (mês)</p>
            <div className="mt-2 space-y-2">
              {isLoadingMonthlyReport ? (
                <p className="text-xs text-zinc-500">Carregando relatório...</p>
              ) : monthlyReport.payments.length === 0 ? (
                <p className="text-xs text-zinc-500">Sem recebimentos no mês selecionado.</p>
              ) : (
                monthlyReport.payments.slice(0, 10).map((payment) => (
                  <div key={payment.id} className="rounded-md border border-white/10 p-2 text-xs">
                    <p className="font-semibold text-zinc-100">
                      {payment.studentName} • {formatCurrency(payment.amount_cents)}
                    </p>
                    <p className="mt-1 text-zinc-400">
                      {formatDateTime(payment.paid_at)} • {methodLabel(payment.method)}
                    </p>
                    {payment.notes ? <p className="mt-1 text-zinc-400">Obs: {payment.notes}</p> : null}
                    {payment.receipt_url ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenReceipt(payment.id, payment.receipt_url ?? "", payment.receipt_file_name)
                        }
                        className="mt-1 inline-flex text-[11px] text-[var(--accent)] hover:underline"
                      >
                        Abrir comprovante
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          {receiptPreview ? (
            <div className="mt-4 rounded-md border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-100">Pré-visualização do comprovante</p>
                <button
                  type="button"
                  onClick={() => setReceiptPreview(null)}
                  className="btn-muted inline-flex h-8 items-center rounded-md px-2 text-xs"
                >
                  Fechar
                </button>
              </div>

              <p className="mt-1 text-xs text-zinc-500">{receiptPreview.fileName}</p>

              <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-black/10">
                {receiptPreview.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={receiptPreview.url}
                    alt={receiptPreview.fileName}
                    className="mx-auto h-[560px] w-full object-contain"
                  />
                ) : receiptPreview.kind === "pdf" ? (
                  <iframe
                    title={`Comprovante ${receiptPreview.paymentId}`}
                    src={receiptPreview.url}
                    className="h-[560px] w-full"
                  />
                ) : (
                  <div className="p-4 text-xs text-zinc-400">
                    Não foi possível pré-visualizar esse formato de comprovante.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {showFollowUpBatchEmailModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="surface w-full max-w-md rounded-md border border-white/10 p-5">
            <p className="text-base font-semibold text-zinc-100">Enviar e-mails da lista</p>
            <p className="mt-2 text-sm text-zinc-300">
              Você vai enviar e-mail para <strong>{followUpWithEmailCount}</strong>{" "}
              {followUpWithEmailCount === 1 ? "pessoa" : "pessoas"} da lista de cobrança.
            </p>
            {followUpWithoutEmailCount > 0 ? (
              <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                {followUpWithoutEmailCount}{" "}
                {followUpWithoutEmailCount === 1 ? "cliente está sem e-mail" : "clientes estão sem e-mail"} e
                {followUpWithoutEmailCount === 1 ? " será ignorado." : " serão ignorados."}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-zinc-500">
              Esse envio pode demorar alguns segundos. Você pode acompanhar a mensagem de resultado ao final.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeFollowUpBatchEmailModal}
                disabled={isSendingFollowUpEmailsBatch}
                className="btn-muted rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void handleSendAllFollowUpEmails()}
                disabled={isSendingFollowUpEmailsBatch || followUpWithEmailCount === 0}
                className="btn-primary rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSendingFollowUpEmailsBatch ? "Enviando..." : "Enviar agora"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
