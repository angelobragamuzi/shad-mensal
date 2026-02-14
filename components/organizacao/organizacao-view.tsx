"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Palette, RefreshCcw } from "lucide-react";
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("Sua empresa");
  const [userRole, setUserRole] = useState<OrgRole>("staff");

  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const [siteAccentColor, setSiteAccentColor] = useState(DEFAULT_SITE_ACCENT_COLOR);
  const [isBrandingColumnsAvailable, setIsBrandingColumnsAvailable] = useState(true);

  const canManageSettings = userRole === "owner" || userRole === "admin";
  const normalizedAccentColor = normalizeHexColor(siteAccentColor);

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
    </section>
  );
}
