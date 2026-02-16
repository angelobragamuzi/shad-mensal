"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MessageCircle,
  PenLine,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";
import {
  buildCurrentPeriodDates,
  centsToCurrency,
  mapBillingCycleLabel,
  mapStatusLabel,
  type BillingCycle,
  type InvoiceRow,
  type StudentRow,
  type UiStudentStatus,
} from "@/lib/shad-manager/utils";

type Modalidade = "Mensal" | "Semanal" | "Trimestral";
type ModalMode = "create" | "edit";

const statusFilters = ["Todos", "Pago", "Inadimplente", "Próximo do vencimento"] as const;
type StatusFilter = (typeof statusFilters)[number];

interface UiAluno {
  id: string;
  nome: string;
  telefone: string;
  cep: string;
  numeroResidencia: string;
  modalidade: Modalidade;
  valorCents: number;
  vencimento: number;
  status: UiStudentStatus;
  activeInvoice: InvoiceRow | null;
}

interface AlunoForm {
  nome: string;
  telefone: string;
  cep: string;
  numeroResidencia: string;
  modalidade: Modalidade;
  valor: string;
  vencimentoDia: string;
}

const statusClassName: Record<UiStudentStatus, string> = {
  Pago: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  Inadimplente: "border-red-500/30 bg-red-500/10 text-red-300",
  "Próximo do vencimento": "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

function mapCycleToLabel(cycle: BillingCycle): Modalidade {
  const label = mapBillingCycleLabel(cycle);
  if (label === "Semanal" || label === "Trimestral") return label;
  return "Mensal";
}

function mapLabelToCycle(label: Modalidade): BillingCycle {
  if (label === "Semanal") return "weekly";
  if (label === "Trimestral") return "quarterly";
  return "monthly";
}

function getOpenAmountCents(aluno: UiAluno) {
  if (!aluno.activeInvoice || aluno.activeInvoice.status === "paid") return 0;
  return Math.max(aluno.activeInvoice.amount_cents - aluno.activeInvoice.paid_amount_cents, 0);
}

function parseDueDay(value: string) {
  const dueDay = Number(value);
  if (Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31) return null;
  return { dueDay };
}

function buildMonthPeriodFromIsoDate(isoDate: string) {
  const [yearText, monthText] = isoDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || !month) {
    return buildCurrentPeriodDates(10);
  }

  const lastDay = new Date(year, month, 0).getDate();
  const monthPadded = String(month).padStart(2, "0");

  return {
    start: `${year}-${monthPadded}-01`,
    end: `${year}-${monthPadded}-${String(lastDay).padStart(2, "0")}`,
    dueDate: isoDate,
  };
}

function createInitialForm(): AlunoForm {
  const now = new Date();
  return {
    nome: "",
    telefone: "",
    cep: "",
    numeroResidencia: "",
    modalidade: "Mensal",
    valor: "",
    vencimentoDia: String(now.getDate()),
  };
}

function buildDayFromAluno(aluno: UiAluno) {
  return String(aluno.vencimento);
}

function buildIsoDateFromMonth(baseIsoDate: string, dueDay: number) {
  const [yearText, monthText] = baseIsoDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || !month) {
    return buildCurrentPeriodDates(dueDay).dueDate;
  }

  const lastDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(dueDay, 1), lastDay);
  const monthPadded = String(month).padStart(2, "0");

  return `${year}-${monthPadded}-${String(safeDay).padStart(2, "0")}`;
}

function formatDueDate(aluno: UiAluno) {
  if (!aluno.activeInvoice?.due_date) {
    return `Dia ${aluno.vencimento}`;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${aluno.activeInvoice.due_date}T00:00:00`));
}

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatCep(value: string) {
  const digits = normalizeCep(value);
  if (!digits) return "";
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function AlunosView() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [processingStudentId, setProcessingStudentId] = useState<string | null>(null);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [alunos, setAlunos] = useState<UiAluno[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Todos");
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingAluno, setEditingAluno] = useState<UiAluno | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [alunoToDelete, setAlunoToDelete] = useState<UiAluno | null>(null);
  const [form, setForm] = useState<AlunoForm>(createInitialForm);
  const modalRoot = typeof document === "undefined" ? null : document.body;

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: context, error: contextError } = await getUserOrgContext(supabase);
      if (contextError || !context) {
        throw new Error(contextError ?? "Falha ao carregar sessão.");
      }

      setOrganizationId(context.organizationId);
      setUserId(context.user.id);

      const [studentsResponse, invoicesResponse] = await Promise.all([
        supabase
          .from("students")
          .select("id, full_name, phone, postal_code, address_number, billing_cycle, amount_cents, due_day")
          .eq("organization_id", context.organizationId)
          .order("full_name", { ascending: true }),
        supabase
          .from("invoices")
          .select("id, student_id, due_date, amount_cents, paid_amount_cents, status, paid_at")
          .eq("organization_id", context.organizationId)
          .order("due_date", { ascending: false }),
      ]);

      if (studentsResponse.error) throw new Error(studentsResponse.error.message);
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);

      const students = (studentsResponse.data ?? []) as StudentRow[];
      const invoices = (invoicesResponse.data ?? []) as InvoiceRow[];

      const latestInvoiceByStudent = new Map<string, InvoiceRow>();
      for (const invoice of invoices) {
        if (!latestInvoiceByStudent.has(invoice.student_id)) {
          latestInvoiceByStudent.set(invoice.student_id, invoice);
        }
      }

      setAlunos(
        students.map((student) => {
          const latestInvoice = latestInvoiceByStudent.get(student.id) ?? null;
          return {
            id: student.id,
            nome: student.full_name,
            telefone: student.phone,
            cep: student.postal_code ?? "",
            numeroResidencia: student.address_number ?? "",
            modalidade: mapCycleToLabel(student.billing_cycle),
            valorCents: student.amount_cents,
            vencimento: student.due_day,
            status: mapStatusLabel(latestInvoice),
            activeInvoice: latestInvoice,
          } satisfies UiAluno;
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao carregar clientes.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const filteredAlunos = useMemo(() => {
    const term = search.trim().toLowerCase();

    return alunos.filter((aluno) => {
      const matchesSearch =
        !term ||
        aluno.nome.toLowerCase().includes(term) ||
        aluno.telefone.toLowerCase().includes(term);

      const matchesStatus = statusFilter === "Todos" || aluno.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [alunos, search, statusFilter]);

  const statusCounts = useMemo(
    () => ({
      Todos: alunos.length,
      Pago: alunos.filter((aluno) => aluno.status === "Pago").length,
      Inadimplente: alunos.filter((aluno) => aluno.status === "Inadimplente").length,
      "Próximo do vencimento": alunos.filter(
        (aluno) => aluno.status === "Próximo do vencimento"
      ).length,
    }),
    [alunos]
  );

  const totalInadimplente = useMemo(
    () =>
      alunos
        .filter((aluno) => aluno.status === "Inadimplente")
        .reduce((acc, aluno) => acc + getOpenAmountCents(aluno), 0),
    [alunos]
  );

  const totalPrevistoMes = useMemo(() => alunos.reduce((acc, aluno) => acc + aluno.valorCents, 0), [alunos]);

  const priorityOverdues = useMemo(
    () =>
      [...alunos]
        .filter((aluno) => aluno.status === "Inadimplente")
        .sort((a, b) => getOpenAmountCents(b) - getOpenAmountCents(a))
        .slice(0, 5),
    [alunos]
  );

  const cobrarAluno = (aluno: UiAluno) => {
    const digitsOnly = aluno.telefone.replace(/\D/g, "");
    const phone = digitsOnly.startsWith("55") ? digitsOnly : `55${digitsOnly}`;
    const message = `Olá ${aluno.nome}, sua mensalidade está em aberto. Podemos regularizar hoje?`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const closeModal = () => {
    setShowModal(false);
    setModalMode("create");
    setEditingAluno(null);
    setForm(createInitialForm());
  };

  const openCreateModal = () => {
    setModalMode("create");
    setEditingAluno(null);
    setForm(createInitialForm());
    setShowModal(true);
  };

  const openEditModal = (aluno: UiAluno) => {
    setModalMode("edit");
    setEditingAluno(aluno);
    setForm({
      nome: aluno.nome,
      telefone: formatPhoneNumber(aluno.telefone),
      cep: formatCep(aluno.cep),
      numeroResidencia: aluno.numeroResidencia,
      modalidade: aluno.modalidade,
      valor: (aluno.valorCents / 100).toFixed(2),
      vencimentoDia: buildDayFromAluno(aluno),
    });
    setShowModal(true);
  };

  const openDeleteModal = (aluno: UiAluno) => {
    setAlunoToDelete(aluno);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setAlunoToDelete(null);
  };

  const createInvoiceForStudent = async ({
    orgId,
    studentId,
    amountCents,
    dueDay,
    dueDateIso,
    createdBy,
  }: {
    orgId: string;
    studentId: string;
    amountCents: number;
    dueDay: number;
    dueDateIso?: string;
    createdBy: string;
  }) => {
    const supabase = getSupabaseBrowserClient();
    const period = dueDateIso ? buildMonthPeriodFromIsoDate(dueDateIso) : buildCurrentPeriodDates(dueDay);

    const { data, error } = await supabase
      .from("invoices")
      .insert({
        organization_id: orgId,
        student_id: studentId,
        reference_period_start: period.start,
        reference_period_end: period.end,
        due_date: dueDateIso ?? period.dueDate,
        amount_cents: amountCents,
        created_by: createdBy,
      })
      .select("id, student_id, due_date, amount_cents, paid_amount_cents, status, paid_at")
      .single();

    if (error) throw new Error(error.message);
    return data as InvoiceRow;
  };

  const markAsPaid = async (aluno: UiAluno) => {
    if (!organizationId || !userId) {
      setErrorMessage("Sessão inválida para registrar pagamento.");
      return;
    }

    if (aluno.status === "Pago") {
      return;
    }

    setProcessingStudentId(aluno.id);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();

      const { data: openInvoiceData, error: openInvoiceError } = await supabase
        .from("invoices")
        .select("id, student_id, due_date, amount_cents, paid_amount_cents, status, paid_at")
        .eq("organization_id", organizationId)
        .eq("student_id", aluno.id)
        .in("status", ["pending", "partial", "overdue"])
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (openInvoiceError) throw new Error(openInvoiceError.message);

      const invoice =
        (openInvoiceData as InvoiceRow | null) ??
        (await createInvoiceForStudent({
          orgId: organizationId,
          studentId: aluno.id,
          amountCents: aluno.valorCents,
          dueDay: aluno.vencimento,
          createdBy: userId,
        }));

      const amountToPay = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
      if (amountToPay <= 0) {
        await refreshData();
        return;
      }

      const { error: paymentError } = await supabase.from("payments").insert({
        organization_id: organizationId,
        invoice_id: invoice.id,
        student_id: aluno.id,
        amount_cents: amountToPay,
        method: "pix",
        created_by: userId,
      });

      if (paymentError) throw new Error(paymentError.message);
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao registrar pagamento.";
      setErrorMessage(message);
    } finally {
      setProcessingStudentId(null);
    }
  };

  const deleteAluno = async (aluno: UiAluno) => {
    if (!organizationId) {
      setErrorMessage("Sessão inválida para excluir cliente.");
      return;
    }

    setDeletingStudentId(aluno.id);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("students")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", aluno.id);

      if (error) throw new Error(error.message);
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao excluir cliente.";
      setErrorMessage(message);
    } finally {
      setDeletingStudentId(null);
    }
  };

  const confirmDeleteAluno = async () => {
    if (!alunoToDelete) return;
    await deleteAluno(alunoToDelete);
    setShowDeleteModal(false);
    setAlunoToDelete(null);
  };

  const saveAluno = async () => {
    if (!organizationId || !userId) {
      setErrorMessage("Sessão inválida para salvar cliente.");
      return;
    }

    const parsedValue = Number(form.valor.replace(",", "."));
    const dueData = parseDueDay(form.vencimentoDia);

    if (!form.nome || !form.telefone || Number.isNaN(parsedValue) || !dueData) {
      setErrorMessage("Preencha nome, telefone, valor e dia de vencimento.");
      return;
    }

    const cepDigits = normalizeCep(form.cep);
    const addressNumber = form.numeroResidencia.trim();

    if (cepDigits && cepDigits.length !== 8) {
      setErrorMessage("CEP inválido.");
      return;
    }

    if ((cepDigits && !addressNumber) || (!cepDigits && addressNumber)) {
      setErrorMessage("Informe CEP e número da residência.");
      return;
    }

    const amountCents = Math.round(parsedValue * 100);
    if (amountCents <= 0) {
      setErrorMessage("Valor inválido.");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();

      if (modalMode === "create") {
        const dueDateIso = buildCurrentPeriodDates(dueData.dueDay).dueDate;
        const { data: studentData, error: studentError } = await supabase
          .from("students")
          .insert({
            organization_id: organizationId,
            full_name: form.nome.trim(),
            phone: form.telefone.trim(),
            postal_code: cepDigits || null,
            address_number: addressNumber || null,
            billing_cycle: mapLabelToCycle(form.modalidade),
            amount_cents: amountCents,
            due_day: dueData.dueDay,
            created_by: userId,
          })
          .select("id")
          .single();

        if (studentError || !studentData?.id) {
          throw new Error(studentError?.message ?? "Falha ao criar cliente.");
        }

        await createInvoiceForStudent({
          orgId: organizationId,
          studentId: studentData.id as string,
          amountCents,
          dueDay: dueData.dueDay,
          dueDateIso,
          createdBy: userId,
        });
      } else {
        if (!editingAluno) {
          throw new Error("Cliente em edição não encontrado.");
        }

        const { error: updateStudentError } = await supabase
          .from("students")
          .update({
            full_name: form.nome.trim(),
            phone: form.telefone.trim(),
            postal_code: cepDigits || null,
            address_number: addressNumber || null,
            billing_cycle: mapLabelToCycle(form.modalidade),
            amount_cents: amountCents,
            due_day: dueData.dueDay,
          })
          .eq("organization_id", organizationId)
          .eq("id", editingAluno.id);

        if (updateStudentError) {
          throw new Error(updateStudentError.message);
        }

        const { data: nextOpenInvoice, error: nextOpenInvoiceError } = await supabase
          .from("invoices")
          .select("id, due_date")
          .eq("organization_id", organizationId)
          .eq("student_id", editingAluno.id)
          .in("status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (nextOpenInvoiceError) {
          throw new Error(nextOpenInvoiceError.message);
        }

        if (nextOpenInvoice?.id) {
          const updatedDueDate = buildIsoDateFromMonth(
            nextOpenInvoice.due_date ?? buildCurrentPeriodDates(dueData.dueDay).dueDate,
            dueData.dueDay
          );
          const { error: updateInvoiceError } = await supabase
            .from("invoices")
            .update({ due_date: updatedDueDate })
            .eq("organization_id", organizationId)
            .eq("id", nextOpenInvoice.id);

          if (updateInvoiceError) {
            throw new Error(updateInvoiceError.message);
          }
        }
      }

      closeModal();
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar cliente.";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const isDeleteConfirming = alunoToDelete ? deletingStudentId === alunoToDelete.id : false;

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-md border-l-2 border-[var(--accent)] px-4 py-6 md:px-6 md:py-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Sessão de clientes</p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight text-zinc-100 sm:text-4xl">
              Gestão de contratos, cobranças e status de pagamento.
            </h2>
            <p className="mt-3 text-sm text-zinc-300">
              Visualize a carteira, aplique filtros e execute ações rápidas em um único painel.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshData()}
              className="btn-muted inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm"
            >
              <RefreshCcw size={14} />
              Atualizar
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold"
            >
              <Plus size={16} />
              Novo cliente
            </button>
          </div>
        </div>
      </header>

      {errorMessage ? (
        <div className="surface rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Total de clientes</p>
          <p className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold text-zinc-100">
            <UsersRound size={18} />
            {statusCounts.Todos}
          </p>
        </article>

        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Pagos</p>
          <p className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold text-emerald-300">
            <CheckCircle2 size={18} />
            {statusCounts.Pago}
          </p>
        </article>

        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Próximos do vencimento</p>
          <p className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold text-amber-300">
            <Clock3 size={18} />
            {statusCounts["Próximo do vencimento"]}
          </p>
        </article>

        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Inadimplência</p>
          <p className="mt-2 inline-flex items-center gap-2 text-2xl font-semibold text-red-300">
            <AlertTriangle size={18} />
            {centsToCurrency(totalInadimplente)}
          </p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_0.7fr]">
        <section className="surface rounded-md p-4 md:p-5">
          <div className="mb-4 flex flex-col gap-3">
            <div className="relative w-full">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                size={16}
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="field glow-focus h-11 w-full rounded-md pl-9 pr-4 text-sm outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {statusFilters.map((filter) => {
                const isActive = statusFilter === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setStatusFilter(filter)}
                    className={[
                      "rounded-md border px-3 py-1.5 text-xs transition",
                      isActive
                        ? "border-white/30 bg-white/10 text-zinc-100"
                        : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-100",
                    ].join(" ")}
                  >
                    {filter} ({statusCounts[filter]})
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-left">
              <thead className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                <tr>
                  <th className="px-3 py-3">Nome</th>
                  <th className="px-3 py-3">Telefone</th>
                  <th className="px-3 py-3">Plano</th>
                  <th className="px-3 py-3">Mensalidade</th>
                  <th className="px-3 py-3">Vencimento</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Pagamento</th>
                  <th className="px-3 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm text-zinc-200">
                {isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`skeleton-row-${index}`} className="border-t border-white/8">
                        <td className="px-3 py-3"><Skeleton className="h-6 w-36" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-32" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-20" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-24" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-24" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-32" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-20" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-28" /></td>
                      </tr>
                    ))
                  : filteredAlunos.length === 0
                    ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-8 text-center text-sm text-zinc-400">
                            Nenhum cliente encontrado para o filtro atual.
                          </td>
                        </tr>
                      )
                    : filteredAlunos.map((aluno) => {
                        const isPaid = aluno.status === "Pago";
                        const isPaying = processingStudentId === aluno.id;
                        const isDeleting = deletingStudentId === aluno.id;

                        return (
                          <tr key={aluno.id} className="border-t border-white/8 transition hover:bg-zinc-900/35">
                            <td className="px-3 py-3 font-medium text-zinc-100">{aluno.nome}</td>
                            <td className="px-3 py-3 text-zinc-300">{aluno.telefone}</td>
                            <td className="px-3 py-3 text-zinc-300">{aluno.modalidade}</td>
                            <td className="px-3 py-3 text-zinc-100">{centsToCurrency(aluno.valorCents)}</td>
                            <td className="px-3 py-3 text-zinc-300">{formatDueDate(aluno)}</td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-medium ${statusClassName[aluno.status]}`}>
                                {aluno.status}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={isPaid}
                                  onClick={() => { if (!isPaid) void markAsPaid(aluno); }}
                                  disabled={isPaying || isPaid}
                                  className={[
                                    "relative inline-flex h-6 w-11 items-center rounded-full border transition",
                                    isPaid ? "border-emerald-400/60 bg-emerald-500/30" : "border-white/20 bg-zinc-900/80",
                                    isPaying ? "cursor-progress opacity-70" : isPaid ? "cursor-not-allowed" : "hover:border-white/35",
                                  ].join(" ")}
                                >
                                  <span className={[
                                    "inline-block h-4 w-4 transform rounded-full bg-white transition",
                                    isPaid ? "translate-x-5" : "translate-x-1",
                                  ].join(" ")} />
                                </button>
                                <span className="text-xs text-zinc-400">
                                  {isPaying ? "Processando..." : isPaid ? "Pago" : "Aberto"}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => cobrarAluno(aluno)}
                                  className="btn-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs"
                                >
                                  <MessageCircle size={14} /> Cobrar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(aluno)}
                                  className="btn-muted inline-flex items-center justify-center rounded-md p-1.5"
                                  aria-label={`Editar ${aluno.nome}`}
                                >
                                  <PenLine size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openDeleteModal(aluno)}
                                  disabled={isDeleting}
                                  className="btn-muted inline-flex items-center justify-center rounded-md p-1.5 text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                                  aria-label={`Excluir ${aluno.nome}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {isLoading
              ? Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={`mobile-skeleton-${index}`} className="h-[136px] rounded-md" />
                ))
              : filteredAlunos.length === 0
                ? (
                    <p className="surface-soft rounded-md px-4 py-3 text-sm text-zinc-400">
                      Nenhum cliente encontrado para o filtro atual.
                    </p>
                  )
                : filteredAlunos.map((aluno) => {
                    const isPaid = aluno.status === "Pago";
                    const isPaying = processingStudentId === aluno.id;
                    const isDeleting = deletingStudentId === aluno.id;

                    return (
                      <article key={aluno.id} className="surface-soft rounded-md p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-zinc-100">{aluno.nome}</p>
                            <p className="mt-1 text-xs text-zinc-500">{aluno.telefone}</p>
                          </div>
                          <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] ${statusClassName[aluno.status]}`}>
                            {aluno.status}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-zinc-400">
                          {aluno.modalidade} - {centsToCurrency(aluno.valorCents)} - {formatDueDate(aluno)}
                        </p>

                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isPaid}
                            onClick={() => { if (!isPaid) void markAsPaid(aluno); }}
                            disabled={isPaying || isPaid}
                            className={[
                              "relative inline-flex h-6 w-11 items-center rounded-full border transition",
                              isPaid ? "border-emerald-400/60 bg-emerald-500/30" : "border-white/20 bg-zinc-900/80",
                              isPaying ? "cursor-progress opacity-70" : isPaid ? "cursor-not-allowed" : "hover:border-white/35",
                            ].join(" ")}
                          >
                            <span className={[
                              "inline-block h-4 w-4 transform rounded-full bg-white transition",
                              isPaid ? "translate-x-5" : "translate-x-1",
                            ].join(" ")} />
                          </button>
                          <span className="text-xs text-zinc-400">
                            {isPaying ? "Processando..." : isPaid ? "Pago" : "Aberto"}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => cobrarAluno(aluno)}
                            className="btn-muted inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs"
                          >
                            <MessageCircle size={13} /> Cobrar
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(aluno)}
                            className="btn-muted inline-flex items-center justify-center rounded-md p-1.5"
                            aria-label={`Editar ${aluno.nome}`}
                          >
                            <PenLine size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(aluno)}
                            disabled={isDeleting}
                            className="btn-muted inline-flex items-center justify-center rounded-md p-1.5 text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Excluir ${aluno.nome}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
          </div>
        </section>

        <aside className="surface rounded-md p-4 md:p-5">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Resumo financeiro</p>
          <div className="mt-3 space-y-2">
            <div className="surface-soft rounded-md p-3">
              <p className="text-xs text-zinc-500">Receita prevista (base)</p>
              <p className="mt-1 text-xl font-semibold text-zinc-100">{centsToCurrency(totalPrevistoMes)}</p>
            </div>
            <div className="surface-soft rounded-md p-3">
              <p className="text-xs text-zinc-500">Inadimplência aberta</p>
              <p className="mt-1 text-xl font-semibold text-red-300">{centsToCurrency(totalInadimplente)}</p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-zinc-100">Prioridades de cobrança</p>
            <div className="mt-3 space-y-2">
              {priorityOverdues.length === 0 ? (
                <p className="surface-soft rounded-md px-3 py-2 text-xs text-zinc-400">
                  Sem clientes inadimplentes no momento.
                </p>
              ) : (
                priorityOverdues.map((aluno) => (
                  <div key={aluno.id} className="surface-soft rounded-md p-3">
                    <p className="text-sm font-medium text-zinc-100">{aluno.nome}</p>
                    <p className="mt-1 text-xs text-zinc-500">{centsToCurrency(getOpenAmountCents(aluno))}</p>
                    <button
                      type="button"
                      onClick={() => cobrarAluno(aluno)}
                      className="btn-muted mt-2 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs"
                    >
                      <MessageCircle size={12} /> Cobrar agora
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {showModal && modalRoot
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 py-10">
              <div className="surface animate-scale-in w-full max-w-xl rounded-md p-6">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h3 className="text-xl font-semibold text-zinc-100">
                  {modalMode === "create" ? "Novo cliente" : "Editar cliente"}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {modalMode === "create"
                    ? "Cadastro com fatura inicial automática."
                    : "Atualize os dados de cobrança e vencimento."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar modal"
                onClick={closeModal}
                className="btn-muted rounded-md p-1.5"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-2 block text-sm text-zinc-300">Nome</span>
                <input
                  value={form.nome}
                  onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                  placeholder="Nome completo"
                />
              </label>

              <label className="sm:col-span-2">
                <span className="mb-2 block text-sm text-zinc-300">Telefone</span>
                <input
                  value={form.telefone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      telefone: formatPhoneNumber(event.target.value),
                    }))
                  }
                  inputMode="tel"
                  maxLength={15}
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                  placeholder="(11) 90000-0000"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm text-zinc-300">CEP</span>
                <input
                  value={form.cep}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      cep: formatCep(event.target.value),
                    }))
                  }
                  inputMode="numeric"
                  maxLength={9}
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                  placeholder="00000-000"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm text-zinc-300">Número</span>
                <input
                  value={form.numeroResidencia}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      numeroResidencia: event.target.value,
                    }))
                  }
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                  placeholder="Ex.: 123"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm text-zinc-300">Modalidade</span>
                <select
                  value={form.modalidade}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      modalidade: event.target.value as Modalidade,
                    }))
                  }
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                >
                  <option>Mensal</option>
                  <option>Semanal</option>
                  <option>Trimestral</option>
                </select>
              </label>

              <label>
                <span className="mb-2 block text-sm text-zinc-300">Valor</span>
                <input
                  value={form.valor}
                  onChange={(event) => setForm((current) => ({ ...current, valor: event.target.value }))}
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                  placeholder="Ex.: 189,90"
                />
              </label>

              <label className="sm:col-span-2">
                <span className="mb-2 block text-sm text-zinc-300">Vencimento (dia)</span>
                <input
                  value={form.vencimentoDia}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, vencimentoDia: event.target.value }))
                  }
                  type="number"
                  min={1}
                  max={31}
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none"
                  placeholder="Ex.: 10"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSaving}
                className="btn-muted rounded-md px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveAluno()}
                disabled={isSaving}
                className="btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSaving ? "Salvando..." : modalMode === "create" ? "Salvar" : "Salvar alterações"}
              </button>
            </div>
              </div>
            </div>,
            modalRoot
          )
        : null}

      {showDeleteModal && modalRoot
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 py-10">
              <div className="surface animate-scale-in w-full max-w-md rounded-md p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-semibold text-zinc-100">Excluir cliente</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Essa ação remove os registros vinculados.
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar modal"
                onClick={closeDeleteModal}
                disabled={isDeleteConfirming}
                className="btn-muted rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {alunoToDelete
                ? `Confirma a exclusão de ${alunoToDelete.nome}?`
                : "Confirma a exclusão deste cliente?"}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={isDeleteConfirming}
                className="btn-muted rounded-md px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteAluno()}
                disabled={isDeleteConfirming}
                className="inline-flex items-center justify-center rounded-md border border-red-500/40 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleteConfirming ? "Excluindo..." : "Excluir"}
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
