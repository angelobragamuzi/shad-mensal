"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, RefreshCcw, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";

const roleLabels: Record<"owner" | "admin" | "staff", string> = {
  owner: "Proprietario",
  admin: "Administrador",
  staff: "Equipe",
};

interface OrgMemberRow {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "staff";
  created_at: string;
}

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function OrganizacaoView() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [userRole, setUserRole] = useState<"owner" | "admin" | "staff">("staff");
  const [userId, setUserId] = useState<string | null>(null);

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [currencyCode, setCurrencyCode] = useState("BRL");
  const [whatsTemplate, setWhatsTemplate] = useState("");

  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"owner" | "admin" | "staff">("staff");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canManageMembers = userRole === "owner" || userRole === "admin";
  const canManageSettings = userRole === "owner" || userRole === "admin";

  const loadOrganization = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: orgContext, error: orgError } = await getUserOrgContext(supabase);
      if (orgError || !orgContext) {
        throw new Error(orgError ?? "Falha ao validar organizacao.");
      }

      setUserRole(orgContext.role);
      setUserId(orgContext.user.id);

      const [orgResponse, settingsResponse] = await Promise.all([
        supabase
          .from("organizations")
          .select("id, name, slug, active")
          .eq("id", orgContext.organizationId)
          .maybeSingle(),
        supabase
          .from("organization_settings")
          .select("timezone, currency_code, whatsapp_template")
          .eq("organization_id", orgContext.organizationId)
          .maybeSingle(),
      ]);

      if (orgResponse.error) throw new Error(orgResponse.error.message);
      if (settingsResponse.error) throw new Error(settingsResponse.error.message);

      if (orgResponse.data) {
        setOrgInfo(orgResponse.data as OrgInfo);
        setOrgName(orgResponse.data.name ?? "");
        setOrgSlug(orgResponse.data.slug ?? "");
      }

      if (settingsResponse.data) {
        setTimezone(settingsResponse.data.timezone ?? "America/Sao_Paulo");
        setCurrencyCode(settingsResponse.data.currency_code ?? "BRL");
        setWhatsTemplate(settingsResponse.data.whatsapp_template ?? "");
      }

      if (orgContext.role === "owner" || orgContext.role === "admin") {
        const membersResponse = await supabase.rpc("get_org_members", {
          p_org_id: orgContext.organizationId,
        });
        if (membersResponse.error) throw new Error(membersResponse.error.message);
        setMembers((membersResponse.data ?? []) as OrgMemberRow[]);
      } else {
        setMembers([]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao carregar organizacao.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrganization();
  }, [loadOrganization]);

  const handleSaveSettings = async () => {
    if (!orgInfo) return;
    if (!canManageSettings) {
      setErrorMessage("Voce nao possui permissao para atualizar os dados.");
      return;
    }

    const trimmedName = orgName.trim();
    const trimmedSlug = orgSlug.trim();
    const slugIsValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmedSlug);

    if (!trimmedName) {
      setErrorMessage("Informe o nome da empresa.");
      return;
    }

    if (!slugIsValid) {
      setErrorMessage("Identificador invalido. Use apenas letras, numeros e hifen.");
      return;
    }

    setIsSavingSettings(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const [orgUpdate, settingsUpdate] = await Promise.all([
        supabase
          .from("organizations")
          .update({ name: trimmedName, slug: trimmedSlug })
          .eq("id", orgInfo.id),
        supabase
          .from("organization_settings")
          .update({
            timezone: timezone.trim(),
            currency_code: currencyCode.trim().toUpperCase(),
            whatsapp_template: whatsTemplate.trim(),
          })
          .eq("organization_id", orgInfo.id),
      ]);

      if (orgUpdate.error) throw new Error(orgUpdate.error.message);
      if (settingsUpdate.error) throw new Error(settingsUpdate.error.message);

      setSuccessMessage("Dados salvos.");
      await loadOrganization();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar dados.";
      setErrorMessage(message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleAddMember = async () => {
    if (!orgInfo) return;
    if (!canManageMembers) {
      setErrorMessage("Voce nao possui permissao para adicionar membros.");
      return;
    }

    const email = newMemberEmail.trim();
    if (!email) {
      setErrorMessage("Informe o email do usuario.");
      return;
    }

    setIsAddingMember(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("add_org_member_by_email", {
        p_org_id: orgInfo.id,
        p_email: email,
        p_role: newMemberRole,
      });

      if (error) throw new Error(error.message);

      setNewMemberEmail("");
      setNewMemberRole("staff");
      setSuccessMessage("Membro adicionado com sucesso.");
      await loadOrganization();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Erro ao adicionar membro.";
      if (rawMessage.toLowerCase().includes("user not found")) {
        setErrorMessage("Usuario nao encontrado no Supabase Auth.");
      } else {
        setErrorMessage(rawMessage);
      }
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleUpdateMemberRole = async (memberId: string, role: "owner" | "admin" | "staff") => {
    if (!orgInfo) return;
    if (!canManageMembers) return;

    setEditingMemberId(memberId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("update_org_member_role", {
        p_org_id: orgInfo.id,
        p_user_id: memberId,
        p_role: role,
      });

      if (error) throw new Error(error.message);
      setSuccessMessage("Permissoes atualizadas.");
      await loadOrganization();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Erro ao atualizar permissao.";
      if (rawMessage.toLowerCase().includes("cannot remove last owner")) {
        setErrorMessage("Voce nao pode remover o ultimo owner.");
      } else {
        setErrorMessage(rawMessage);
      }
    } finally {
      setEditingMemberId(null);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!orgInfo) return;
    if (!canManageMembers) return;

    setRemovingMemberId(memberId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("remove_org_member", {
        p_org_id: orgInfo.id,
        p_user_id: memberId,
      });

      if (error) throw new Error(error.message);
      setSuccessMessage("Membro removido.");
      await loadOrganization();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Erro ao remover membro.";
      if (rawMessage.toLowerCase().includes("cannot remove last owner")) {
        setErrorMessage("Voce nao pode remover o ultimo owner.");
      } else {
        setErrorMessage(rawMessage);
      }
    } finally {
      setRemovingMemberId(null);
    }
  };

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-3xl border-l-4 border-amber-400/60 px-4 py-6 pl-5 md:px-6 md:py-7 md:pl-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold leading-tight text-zinc-100 sm:text-4xl">
              Minha empresa
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              Atualize os dados da empresa e convide pessoas para o painel.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadOrganization()}
            className="btn-muted inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
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

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="surface rounded-3xl p-4 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">Equipe</h3>
              <p className="mt-1 text-sm text-zinc-400">Convide pessoas e defina o acesso.</p>
            </div>
            <div className="surface-soft inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-400">
              <UsersRound size={14} />
              {members.length} pessoas
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1.3fr_0.7fr_0.4fr]">
            <label className="block text-left">
              <span className="mb-2 block text-sm text-zinc-300">Email da pessoa</span>
              <input
                value={newMemberEmail}
                onChange={(event) => setNewMemberEmail(event.target.value)}
                className="field glow-focus h-11 w-full rounded-xl px-3 text-sm outline-none"
                placeholder="usuario@empresa.com"
                disabled={!canManageMembers}
              />
            </label>
            <label className="block text-left">
              <span className="mb-2 block text-sm text-zinc-300">Nivel de acesso</span>
              <select
                value={newMemberRole}
                onChange={(event) => setNewMemberRole(event.target.value as "owner" | "admin" | "staff")}
                className="field glow-focus h-11 w-full rounded-xl px-3 text-sm outline-none"
                disabled={!canManageMembers}
              >
                <option value="staff">Equipe</option>
                <option value="admin">Administrador</option>
                {userRole === "owner" ? <option value="owner">Proprietario</option> : null}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void handleAddMember()}
              disabled={isAddingMember || !canManageMembers}
              className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            >
              <UserPlus size={14} />
              {isAddingMember ? "Adicionando..." : "Convidar"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Equipe usa o painel. Administrador gerencia equipe e dados. Proprietario tem controle total.
          </p>

          <div className="mt-6 space-y-2">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`member-skeleton-${index}`} className="h-16 rounded-xl" />
              ))
            ) : !canManageMembers ? (
              <div className="surface-soft rounded-xl px-4 py-3 text-sm text-zinc-400">
                Seu perfil nao possui permissao para ver a equipe.
              </div>
            ) : members.length === 0 ? (
              <div className="surface-soft rounded-xl px-4 py-3 text-sm text-zinc-400">
                Nenhuma pessoa adicionada ainda.
              </div>
            ) : (
              members.map((member) => {
                const isSelf = member.user_id === userId;
                const isOwner = member.role === "owner";
                const isEditing = editingMemberId === member.user_id;
                const isRemoving = removingMemberId === member.user_id;

                return (
                  <div
                    key={member.user_id}
                    className="surface-soft flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{member.email}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Entrou em {new Intl.DateTimeFormat("pt-BR").format(new Date(member.created_at))}
                        {isSelf ? " • voce" : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300">
                        <ShieldCheck size={12} />
                        {roleLabels[member.role]}
                      </div>
                      <select
                        value={member.role}
                        disabled={!canManageMembers || isOwner || isEditing}
                        onChange={(event) =>
                          void handleUpdateMemberRole(
                            member.user_id,
                            event.target.value as "owner" | "admin" | "staff"
                          )
                        }
                        className="field h-9 rounded-lg px-2 text-xs"
                      >
                        <option value="staff">Equipe</option>
                        <option value="admin">Administrador</option>
                        {userRole === "owner" ? <option value="owner">Proprietario</option> : null}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleRemoveMember(member.user_id)}
                        disabled={!canManageMembers || isOwner || isSelf || isRemoving}
                        className="btn-muted rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isRemoving ? "Removendo..." : "Remover"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="surface rounded-3xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">Dados da empresa</h3>
                <p className="mt-1 text-sm text-zinc-400">Informacoes basicas da sua empresa.</p>
              </div>
              <div className="surface-soft inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-400">
                <Building2 size={14} />
                {orgInfo?.active ? "Ativa" : "Inativa"}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-2 block text-sm text-zinc-300">Nome da empresa</span>
                <input
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  className="field glow-focus h-11 w-full rounded-xl px-3 text-sm outline-none"
                  placeholder="Nome da empresa"
                  disabled={!canManageSettings}
                />
              </label>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-zinc-400">
                Esse identificador ajuda o sistema a reconhecer sua empresa. Se nao souber, deixe
                como esta.
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced((current) => !current)}
                className="btn-muted inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs"
              >
                {showAdvanced ? "Esconder opcoes avancadas" : "Mostrar opcoes avancadas"}
              </button>

              {showAdvanced ? (
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">Identificador interno</span>
                  <input
                    value={orgSlug}
                    onChange={(event) => setOrgSlug(event.target.value)}
                    className="field glow-focus h-11 w-full rounded-xl px-3 text-sm outline-none"
                    placeholder={slugify(orgName || "sua-empresa")}
                    disabled={!canManageSettings}
                  />
                </label>
              ) : null}
            </div>
          </section>

          <section className="surface rounded-3xl p-4 md:p-5">
            <h3 className="text-lg font-semibold text-zinc-100">Cobranca</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Mensagem padrao para cobrar clientes no WhatsApp.
            </p>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-2 block text-sm text-zinc-300">Mensagem padrão</span>
                <textarea
                  value={whatsTemplate}
                  onChange={(event) => setWhatsTemplate(event.target.value)}
                  className="field glow-focus min-h-[120px] w-full rounded-xl px-3 py-2 text-sm outline-none"
                  placeholder="Ola {{student_name}}, sua mensalidade esta em aberto. Podemos regularizar hoje?"
                  disabled={!canManageSettings}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Use {"{student_name}"} para inserir o nome.
                </p>
              </label>
            </div>

            {showAdvanced ? (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">Timezone</span>
                  <input
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    className="field glow-focus h-11 w-full rounded-xl px-3 text-sm outline-none"
                    placeholder="America/Sao_Paulo"
                    disabled={!canManageSettings}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">Moeda</span>
                  <input
                    value={currencyCode}
                    onChange={(event) => setCurrencyCode(event.target.value)}
                    className="field glow-focus h-11 w-full rounded-xl px-3 text-sm outline-none"
                    placeholder="BRL"
                    maxLength={3}
                    disabled={!canManageSettings}
                  />
                </label>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void handleSaveSettings()}
              disabled={isSavingSettings || !canManageSettings}
              className="btn-primary mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSavingSettings ? "Salvando..." : "Salvar dados"}
            </button>
          </section>
        </aside>
      </div>
    </section>
  );
}
