"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Database, Download, Palette, RefreshCcw, Trash2, Upload, X } from "lucide-react";
import {
  DEFAULT_SITE_ACCENT_COLOR,
  emitBrandingChange,
  normalizeHexColor,
} from "@/lib/shad-manager/branding";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";

interface BrandingSettingsRow {
  site_logo_url: string | null;
  site_accent_color: string | null;
}

type OrgRole = "owner" | "admin" | "staff";

export function OrganizacaoView() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("Sua empresa");
  const [userRole, setUserRole] = useState<OrgRole>("staff");
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const [siteAccentColor, setSiteAccentColor] = useState(DEFAULT_SITE_ACCENT_COLOR);
  const [isBrandingColumnsAvailable, setIsBrandingColumnsAvailable] = useState(true);

  const canManageSettings = userRole === "owner" || userRole === "admin";
  const normalizedAccentColor = normalizeHexColor(siteAccentColor);
  const modalRoot = typeof document === "undefined" ? null : document.body;
  const backupColumns = useMemo(
    () => ({
      organization: "id, name, slug, active, created_at, updated_at",
      settings: isBrandingColumnsAvailable
        ? "organization_id, timezone, currency_code, whatsapp_template, site_logo_url, site_accent_color, created_at, updated_at"
        : "organization_id, timezone, currency_code, whatsapp_template, created_at, updated_at",
      students:
        "id, organization_id, full_name, phone, postal_code, address_number, billing_cycle, amount_cents, due_day, status, notes, created_at, updated_at",
      invoices:
        "id, organization_id, student_id, reference_period_start, reference_period_end, due_date, amount_cents, paid_amount_cents, status, paid_at, canceled_at, metadata, created_at, updated_at",
      payments:
        "id, organization_id, invoice_id, student_id, amount_cents, method, paid_at, notes, created_at",
    }),
    [isBrandingColumnsAvailable]
  );

  const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Selecione um arquivo de imagem para a logo.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("Logo muito grande. Use uma imagem de até 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSiteLogoUrl(String(reader.result ?? ""));
      setSuccessMessage("Logo carregada. Clique em salvar personalização.");
      setErrorMessage(null);
    };
    reader.onerror = () => {
      setErrorMessage("Não foi possível ler o arquivo da logo.");
    };
    reader.readAsDataURL(file);
  };

  const handleAccentHexInput = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      setSiteAccentColor(DEFAULT_SITE_ACCENT_COLOR);
      return;
    }

    const withHash = normalized.startsWith("#") ? normalized : `#${normalized}`;
    setSiteAccentColor(withHash.slice(0, 7));
  };

  const loadBrandingSettings = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: orgContext, error: orgError } = await getUserOrgContext(supabase);

      if (orgError || !orgContext) {
        throw new Error(orgError ?? "Falha ao validar a organização.");
      }

      setUserRole(orgContext.role as OrgRole);
      setOrganizationId(orgContext.organizationId);

      const [orgResponse, settingsResponse] = await Promise.all([
        supabase
          .from("organizations")
          .select("name")
          .eq("id", orgContext.organizationId)
          .maybeSingle(),
        supabase
          .from("organization_settings")
          .select("site_logo_url, site_accent_color")
          .eq("organization_id", orgContext.organizationId)
          .maybeSingle(),
      ]);

      if (orgResponse.error) {
        throw new Error(orgResponse.error.message);
      }

      setOrganizationName(orgResponse.data?.name?.trim() || "Sua empresa");

      if (settingsResponse.error) {
        const normalizedMessage = settingsResponse.error.message.toLowerCase();
        const missingLogoColumn =
          normalizedMessage.includes("site_logo_url") && normalizedMessage.includes("does not exist");
        const missingAccentColumn =
          normalizedMessage.includes("site_accent_color") &&
          normalizedMessage.includes("does not exist");

        if (missingLogoColumn || missingAccentColumn) {
          setIsBrandingColumnsAvailable(false);
          setSiteLogoUrl("");
          setSiteAccentColor(DEFAULT_SITE_ACCENT_COLOR);
          return;
        }

        throw new Error(settingsResponse.error.message);
      }

      setIsBrandingColumnsAvailable(true);
      const branding = settingsResponse.data as BrandingSettingsRow | null;
      setSiteLogoUrl(branding?.site_logo_url?.trim() ?? "");
      setSiteAccentColor(normalizeHexColor(branding?.site_accent_color));

    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erro ao carregar as configurações de personalização.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBrandingSettings();
  }, [loadBrandingSettings]);

  const handleSaveBranding = async () => {
    if (!organizationId) {
      setErrorMessage("Organização não encontrada.");
      return;
    }

    if (!canManageSettings) {
      setErrorMessage("Você não possui permissão para alterar a personalização.");
      return;
    }

    if (!isBrandingColumnsAvailable) {
      setErrorMessage(
        "Seu banco ainda não possui as colunas de personalização. Execute a migration 202602140002."
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("organization_settings")
        .update({
          site_logo_url: siteLogoUrl.trim(),
          site_accent_color: normalizeHexColor(siteAccentColor),
        })
        .eq("organization_id", organizationId);

      if (error) {
        const normalizedMessage = error.message.toLowerCase();
        const missingLogoColumn =
          normalizedMessage.includes("site_logo_url") && normalizedMessage.includes("does not exist");
        const missingAccentColumn =
          normalizedMessage.includes("site_accent_color") &&
          normalizedMessage.includes("does not exist");

        if (missingLogoColumn || missingAccentColumn) {
          setIsBrandingColumnsAvailable(false);
          throw new Error(
            "As colunas de personalização ainda não existem no banco. Execute a migration 202602140002."
          );
        }

        throw new Error(error.message);
      }

      setSiteAccentColor(normalizeHexColor(siteAccentColor));
      emitBrandingChange({
        logoUrl: siteLogoUrl.trim(),
        accentColor: normalizeHexColor(siteAccentColor),
      });
      setSuccessMessage("Personalização salva com sucesso.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível salvar a personalização.";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetBranding = async () => {
    if (!organizationId) {
      setErrorMessage("Organização não encontrada.");
      return;
    }

    if (!canManageSettings) {
      setErrorMessage("Você não possui permissão para alterar a personalização.");
      return;
    }

    if (!isBrandingColumnsAvailable) {
      setErrorMessage(
        "Seu banco ainda não possui as colunas de personalização. Execute a migration 202602140002."
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("organization_settings")
        .update({
          site_logo_url: "",
          site_accent_color: DEFAULT_SITE_ACCENT_COLOR,
        })
        .eq("organization_id", organizationId);

      if (error) {
        throw new Error(error.message);
      }

      setSiteLogoUrl("");
      setSiteAccentColor(DEFAULT_SITE_ACCENT_COLOR);
      emitBrandingChange({
        logoUrl: "",
        accentColor: DEFAULT_SITE_ACCENT_COLOR,
      });
      setSuccessMessage("Personalização restaurada para o padrão.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível restaurar a personalização padrão.";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const downloadJson = (filename: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const buildBackupFilename = (orgId: string) => {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
    ].join("");
    return `backup-${orgId.slice(0, 8)}-${stamp}.json`;
  };

  const chunkArray = <T,>(items: T[], size: number) => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  };

  const createUuid = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const toHex = (value: number) => value.toString(16).padStart(2, "0");
    const hex = Array.from(bytes, toHex).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  const handleExportBackup = async () => {
    if (!organizationId) {
      setErrorMessage("Organização não encontrada.");
      return;
    }

    setIsExporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const [orgResponse, settingsResponse, studentsResponse, invoicesResponse, paymentsResponse] =
        await Promise.all([
          supabase
            .from("organizations")
            .select(backupColumns.organization)
            .eq("id", organizationId)
            .maybeSingle(),
          supabase
            .from("organization_settings")
            .select(backupColumns.settings)
            .eq("organization_id", organizationId)
            .maybeSingle(),
          supabase
            .from("students")
            .select(backupColumns.students)
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: true }),
          supabase
            .from("invoices")
            .select(backupColumns.invoices)
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: true }),
          supabase
            .from("payments")
            .select(backupColumns.payments)
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: true }),
        ]);

      if (orgResponse.error) throw new Error(orgResponse.error.message);
      if (settingsResponse.error) throw new Error(settingsResponse.error.message);
      if (studentsResponse.error) throw new Error(studentsResponse.error.message);
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);
      if (paymentsResponse.error) throw new Error(paymentsResponse.error.message);

      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        organization_id: organizationId,
        data: {
          organization: orgResponse.data ?? null,
          settings: settingsResponse.data ?? null,
          students: studentsResponse.data ?? [],
          invoices: invoicesResponse.data ?? [],
          payments: paymentsResponse.data ?? [],
        },
      };

      downloadJson(buildBackupFilename(organizationId), payload);
      setSuccessMessage("Backup gerado com sucesso.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao gerar backup.";
      setErrorMessage(message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackupFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setBackupFile(file);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleImportBackup = async () => {
    if (!organizationId) {
      setErrorMessage("Organização não encontrada.");
      return;
    }

    if (!canManageSettings) {
      setErrorMessage("Você não possui permissão para importar backup.");
      return;
    }

    if (!backupFile) {
      setErrorMessage("Selecione um arquivo de backup.");
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const content = await backupFile.text();
      const payload = JSON.parse(content) as {
        version?: number;
        organization_id?: string;
        data?: {
          organization?: Record<string, unknown> | null;
          settings?: Record<string, unknown> | null;
          students?: Record<string, unknown>[];
          invoices?: Record<string, unknown>[];
          payments?: Record<string, unknown>[];
        };
      };

      if (!payload || payload.version !== 1 || !payload.data) {
        throw new Error("Arquivo de backup inválido.");
      }

      const isForeignBackup =
        Boolean(payload.organization_id) && payload.organization_id !== organizationId;

      const supabase = getSupabaseBrowserClient();
      let students = payload.data.students ?? [];
      let invoices = payload.data.invoices ?? [];
      let payments = payload.data.payments ?? [];
      let skippedStudents = 0;

      if (isForeignBackup) {
        const studentIdMap = new Map<string, string>();
        const invoiceIdMap = new Map<string, string>();

        students = students.map((row) => {
          const oldId = String(row.id ?? "");
          const nextId = createUuid();
          if (oldId) {
            studentIdMap.set(oldId, nextId);
          }
          return { ...row, id: nextId };
        });

        invoices = invoices.flatMap((row) => {
          const oldStudentId = String(row.student_id ?? "");
          const mappedStudentId = studentIdMap.get(oldStudentId);
          if (!mappedStudentId) return [];
          const oldId = String(row.id ?? "");
          const nextId = createUuid();
          if (oldId) {
            invoiceIdMap.set(oldId, nextId);
          }
          return [{ ...row, id: nextId, student_id: mappedStudentId }];
        });

        payments = payments.flatMap((row) => {
          const oldStudentId = String(row.student_id ?? "");
          const oldInvoiceId = String(row.invoice_id ?? "");
          const mappedStudentId = studentIdMap.get(oldStudentId);
          const mappedInvoiceId = invoiceIdMap.get(oldInvoiceId);
          if (!mappedStudentId || !mappedInvoiceId) return [];
          return [
            {
              ...row,
              id: createUuid(),
              student_id: mappedStudentId,
              invoice_id: mappedInvoiceId,
            },
          ];
        });
      }

      const normalizePhone = (value: unknown) =>
        String(value ?? "").replace(/\D/g, "");
      const normalizeName = (value: unknown) =>
        String(value ?? "").trim().toLowerCase();
      const buildStudentKey = (row: Record<string, unknown>) => {
        const name = normalizeName(row.full_name);
        const phone = normalizePhone(row.phone);
        return `${name}|${phone}`;
      };

      if (!replaceOnImport) {
        const { data: existingStudents, error: existingStudentsError } = await supabase
          .from("students")
          .select("full_name, phone")
          .eq("organization_id", organizationId);

        if (existingStudentsError) {
          throw new Error(existingStudentsError.message);
        }

        const existingKeys = new Set(
          (existingStudents ?? []).map((row) =>
            buildStudentKey(row as Record<string, unknown>)
          )
        );
        const seenKeys = new Set<string>();

        const filteredStudents: Record<string, unknown>[] = [];
        const allowedStudentIds = new Set<string>();

        for (const row of students) {
          const key = buildStudentKey(row);
          if (seenKeys.has(key) || existingKeys.has(key)) {
            skippedStudents += 1;
            continue;
          }
          seenKeys.add(key);
          filteredStudents.push(row);
          allowedStudentIds.add(String(row.id ?? ""));
        }

        students = filteredStudents;
        invoices = invoices.filter((row) => allowedStudentIds.has(String(row.student_id ?? "")));
        payments = payments.filter((row) => allowedStudentIds.has(String(row.student_id ?? "")));
      }

      if (replaceOnImport) {
        const { error: paymentsError } = await supabase
          .from("payments")
          .delete()
          .eq("organization_id", organizationId);
        if (paymentsError) throw new Error(paymentsError.message);

        const { error: invoicesError } = await supabase
          .from("invoices")
          .delete()
          .eq("organization_id", organizationId);
        if (invoicesError) throw new Error(invoicesError.message);

        const { error: studentsError } = await supabase
          .from("students")
          .delete()
          .eq("organization_id", organizationId);
        if (studentsError) throw new Error(studentsError.message);
      }

      if (payload.data.organization && !isForeignBackup) {
        const orgPayload = payload.data.organization as Record<string, unknown>;
        const nextOrgData: Record<string, unknown> = {};
        if (typeof orgPayload.name === "string" && orgPayload.name.trim()) {
          nextOrgData.name = orgPayload.name.trim();
        }
        if (typeof orgPayload.active === "boolean") {
          nextOrgData.active = orgPayload.active;
        }

        if (Object.keys(nextOrgData).length > 0) {
          const { error } = await supabase
            .from("organizations")
            .update(nextOrgData)
            .eq("id", organizationId);
          if (error) throw new Error(error.message);
        }
      }

      if (payload.data.settings) {
        const { created_by: _createdBy, ...settingsData } = payload.data.settings as Record<
          string,
          unknown
        >;
        if (!isBrandingColumnsAvailable) {
          delete settingsData.site_logo_url;
          delete settingsData.site_accent_color;
        }
        const { error } = await supabase
          .from("organization_settings")
          .upsert({ ...settingsData, organization_id: organizationId }, { onConflict: "organization_id" });
        if (error) throw new Error(error.message);
      }

      const upsertChunks = async (table: string, rows: Record<string, unknown>[]) => {
        const chunks = chunkArray(rows, 500);
        for (const chunk of chunks) {
          const cleaned = chunk.map((row) => {
            const { created_by: _createdBy, ...rest } = row as Record<string, unknown>;
            return { ...rest, organization_id: organizationId };
          });
          if (cleaned.length === 0) continue;
          const { error } = await supabase.from(table).upsert(cleaned, { onConflict: "id" });
          if (error) throw new Error(error.message);
        }
      };

      await upsertChunks("students", students);
      await upsertChunks("invoices", invoices);
      await upsertChunks("payments", payments);

      setBackupFile(null);
      setReplaceOnImport(false);
      const baseMessage = isForeignBackup
        ? "Backup importado e associado à organização atual."
        : "Backup importado com sucesso.";
      setSuccessMessage(
        skippedStudents > 0
          ? `${baseMessage} ${skippedStudents} cliente(s) duplicado(s) foram ignorados.`
          : baseMessage
      );
      await loadBrandingSettings();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao importar backup.";
      setErrorMessage(message);
    } finally {
      setIsImporting(false);
    }
  };

  const openDeleteDataModal = () => {
    setDeletePassword("");
    setShowDeleteDataModal(true);
  };

  const closeDeleteDataModal = () => {
    if (isDeletingData) return;
    setShowDeleteDataModal(false);
    setDeletePassword("");
  };

  const handleDeleteAllData = async () => {
    if (!organizationId) {
      setErrorMessage("Organização não encontrada.");
      return;
    }

    if (!canManageSettings) {
      setErrorMessage("Você não possui permissão para excluir dados.");
      return;
    }

    if (!deletePassword.trim()) {
      setErrorMessage("Informe sua senha para confirmar.");
      return;
    }

    setIsDeletingData(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user?.email) {
        throw new Error("Sessão inválida. Refaça o login.");
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: deletePassword,
      });

      if (authError) {
        throw new Error("Senha incorreta.");
      }

      const { error: paymentsError } = await supabase
        .from("payments")
        .delete()
        .eq("organization_id", organizationId);
      if (paymentsError) throw new Error(paymentsError.message);

      const { error: invoicesError } = await supabase
        .from("invoices")
        .delete()
        .eq("organization_id", organizationId);
      if (invoicesError) throw new Error(invoicesError.message);

      const { error: studentsError } = await supabase
        .from("students")
        .delete()
        .eq("organization_id", organizationId);
      if (studentsError) throw new Error(studentsError.message);

      setSuccessMessage("Todos os dados operacionais foram excluídos.");
      setShowDeleteDataModal(false);
      setDeletePassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao excluir dados.";
      setErrorMessage(message);
    } finally {
      setIsDeletingData(false);
    }
  };

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-3xl border-l-4 border-amber-400/60 px-4 py-6 pl-5 md:px-6 md:py-7 md:pl-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold leading-tight text-zinc-100 sm:text-4xl">
              Personalização da instância
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              Ajuste a identidade visual da sua conta com cores e logo personalizadas.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadBrandingSettings()}
            disabled={isLoading}
            className="btn-muted inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            <RefreshCcw size={14} />
            Atualizar
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div className="surface rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="surface rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {successMessage}
        </div>
      ) : null}

      <section className="surface rounded-3xl p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Visual do painel</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Empresa: {organizationName}
            </p>
          </div>
          <div className="surface-soft inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-400">
            <Palette size={14} />
            Branding
          </div>
        </div>

        {!isBrandingColumnsAvailable ? (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            As colunas de personalização ainda não existem no banco. Execute a migration
            `202602140002_shad-manager_site-branding.sql`.
          </div>
        ) : null}

        {!canManageSettings ? (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Seu perfil pode visualizar, mas apenas administrador/proprietário pode salvar alterações.
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm text-zinc-300">Cor principal</span>
              <div className="grid gap-2 sm:grid-cols-[58px_1fr]">
                <input
                  type="color"
                  value={normalizedAccentColor}
                  onChange={(event) => setSiteAccentColor(normalizeHexColor(event.target.value))}
                  className="field h-11 w-full cursor-pointer rounded-xl p-1"
                  disabled={!canManageSettings || !isBrandingColumnsAvailable || isLoading}
                />
                <input
                  value={siteAccentColor}
                  onChange={(event) => handleAccentHexInput(event.target.value)}
                  onBlur={() => setSiteAccentColor(normalizeHexColor(siteAccentColor))}
                  className="field glow-focus h-11 w-full rounded-xl px-3 text-sm uppercase outline-none"
                  placeholder="#F07F1D"
                  maxLength={7}
                  disabled={!canManageSettings || !isBrandingColumnsAvailable || isLoading}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">Formato aceito: #RRGGBB.</p>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-zinc-300">Logo da instância</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleLogoFileChange}
                className="field h-11 w-full rounded-xl px-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-[var(--accent)] file:px-2.5 file:py-1.5 file:text-[11px] file:font-semibold file:text-[var(--accent-ink)]"
                disabled={!canManageSettings || !isBrandingColumnsAvailable || isLoading}
              />
              <p className="mt-2 text-xs text-zinc-500">
                PNG, JPG, WebP ou SVG com tamanho máximo de 2MB.
              </p>
            </label>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-zinc-500">Prévia</p>
            <div className="mt-2 overflow-hidden rounded-xl border border-white/10">
              <div className="h-2 w-full" style={{ backgroundColor: normalizedAccentColor }} />
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="surface-soft flex h-12 w-28 items-center justify-center overflow-hidden rounded-lg px-2">
                  {siteLogoUrl ? (
                    <img
                      src={siteLogoUrl}
                      alt="Logo personalizada"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs font-semibold text-zinc-500">Sua logo</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">{organizationName}</p>
                  <p className="text-xs text-zinc-500">Cor aplicada em botões e destaques.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleResetBranding()}
          disabled={!canManageSettings || isSaving || isLoading || !isBrandingColumnsAvailable}
          className="btn-muted mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSaving ? "Processando..." : "Voltar ao padrão"}
        </button>

        <button
          type="button"
          onClick={() => void handleSaveBranding()}
          disabled={!canManageSettings || isSaving || isLoading || !isBrandingColumnsAvailable}
          className="btn-primary mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSaving ? "Salvando..." : "Salvar personalização"}
        </button>
      </section>

      <section className="surface rounded-3xl p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Backup do sistema</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Exporte e importe dados da organização em um arquivo JSON.
            </p>
          </div>
          <div className="surface-soft inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-400">
            <Database size={14} />
            Backup
          </div>
        </div>

        {!canManageSettings ? (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Seu perfil pode exportar, mas apenas administrador/proprietário pode importar backups.
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-zinc-100">Exportar dados</p>
            <p className="mt-1 text-xs text-zinc-500">
              Inclui clientes, cobranças, pagamentos e configurações.
            </p>
            <button
              type="button"
              onClick={() => void handleExportBackup()}
              disabled={isExporting || isLoading}
              className="btn-primary mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Download size={16} />
              {isExporting ? "Gerando..." : "Gerar backup"}
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-zinc-100">Importar backup</p>
            <p className="mt-1 text-xs text-zinc-500">
              O arquivo deve ser JSON gerado pelo sistema.
            </p>
            <input
              type="file"
              accept="application/json"
              onChange={handleBackupFileChange}
              className="field mt-3 h-11 w-full rounded-xl px-2 text-xs"
              disabled={!canManageSettings || isImporting || isLoading}
            />
            <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={replaceOnImport}
                onChange={(event) => setReplaceOnImport(event.target.checked)}
                disabled={!canManageSettings || isImporting || isLoading}
                className="h-4 w-4 rounded border-white/20"
              />
              Substituir dados atuais antes de importar
            </label>
            <button
              type="button"
              onClick={() => void handleImportBackup()}
              disabled={!canManageSettings || !backupFile || isImporting || isLoading}
              className="btn-muted mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Upload size={16} />
              {isImporting ? "Importando..." : "Importar backup"}
            </button>
          </div>
        </div>
      </section>

      <section className="surface rounded-3xl border border-red-500/25 bg-red-500/5 p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-red-100">Zona de risco</h3>
            <p className="mt-1 text-sm text-red-200/70">
              Exclua todos os dados operacionais (clientes, cobranças e pagamentos).
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
            <Trash2 size={14} />
            Exclusão total
          </div>
        </div>

        <button
          type="button"
          onClick={openDeleteDataModal}
          disabled={!canManageSettings || isDeletingData || isLoading}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/20 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 size={16} />
          {isDeletingData ? "Excluindo..." : "Excluir todos os dados"}
        </button>
      </section>
      {showDeleteDataModal && modalRoot
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10">
              <div className="surface animate-scale-in w-full max-w-md rounded-2xl border border-red-500/30 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-red-100">Excluir todos os dados</h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      Essa ação remove clientes, cobranças e pagamentos. Não pode ser desfeita.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Fechar modal"
                    onClick={closeDeleteDataModal}
                    disabled={isDeletingData}
                    className="btn-muted rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <X size={16} />
                  </button>
                </div>

                <label className="mt-5 block">
                  <span className="mb-2 block text-sm text-zinc-300">Digite sua senha</span>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                    className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                    placeholder="Senha da conta"
                    disabled={isDeletingData}
                  />
                </label>

                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDeleteDataModal}
                    disabled={isDeletingData}
                    className="btn-muted rounded-md px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAllData()}
                    disabled={isDeletingData}
                    className="inline-flex items-center justify-center rounded-md border border-red-500/40 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeletingData ? "Excluindo..." : "Excluir agora"}
                  </button>
                </div>
              </div>
            </div>,
            modalRoot
          )
        : null}
    </section>
  );
}
