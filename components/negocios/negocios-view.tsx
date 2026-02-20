"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCcw, Trash2, UsersRound } from "lucide-react";
import { getUserOrgContext } from "@/lib/supabase/auth-org";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

interface BusinessRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface StudentRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  status: "active" | "inactive";
}

interface BusinessEmployeeRow {
  student_id: string;
  role_label: string | null;
  created_at: string;
}

interface BusinessEmployeeItem {
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string;
  studentStatus: "active" | "inactive";
  roleLabel: string;
  createdAt: string;
}

const MIGRATION_HINT =
  "Para habilitar este módulo, execute a migration 202602200002_shad-manager_meu-negocio.sql.";

function isMeuNegocioSchemaMissing(message: string): boolean {
  const normalized = message.toLowerCase();
  const isMissingTable = normalized.includes("does not exist");
  const isMeuNegocioObject =
    normalized.includes("businesses") || normalized.includes("business_employees");
  return isMissingTable && isMeuNegocioObject;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function NegociosView() {
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isSchemaAvailable, setIsSchemaAvailable] = useState(true);
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
  const [isLinkingEmployee, setIsLinkingEmployee] = useState(false);
  const [deletingBusinessId, setDeletingBusinessId] = useState<string | null>(null);
  const [removingEmployeeId, setRemovingEmployeeId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [businessEmployees, setBusinessEmployees] = useState<BusinessEmployeeItem[]>([]);
  const [employeeCountByBusinessId, setEmployeeCountByBusinessId] = useState<Record<string, number>>({});
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [employeeRoleLabel, setEmployeeRoleLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) ?? null,
    [businesses, selectedBusinessId]
  );

  const linkedStudentIds = useMemo(
    () => new Set(businessEmployees.map((employee) => employee.studentId)),
    [businessEmployees]
  );

  const availableStudents = useMemo(
    () => students.filter((student) => !linkedStudentIds.has(student.id)),
    [linkedStudentIds, students]
  );

  const totalLinkedEmployees = useMemo(
    () => Object.values(employeeCountByBusinessId).reduce((acc, count) => acc + count, 0),
    [employeeCountByBusinessId]
  );

  const resetFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const refreshData = useCallback(async (preferredBusinessId?: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: context, error: contextError } = await getUserOrgContext(supabase, { force: true });
      if (contextError || !context) {
        throw new Error(contextError ?? "Falha ao carregar sessão.");
      }

      setOrganizationId(context.organizationId);
      setUserId(context.user.id);

      const [businessesResponse, studentsResponse, linksResponse] = await Promise.all([
        supabase
          .from("businesses")
          .select("id, organization_id, name, description, active, created_at, updated_at")
          .eq("organization_id", context.organizationId)
          .order("name", { ascending: true }),
        supabase
          .from("students")
          .select("id, full_name, email, phone, status")
          .eq("organization_id", context.organizationId)
          .order("full_name", { ascending: true }),
        supabase
          .from("business_employees")
          .select("business_id")
          .eq("organization_id", context.organizationId),
      ]);

      const firstError = businessesResponse.error || studentsResponse.error || linksResponse.error;
      if (firstError) {
        if (isMeuNegocioSchemaMissing(firstError.message)) {
          setIsSchemaAvailable(false);
          setBusinesses([]);
          setStudents([]);
          setEmployeeCountByBusinessId({});
          setSelectedBusinessId("");
          setBusinessEmployees([]);
          setErrorMessage(MIGRATION_HINT);
          return;
        }
        throw new Error(firstError.message);
      }

      setIsSchemaAvailable(true);
      const nextBusinesses = (businessesResponse.data ?? []) as BusinessRow[];
      const nextStudents = (studentsResponse.data ?? []) as StudentRow[];
      const links = (linksResponse.data ?? []) as Array<{ business_id: string }>;

      const nextCounts: Record<string, number> = {};
      for (const link of links) {
        const businessId = String(link.business_id);
        nextCounts[businessId] = (nextCounts[businessId] ?? 0) + 1;
      }

      setBusinesses(nextBusinesses);
      setStudents(nextStudents);
      setEmployeeCountByBusinessId(nextCounts);
      setSelectedBusinessId((current) => {
        const target = preferredBusinessId ?? current;
        if (target && nextBusinesses.some((business) => business.id === target)) {
          return target;
        }
        return nextBusinesses[0]?.id ?? "";
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar o módulo Meu Negócio.";
      setErrorMessage(message);
      setBusinesses([]);
      setStudents([]);
      setEmployeeCountByBusinessId({});
      setBusinessEmployees([]);
      setSelectedBusinessId("");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadBusinessEmployees = useCallback(async () => {
    if (!organizationId || !selectedBusinessId || !isSchemaAvailable) {
      setBusinessEmployees([]);
      setIsLoadingEmployees(false);
      return;
    }

    setIsLoadingEmployees(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("business_employees")
        .select("student_id, role_label, created_at")
        .eq("organization_id", organizationId)
        .eq("business_id", selectedBusinessId)
        .order("created_at", { ascending: true });

      if (error) {
        if (isMeuNegocioSchemaMissing(error.message)) {
          setIsSchemaAvailable(false);
          setBusinessEmployees([]);
          setErrorMessage(MIGRATION_HINT);
          return;
        }
        throw new Error(error.message);
      }

      const studentById = new Map(students.map((student) => [student.id, student]));
      const rows = (data ?? []) as BusinessEmployeeRow[];
      const items = rows
        .map((row) => {
          const student = studentById.get(row.student_id);
          if (!student) return null;

          return {
            studentId: row.student_id,
            studentName: student.full_name,
            studentEmail: student.email?.trim() ?? "",
            studentPhone: student.phone,
            studentStatus: student.status,
            roleLabel: row.role_label?.trim() ?? "",
            createdAt: row.created_at,
          } satisfies BusinessEmployeeItem;
        })
        .filter((row): row is BusinessEmployeeItem => Boolean(row));

      setBusinessEmployees(items);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível carregar os funcionários deste negócio.";
      setErrorMessage(message);
      setBusinessEmployees([]);
    } finally {
      setIsLoadingEmployees(false);
    }
  }, [isSchemaAvailable, organizationId, selectedBusinessId, students]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    void loadBusinessEmployees();
  }, [loadBusinessEmployees]);

  useEffect(() => {
    setSelectedStudentId((current) => {
      if (current && availableStudents.some((student) => student.id === current)) {
        return current;
      }
      return availableStudents[0]?.id ?? "";
    });
  }, [availableStudents]);

  const handleCreateBusiness = async () => {
    resetFeedback();
    if (!organizationId || !userId) {
      setErrorMessage("Sessão inválida para criar negócio.");
      return;
    }
    if (!isSchemaAvailable) {
      setErrorMessage(MIGRATION_HINT);
      return;
    }

    const trimmedName = businessName.trim();
    if (trimmedName.length < 2) {
      setErrorMessage("Informe um nome com pelo menos 2 caracteres.");
      return;
    }

    setIsCreatingBusiness(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("businesses")
        .insert({
          organization_id: organizationId,
          name: trimmedName,
          description: businessDescription.trim() || null,
          created_by: userId,
        })
        .select("id")
        .single();

      if (error) {
        if (isMeuNegocioSchemaMissing(error.message)) {
          setIsSchemaAvailable(false);
          throw new Error(MIGRATION_HINT);
        }
        if (error.code === "23505") {
          throw new Error("Já existe um negócio com esse nome.");
        }
        throw new Error(error.message);
      }

      const createdBusinessId = String(data?.id ?? "");
      setBusinessName("");
      setBusinessDescription("");
      setSuccessMessage("Negócio criado com sucesso.");
      await refreshData(createdBusinessId || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível criar o negócio.";
      setErrorMessage(message);
    } finally {
      setIsCreatingBusiness(false);
    }
  };

  const handleDeleteBusiness = async (business: BusinessRow) => {
    resetFeedback();
    if (!organizationId) {
      setErrorMessage("Sessão inválida para excluir negócio.");
      return;
    }
    if (!isSchemaAvailable) {
      setErrorMessage(MIGRATION_HINT);
      return;
    }

    const confirmed = window.confirm(
      `Tem certeza que deseja excluir o negócio "${business.name}"? Essa ação remove os vínculos de funcionários desse negócio.`
    );
    if (!confirmed) return;

    setDeletingBusinessId(business.id);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("businesses")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", business.id);

      if (error) {
        if (isMeuNegocioSchemaMissing(error.message)) {
          setIsSchemaAvailable(false);
          throw new Error(MIGRATION_HINT);
        }
        throw new Error(error.message);
      }

      setSuccessMessage(`Negócio "${business.name}" excluído com sucesso.`);
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível excluir o negócio.";
      setErrorMessage(message);
    } finally {
      setDeletingBusinessId(null);
    }
  };

  const handleLinkEmployee = async () => {
    resetFeedback();
    if (!organizationId || !userId) {
      setErrorMessage("Sessão inválida para vincular funcionário.");
      return;
    }
    if (!selectedBusinessId) {
      setErrorMessage("Selecione um negócio para vincular funcionário.");
      return;
    }
    if (!selectedStudentId) {
      setErrorMessage("Selecione um cliente para vincular.");
      return;
    }
    if (!isSchemaAvailable) {
      setErrorMessage(MIGRATION_HINT);
      return;
    }

    setIsLinkingEmployee(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("business_employees").insert({
        business_id: selectedBusinessId,
        organization_id: organizationId,
        student_id: selectedStudentId,
        role_label: employeeRoleLabel.trim() || null,
        created_by: userId,
      });

      if (error) {
        if (isMeuNegocioSchemaMissing(error.message)) {
          setIsSchemaAvailable(false);
          throw new Error(MIGRATION_HINT);
        }
        if (error.code === "23505") {
          throw new Error("Esse cliente já está vinculado como funcionário deste negócio.");
        }
        throw new Error(error.message);
      }

      setEmployeeRoleLabel("");
      setSuccessMessage("Funcionário vinculado com sucesso.");
      await refreshData(selectedBusinessId);
      await loadBusinessEmployees();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível vincular o funcionário.";
      setErrorMessage(message);
    } finally {
      setIsLinkingEmployee(false);
    }
  };

  const handleRemoveEmployee = async (studentId: string) => {
    resetFeedback();
    if (!organizationId || !selectedBusinessId) {
      setErrorMessage("Sessão inválida para remover vínculo.");
      return;
    }
    if (!isSchemaAvailable) {
      setErrorMessage(MIGRATION_HINT);
      return;
    }

    setRemovingEmployeeId(studentId);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("business_employees")
        .delete()
        .eq("organization_id", organizationId)
        .eq("business_id", selectedBusinessId)
        .eq("student_id", studentId);

      if (error) {
        if (isMeuNegocioSchemaMissing(error.message)) {
          setIsSchemaAvailable(false);
          throw new Error(MIGRATION_HINT);
        }
        throw new Error(error.message);
      }

      setSuccessMessage("Vínculo removido com sucesso.");
      await refreshData(selectedBusinessId);
      await loadBusinessEmployees();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível remover o vínculo.";
      setErrorMessage(message);
    } finally {
      setRemovingEmployeeId(null);
    }
  };

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-md border-l-2 border-[var(--accent)] px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Meu Negócio</p>
            <h1 className="text-lg font-semibold text-zinc-100">Negócios e Funcionários</h1>
            <p className="mt-1 text-xs text-zinc-500">
              Crie mais de um negócio e vincule clientes como funcionários em cada negócio.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300">
              {businesses.length} negócio(s)
            </span>
            <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300">
              {totalLinkedEmployees} vínculo(s)
            </span>
            <button
              type="button"
              onClick={() => void refreshData()}
              disabled={isLoading}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw size={14} />
              Atualizar
            </button>
          </div>
        </div>
      </header>

      {errorMessage ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {successMessage}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <aside className="surface rounded-md p-4 md:p-5">
          <h2 className="text-sm font-semibold text-zinc-100">Cadastrar negócio</h2>
          <p className="mt-1 text-xs text-zinc-500">Cada negócio pode ter seus próprios funcionários vinculados.</p>

          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Nome do negócio</span>
              <input
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                disabled={!isSchemaAvailable}
                className="field glow-focus h-10 w-full rounded-md px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Ex.: Academia Centro"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Descrição (opcional)</span>
              <textarea
                value={businessDescription}
                onChange={(event) => setBusinessDescription(event.target.value)}
                disabled={!isSchemaAvailable}
                rows={3}
                className="field glow-focus w-full rounded-md px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Ex.: Unidade focada em treino funcional."
              />
            </label>

            <button
              type="button"
              onClick={() => void handleCreateBusiness()}
              disabled={isCreatingBusiness || !isSchemaAvailable}
              className="btn-primary inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={14} />
              {isCreatingBusiness ? "Criando..." : "Criar negócio"}
            </button>
          </div>

          <div className="mt-5">
            <h3 className="text-xs uppercase tracking-[0.1em] text-zinc-500">Negócios cadastrados</h3>
            {isLoading ? (
              <p className="mt-2 text-xs text-zinc-500">Carregando negócios...</p>
            ) : businesses.length === 0 ? (
              <p className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-400">
                Nenhum negócio cadastrado.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {businesses.map((business) => {
                  const isActive = business.id === selectedBusinessId;
                  const employeeCount = employeeCountByBusinessId[business.id] ?? 0;

                  return (
                    <div
                      key={business.id}
                      className={[
                        "rounded-md border p-2 transition",
                        isActive
                          ? "border-[var(--accent)] bg-white/10"
                          : "border-white/10 bg-white/5 hover:border-white/20",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            resetFeedback();
                            setSelectedBusinessId(business.id);
                          }}
                          className="flex-1 text-left"
                        >
                          <p className="text-sm font-medium text-zinc-100">{business.name}</p>
                          {business.description?.trim() ? (
                            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{business.description}</p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {employeeCount} funcionário(s) vinculado(s)
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDeleteBusiness(business)}
                          disabled={deletingBusinessId === business.id}
                          className="btn-muted inline-flex h-8 w-8 items-center justify-center rounded-md text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Excluir negócio ${business.name}`}
                          title={`Excluir negócio ${business.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="surface rounded-md p-4 md:p-5">
          {!selectedBusiness ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-md border border-white/10 bg-white/5 px-4 text-center">
              <UsersRound size={28} className="text-zinc-500" />
              <p className="mt-3 text-sm text-zinc-300">Selecione um negócio para vincular funcionários.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <header className="rounded-md border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.1em] text-zinc-500">Negócio selecionado</p>
                <h2 className="mt-1 text-base font-semibold text-zinc-100">{selectedBusiness.name}</h2>
                {selectedBusiness.description?.trim() ? (
                  <p className="mt-1 text-sm text-zinc-400">{selectedBusiness.description}</p>
                ) : null}
              </header>

              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <h3 className="text-sm font-semibold text-zinc-100">Vincular cliente como funcionário</h3>
                <div className="mt-2 grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-400">Cliente</span>
                    <select
                      value={selectedStudentId}
                      onChange={(event) => setSelectedStudentId(event.target.value)}
                      disabled={availableStudents.length === 0 || !isSchemaAvailable}
                      className="field glow-focus h-10 w-full rounded-md px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">
                        {availableStudents.length === 0
                          ? "Sem clientes disponíveis"
                          : "Selecione um cliente"}
                      </option>
                      {availableStudents.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.full_name} {student.status === "inactive" ? "(Inativo)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-400">Função (opcional)</span>
                    <input
                      value={employeeRoleLabel}
                      onChange={(event) => setEmployeeRoleLabel(event.target.value)}
                      disabled={!isSchemaAvailable}
                      className="field glow-focus h-10 w-full rounded-md px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder="Ex.: Professor"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => void handleLinkEmployee()}
                    disabled={
                      isLinkingEmployee ||
                      !selectedStudentId ||
                      availableStudents.length === 0 ||
                      !isSchemaAvailable
                    }
                    className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus size={14} />
                    {isLinkingEmployee ? "Vinculando..." : "Vincular"}
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Funcionários vinculados</h3>
                {isLoadingEmployees ? (
                  <p className="mt-2 text-xs text-zinc-500">Carregando vínculos...</p>
                ) : businessEmployees.length === 0 ? (
                  <p className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-400">
                    Este negócio ainda não possui funcionários vinculados.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {businessEmployees.map((employee) => (
                      <article
                        key={employee.studentId}
                        className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-100">{employee.studentName}</p>
                            <p className="text-xs text-zinc-500">
                              {employee.studentEmail || "Sem e-mail"} • {employee.studentPhone}
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-500">
                              {employee.roleLabel ? `Função: ${employee.roleLabel} • ` : ""}
                              Vinculado em {formatDateTime(employee.createdAt)}
                              {employee.studentStatus === "inactive" ? " • Cliente inativo" : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRemoveEmployee(employee.studentId)}
                            disabled={removingEmployeeId === employee.studentId}
                            className="btn-muted inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 size={13} />
                            Remover
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
