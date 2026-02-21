"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCcw, Trash2, UsersRound } from "lucide-react";
import { getUserOrgContext } from "@/lib/supabase/auth-org";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

type BillingCycle = "monthly" | "weekly" | "quarterly";
type InvoiceStatus = "pending" | "partial" | "paid" | "overdue" | "canceled";
type PaymentMethod = "pix" | "cash" | "card" | "transfer" | "other";

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
  billing_cycle: BillingCycle;
  amount_cents: number;
  due_day: number;
  notes: string | null;
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

interface EmployeeDebtSnapshot {
  totalOpenCents: number;
  overdueCents: number;
  openCount: number;
  overdueCount: number;
  nextDueDate: string | null;
}

interface EmployeeDebtInvoiceRow {
  student_id: string;
  due_date: string;
  amount_cents: number;
  paid_amount_cents: number;
  status: InvoiceStatus;
}

interface EmployeeProfileInvoiceRow {
  id: string;
  reference_period_start: string;
  reference_period_end: string;
  due_date: string;
  amount_cents: number;
  paid_amount_cents: number;
  status: InvoiceStatus;
}

interface EmployeeOpenInvoiceItem {
  id: string;
  referenceStart: string;
  referenceEnd: string;
  dueDate: string;
  totalCents: number;
  paidCents: number;
  openCents: number;
  status: InvoiceStatus;
}

interface EmployeePaymentRow {
  id: string;
  invoice_id: string;
  amount_cents: number;
  method: PaymentMethod;
  paid_at: string;
  notes: string | null;
}

interface EmployeeProfileData {
  student: StudentRow;
  debt: EmployeeDebtSnapshot;
  openInvoices: EmployeeOpenInvoiceItem[];
  recentPayments: EmployeePaymentRow[];
  totalPaidLast90DaysCents: number;
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatCurrency(valueCents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    valueCents / 100
  );
}

function mapBillingCycleLabel(cycle: BillingCycle): string {
  if (cycle === "weekly") return "Semanal";
  if (cycle === "quarterly") return "Trimestral";
  return "Mensal";
}

function mapPaymentMethodLabel(method: PaymentMethod): string {
  if (method === "cash") return "Dinheiro";
  if (method === "card") return "Cartao";
  if (method === "transfer") return "Transferencia";
  if (method === "other") return "Outro";
  return "PIX";
}

function mapInvoiceStatusLabel(status: InvoiceStatus): string {
  if (status === "pending") return "Pendente";
  if (status === "partial") return "Parcial";
  if (status === "paid") return "Pago";
  if (status === "canceled") return "Cancelada";
  return "Atrasada";
}

function isInvoiceOverdue(dueDate: string, status: InvoiceStatus, todayIsoDate: string): boolean {
  return status === "overdue" || dueDate < todayIsoDate;
}

function createEmptyDebtSnapshot(): EmployeeDebtSnapshot {
  return {
    totalOpenCents: 0,
    overdueCents: 0,
    openCount: 0,
    overdueCount: 0,
    nextDueDate: null,
  };
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
  const [isLoadingEmployeeDebt, setIsLoadingEmployeeDebt] = useState(false);
  const [employeeDebtByStudentId, setEmployeeDebtByStudentId] = useState<
    Record<string, EmployeeDebtSnapshot>
  >({});
  const [selectedProfileStudentId, setSelectedProfileStudentId] = useState<string | null>(null);
  const [isLoadingEmployeeProfile, setIsLoadingEmployeeProfile] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<EmployeeProfileData | null>(null);
  const [employeeProfileError, setEmployeeProfileError] = useState<string | null>(null);

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

  const businessDebtSummary = useMemo(() => {
    let totalOpenCents = 0;
    let totalOverdueCents = 0;
    let totalOpenCount = 0;
    let totalOverdueCount = 0;

    for (const employee of businessEmployees) {
      const debt = employeeDebtByStudentId[employee.studentId];
      if (!debt) continue;
      totalOpenCents += debt.totalOpenCents;
      totalOverdueCents += debt.overdueCents;
      totalOpenCount += debt.openCount;
      totalOverdueCount += debt.overdueCount;
    }

    return {
      totalOpenCents,
      totalOverdueCents,
      totalOpenCount,
      totalOverdueCount,
    };
  }, [businessEmployees, employeeDebtByStudentId]);

  const selectedProfileEmployee = useMemo(() => {
    if (!selectedProfileStudentId) return null;
    return businessEmployees.find((employee) => employee.studentId === selectedProfileStudentId) ?? null;
  }, [businessEmployees, selectedProfileStudentId]);

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
          .select("id, full_name, email, phone, status, billing_cycle, amount_cents, due_day, notes")
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

  const loadEmployeeDebtByStudent = useCallback(async () => {
    if (!organizationId || businessEmployees.length === 0) {
      setEmployeeDebtByStudentId({});
      setIsLoadingEmployeeDebt(false);
      return;
    }

    setIsLoadingEmployeeDebt(true);
    try {
      const studentIds = Array.from(new Set(businessEmployees.map((employee) => employee.studentId)));
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("invoices")
        .select("student_id, due_date, amount_cents, paid_amount_cents, status")
        .eq("organization_id", organizationId)
        .in("student_id", studentIds)
        .in("status", ["pending", "partial", "overdue"]);

      if (error) throw new Error(error.message);

      const todayIsoDate = new Date().toISOString().slice(0, 10);
      const debtByStudentId: Record<string, EmployeeDebtSnapshot> = {};
      for (const studentId of studentIds) {
        debtByStudentId[studentId] = createEmptyDebtSnapshot();
      }

      for (const row of (data ?? []) as EmployeeDebtInvoiceRow[]) {
        const openCents = Math.max(Number(row.amount_cents) - Number(row.paid_amount_cents), 0);
        if (openCents <= 0) continue;

        const snapshot = debtByStudentId[row.student_id] ?? createEmptyDebtSnapshot();
        snapshot.totalOpenCents += openCents;
        snapshot.openCount += 1;

        if (!snapshot.nextDueDate || row.due_date < snapshot.nextDueDate) {
          snapshot.nextDueDate = row.due_date;
        }

        if (isInvoiceOverdue(row.due_date, row.status, todayIsoDate)) {
          snapshot.overdueCents += openCents;
          snapshot.overdueCount += 1;
        }

        debtByStudentId[row.student_id] = snapshot;
      }

      setEmployeeDebtByStudentId(debtByStudentId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível carregar o saldo dos funcionários.";
      setErrorMessage(message);
      setEmployeeDebtByStudentId({});
    } finally {
      setIsLoadingEmployeeDebt(false);
    }
  }, [businessEmployees, organizationId]);

  const loadEmployeeProfile = useCallback(
    async (studentId: string) => {
      if (!organizationId) return;

      const student = students.find((item) => item.id === studentId) ?? null;
      if (!student) {
        setEmployeeProfile(null);
        setEmployeeProfileError("Funcionário não encontrado neste negócio.");
        return;
      }

      setIsLoadingEmployeeProfile(true);
      setEmployeeProfileError(null);

      try {
        const supabase = getSupabaseBrowserClient();
        const [invoicesResponse, paymentsResponse] = await Promise.all([
          supabase
            .from("invoices")
            .select(
              "id, reference_period_start, reference_period_end, due_date, amount_cents, paid_amount_cents, status"
            )
            .eq("organization_id", organizationId)
            .eq("student_id", studentId)
            .order("due_date", { ascending: true }),
          supabase
            .from("payments")
            .select("id, invoice_id, amount_cents, method, paid_at, notes")
            .eq("organization_id", organizationId)
            .eq("student_id", studentId)
            .order("paid_at", { ascending: false })
            .limit(10),
        ]);

        if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);
        if (paymentsResponse.error) throw new Error(paymentsResponse.error.message);

        const todayIsoDate = new Date().toISOString().slice(0, 10);
        const debt = createEmptyDebtSnapshot();
        const openInvoices: EmployeeOpenInvoiceItem[] = [];

        for (const invoice of (invoicesResponse.data ?? []) as EmployeeProfileInvoiceRow[]) {
          const openCents = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
          if (openCents <= 0 || !["pending", "partial", "overdue"].includes(invoice.status)) {
            continue;
          }

          openInvoices.push({
            id: invoice.id,
            referenceStart: invoice.reference_period_start,
            referenceEnd: invoice.reference_period_end,
            dueDate: invoice.due_date,
            totalCents: invoice.amount_cents,
            paidCents: invoice.paid_amount_cents,
            openCents,
            status: invoice.status,
          });

          debt.totalOpenCents += openCents;
          debt.openCount += 1;

          if (!debt.nextDueDate || invoice.due_date < debt.nextDueDate) {
            debt.nextDueDate = invoice.due_date;
          }

          if (isInvoiceOverdue(invoice.due_date, invoice.status, todayIsoDate)) {
            debt.overdueCents += openCents;
            debt.overdueCount += 1;
          }
        }

        const recentPayments = (paymentsResponse.data ?? []) as EmployeePaymentRow[];
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const totalPaidLast90DaysCents = recentPayments.reduce((acc, payment) => {
          const paidAt = new Date(payment.paid_at).getTime();
          if (!Number.isFinite(paidAt) || paidAt < ninetyDaysAgo) return acc;
          return acc + payment.amount_cents;
        }, 0);

        setEmployeeProfile({
          student,
          debt,
          openInvoices,
          recentPayments,
          totalPaidLast90DaysCents,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar o perfil financeiro.";
        setEmployeeProfile(null);
        setEmployeeProfileError(message);
      } finally {
        setIsLoadingEmployeeProfile(false);
      }
    },
    [organizationId, students]
  );

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

  useEffect(() => {
    void loadEmployeeDebtByStudent();
  }, [loadEmployeeDebtByStudent]);

  useEffect(() => {
    setSelectedProfileStudentId((current) => {
      if (!current) return null;
      return businessEmployees.some((employee) => employee.studentId === current) ? current : null;
    });
  }, [businessEmployees]);

  useEffect(() => {
    if (!selectedProfileStudentId) {
      setEmployeeProfile(null);
      setEmployeeProfileError(null);
      setIsLoadingEmployeeProfile(false);
      return;
    }
    void loadEmployeeProfile(selectedProfileStudentId);
  }, [loadEmployeeProfile, selectedProfileStudentId]);

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

  const handleOpenEmployeeProfile = (studentId: string) => {
    resetFeedback();
    setSelectedProfileStudentId(studentId);
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

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Funcionários</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-100">{businessEmployees.length}</p>
                </article>
                <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Cobranças abertas</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-100">{businessDebtSummary.totalOpenCount}</p>
                </article>
                <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Saldo em aberto</p>
                  <p className="mt-1 text-sm font-semibold text-amber-200">
                    {formatCurrency(businessDebtSummary.totalOpenCents)}
                  </p>
                </article>
                <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Saldo atrasado</p>
                  <p className="mt-1 text-sm font-semibold text-red-200">
                    {formatCurrency(businessDebtSummary.totalOverdueCents)}
                  </p>
                </article>
              </div>

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

              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Funcionários vinculados</h3>
                    {isLoadingEmployeeDebt ? (
                      <span className="text-[11px] text-zinc-500">Atualizando saldos...</span>
                    ) : null}
                  </div>

                  {isLoadingEmployees ? (
                    <p className="mt-2 text-xs text-zinc-500">Carregando vínculos...</p>
                  ) : businessEmployees.length === 0 ? (
                    <p className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-400">
                      Este negócio ainda não possui funcionários vinculados.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {businessEmployees.map((employee) => {
                        const debt = employeeDebtByStudentId[employee.studentId] ?? createEmptyDebtSnapshot();
                        const isProfileSelected = selectedProfileStudentId === employee.studentId;
                        return (
                          <article
                            key={employee.studentId}
                            className={[
                              "rounded-md border bg-white/5 px-3 py-2",
                              isProfileSelected ? "border-[var(--accent)]" : "border-white/10",
                            ].join(" ")}
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
                                <p className="mt-1 text-[11px] text-zinc-400">
                                  {debt.totalOpenCents > 0
                                    ? `Em aberto: ${formatCurrency(debt.totalOpenCents)}`
                                    : "Sem cobranças em aberto."}
                                  {debt.overdueCount > 0
                                    ? ` • ${debt.overdueCount} atrasada(s) (${formatCurrency(debt.overdueCents)})`
                                    : ""}
                                  {debt.nextDueDate ? ` • Próximo vencimento: ${formatDate(debt.nextDueDate)}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEmployeeProfile(employee.studentId)}
                                  className="btn-muted inline-flex h-8 items-center rounded-md px-2 text-xs text-zinc-200"
                                >
                                  Ver perfil
                                </button>
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
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>

                <aside className="rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Perfil do funcionário</h3>
                    <button
                      type="button"
                      onClick={() =>
                        selectedProfileStudentId ? void loadEmployeeProfile(selectedProfileStudentId) : undefined
                      }
                      disabled={!selectedProfileStudentId || isLoadingEmployeeProfile}
                      className="btn-muted inline-flex h-8 items-center rounded-md px-2 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isLoadingEmployeeProfile ? "Atualizando..." : "Atualizar"}
                    </button>
                  </div>

                  {!selectedProfileStudentId ? (
                    <p className="mt-2 text-xs text-zinc-500">
                      Selecione um funcionário da lista para ver perfil e situação de cobrança.
                    </p>
                  ) : isLoadingEmployeeProfile ? (
                    <p className="mt-2 text-xs text-zinc-500">Carregando perfil...</p>
                  ) : employeeProfileError ? (
                    <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                      {employeeProfileError}
                    </p>
                  ) : !employeeProfile ? (
                    <p className="mt-2 text-xs text-zinc-500">Perfil indisponível no momento.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-100">{employeeProfile.student.full_name}</p>
                        <p className="text-xs text-zinc-500">
                          {employeeProfile.student.email || "Sem e-mail"} • {employeeProfile.student.phone}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Plano {mapBillingCycleLabel(employeeProfile.student.billing_cycle)} • Valor base{" "}
                          {formatCurrency(employeeProfile.student.amount_cents)} • Vence dia{" "}
                          {employeeProfile.student.due_day}
                        </p>
                        {selectedProfileEmployee?.roleLabel ? (
                          <p className="mt-1 text-[11px] text-zinc-500">
                            Função no negócio: {selectedProfileEmployee.roleLabel}
                          </p>
                        ) : null}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Saldo em aberto</p>
                          <p className="mt-1 text-sm font-semibold text-amber-200">
                            {formatCurrency(employeeProfile.debt.totalOpenCents)}
                          </p>
                        </article>
                        <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Saldo atrasado</p>
                          <p className="mt-1 text-sm font-semibold text-red-200">
                            {formatCurrency(employeeProfile.debt.overdueCents)}
                          </p>
                        </article>
                        <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Cobranças abertas</p>
                          <p className="mt-1 text-sm font-semibold text-zinc-100">{employeeProfile.debt.openCount}</p>
                        </article>
                        <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                            Recebido (90 dias)
                          </p>
                          <p className="mt-1 text-sm font-semibold text-emerald-200">
                            {formatCurrency(employeeProfile.totalPaidLast90DaysCents)}
                          </p>
                        </article>
                      </div>

                      {employeeProfile.student.notes?.trim() ? (
                        <article className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Observações</p>
                          <p className="mt-1 text-xs text-zinc-300">{employeeProfile.student.notes}</p>
                        </article>
                      ) : null}

                      <div>
                        <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">Cobranças em aberto</p>
                        {employeeProfile.openInvoices.length === 0 ? (
                          <p className="mt-2 text-xs text-zinc-500">Nenhuma cobrança pendente.</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {employeeProfile.openInvoices.slice(0, 6).map((invoice) => (
                              <article
                                key={invoice.id}
                                className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                              >
                                <p className="text-xs font-medium text-zinc-200">
                                  {formatDate(invoice.referenceStart)} até {formatDate(invoice.referenceEnd)}
                                </p>
                                <p className="mt-1 text-[11px] text-zinc-500">
                                  Vencimento {formatDate(invoice.dueDate)} • {mapInvoiceStatusLabel(invoice.status)}
                                </p>
                                <p className="mt-1 text-[11px] text-zinc-400">
                                  Total {formatCurrency(invoice.totalCents)} • Pago {formatCurrency(invoice.paidCents)}{" "}
                                  • Aberto {formatCurrency(invoice.openCents)}
                                </p>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">Últimos pagamentos</p>
                        {employeeProfile.recentPayments.length === 0 ? (
                          <p className="mt-2 text-xs text-zinc-500">Sem pagamentos recentes.</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {employeeProfile.recentPayments.slice(0, 6).map((payment) => (
                              <article
                                key={payment.id}
                                className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                              >
                                <p className="text-xs font-medium text-emerald-200">
                                  {formatCurrency(payment.amount_cents)}
                                </p>
                                <p className="mt-1 text-[11px] text-zinc-500">
                                  {formatDateTime(payment.paid_at)} • {mapPaymentMethodLabel(payment.method)}
                                </p>
                                {payment.notes?.trim() ? (
                                  <p className="mt-1 text-[11px] text-zinc-400">{payment.notes}</p>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}


