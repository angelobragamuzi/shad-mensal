"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Copy, Download, KeyRound, MessageCircle, QrCode, Wallet } from "lucide-react";
import { buildPixPayload } from "@/lib/shad-manager/pix";
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
}

interface TemplateSettingsRow {
  organization_id: string;
  qr_template_logo_url: string | null;
}

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

export function CobrancasView() {
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
  const [isLoadingTemplateSettings, setIsLoadingTemplateSettings] = useState(true);
  const [isSavingTemplateSettings, setIsSavingTemplateSettings] = useState(false);
  const [isLogoColumnAvailable, setIsLogoColumnAvailable] = useState(true);

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

  const resetFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  useEffect(() => {
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
  }, [pixPayload]);

  useEffect(() => {
    let isCancelled = false;

    const loadClients = async () => {
      setIsLoadingClients(true);
      setClientsError(null);

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("students")
          .select("id, full_name, phone")
          .order("full_name", { ascending: true });

        if (error) {
          throw new Error(error.message);
        }

        const nextClients = (data ?? []).map((row) => ({
          id: String(row.id),
          name: String(row.full_name ?? "Cliente"),
          phone: String(row.phone ?? ""),
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
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadTemplateSettings = async () => {
      setIsLoadingTemplateSettings(true);

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("organization_settings")
          .select("organization_id, qr_template_logo_url")
          .limit(1)
          .maybeSingle();

        if (error) {
          const normalizedMessage = error.message.toLowerCase();
          if (
            normalizedMessage.includes("qr_template_logo_url") &&
            normalizedMessage.includes("does not exist")
          ) {
            setIsLogoColumnAvailable(false);

            const fallback = await supabase
              .from("organization_settings")
              .select("organization_id")
              .limit(1)
              .maybeSingle();

            if (fallback.error) {
              throw new Error(fallback.error.message);
            }

            if (isCancelled) return;

            setOrganizationId((fallback.data?.organization_id as string | undefined) ?? null);
            setTemplateLogoUrl("");
            setErrorMessage(
              "A coluna qr_template_logo_url ainda não existe no banco. Rode a migration 202602140001 para habilitar o salvamento do logo."
            );
            return;
          }
          throw new Error(error.message);
        }

        if (isCancelled) return;

        setIsLogoColumnAvailable(true);
        const row = data as TemplateSettingsRow | null;
        if (!row) {
          setOrganizationId(null);
          return;
        }

        setOrganizationId(row.organization_id);
        setTemplateLogoUrl(row.qr_template_logo_url?.trim() ?? "");
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
  }, []);

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

    if (!isLogoColumnAvailable) {
      setErrorMessage(
        "Banco sem suporte para logo do template. Execute a migration 202602140001 e tente salvar novamente."
      );
      return;
    }

    setIsSavingTemplateSettings(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("organization_settings")
        .update({
          qr_template_logo_url: templateLogoUrl.trim(),
        })
        .eq("organization_id", organizationId);

      if (error) {
        const normalizedMessage = error.message.toLowerCase();
        if (
          normalizedMessage.includes("qr_template_logo_url") &&
          normalizedMessage.includes("does not exist")
        ) {
          setIsLogoColumnAvailable(false);
          throw new Error(
            "A coluna qr_template_logo_url não existe no banco. Execute a migration 202602140001."
          );
        }
        throw new Error(error.message);
      }

      setSuccessMessage("Logo do template salvo.");
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
      const rootStyles = getComputedStyle(document.documentElement);
      const background = rootStyles.getPropertyValue("--background").trim() || "#f2f2f2";
      const card = rootStyles.getPropertyValue("--card").trim() || "#ffffff";
      const border = rootStyles.getPropertyValue("--border").trim() || "#d8d8d8";
      const foregroundStrong = rootStyles.getPropertyValue("--foreground-strong").trim() || "#0d0d0d";
      const muted = rootStyles.getPropertyValue("--muted").trim() || "#616161";
      const accent = rootStyles.getPropertyValue("--accent").trim() || "#f07f1d";
      const placeName = merchantName.trim() || "Shad Manager";

      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1440;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Não foi possível preparar o download do template.");
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
      const clientLabel = selectedClient?.name ? `Cliente: ${selectedClient.name}` : "Cliente: não informado";
      ctx.fillText(clientLabel, cardX + 54, cardY + 150);

      const customLogo = templateLogoUrl.trim();
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

      if (amount.trim()) {
        ctx.fillStyle = foregroundStrong;
        ctx.font = "700 46px Sora, Segoe UI, sans-serif";
        ctx.fillText(`R$ ${amount.trim()}`, cardX + 54, cardY + 218);
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

      const qrImage = await loadImage(qrCodeDataUrl);
      const qrSize = 560;
      const qrX = qrContainerX + (qrContainerSize - qrSize) / 2;
      const qrY = qrContainerY + (qrContainerSize - qrSize) / 2;
      ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      ctx.fillStyle = foregroundStrong;
      ctx.font = "600 34px Sora, Segoe UI, sans-serif";
      ctx.fillText("Escaneie para pagar", cardX + 54, qrContainerY + qrContainerSize + 78);

      ctx.fillStyle = muted;
      ctx.font = "500 25px Sora, Segoe UI, sans-serif";
      const cityLine = `Recebedor: ${placeName} • ${merchantCity}`;
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

      const fileSuffix = selectedClient?.name ? slugifyName(selectedClient.name) : "cliente";
      const anchor = document.createElement("a");
      anchor.href = canvas.toDataURL("image/png");
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

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-md border-l-2 border-[var(--accent)] px-4 py-6 md:px-6 md:py-7">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Cobranças</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100 md:text-3xl">
              PIX, cobrança e template
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              Gere um QR Code PIX na hora e baixe a arte pronta no padrão visual do sistema.
            </p>
          </div>
          <span className="surface-soft inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs text-zinc-400">
            Atualização em tempo real
          </span>
        </div>
      </header>

      {payloadError ? (
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

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
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
                  disabled={isSavingTemplateSettings || isLoadingTemplateSettings || !isLogoColumnAvailable}
                  className="btn-primary inline-flex h-9 w-full items-center justify-center rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                >
                  {isSavingTemplateSettings ? "Salvando..." : "Salvar logo"}
                </button>
              </div>

              <div className="mt-2 space-y-1">
                {isLoadingTemplateSettings ? (
                  <p className="text-xs text-zinc-500">Carregando preferências salvas...</p>
                ) : null}
                {!isLogoColumnAvailable ? (
                  <p className="text-xs text-amber-300">
                    Migration pendente: execute a `202602140001_shad-manager_qr-template-customization.sql`.
                  </p>
                ) : null}
              </div>

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
                  {selectedClient?.phone || "Telefone não informado"}
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
    </section>
  );
}


