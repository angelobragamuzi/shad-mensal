"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Clock3,
  MessageCircle,
  RefreshCcw,
  Search,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";
import { centsToCurrency, daysLate, formatShortDate } from "@/lib/shad-manager/utils";

type TaskPriority = "alta" | "media" | "baixa";
type TaskKind = "atrasada" | "hoje" | "proxima";
type TaskFilter = "todas" | "alta" | "media" | "baixa" | "atrasadas" | "hoje";

interface StudentTaskRow {
  id: string;
  full_name: string;
  phone: string;
}

interface InvoiceTaskRow {
  id: string;
  student_id: string;
  due_date: string;
  amount_cents: number;
  paid_amount_cents: number;
  status: "pending" | "partial" | "overdue";
}

interface TaskItem {
  id: string;
  studentName: string;
  rawPhone: string;
  whatsappPhone: string | null;
  dueDate: string;
  openCents: number;
  daysOverdue: number;
  daysToDue: number;
  priority: TaskPriority;
  kind: TaskKind;
  message: string;
}

function normalizeWhatsappPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

function buildWhatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function daysUntilDue(isoDate: string): number {
  const dueDate = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
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
  return Promise.resolve();
}

function getTaskKind(overdueDays: number, daysToDue: number): TaskKind {
  if (overdueDays > 0) return "atrasada";
  if (daysToDue === 0) return "hoje";
  return "proxima";
}

function getTaskPriority(overdueDays: number, daysToDue: number, openCents: number): TaskPriority {
  if (overdueDays >= 7 || openCents >= 50_000 || daysToDue === 0) return "alta";
  if (overdueDays > 0 || daysToDue <= 3) return "media";
  return "baixa";
}

function buildTaskMessage(task: {
  studentName: string;
  openCents: number;
  dueDate: string;
  overdueDays: number;
}): string {
  if (task.overdueDays > 0) {
    return `Olá ${task.studentName}, identificamos um valor em aberto de ${centsToCurrency(
      task.openCents
    )}, vencido em ${formatShortDate(task.dueDate)}. Podemos regularizar hoje?`;
  }

  if (task.overdueDays === 0 && daysUntilDue(task.dueDate) === 0) {
    return `Olá ${task.studentName}, sua mensalidade de ${centsToCurrency(
      task.openCents
    )} vence hoje (${formatShortDate(task.dueDate)}). Posso te enviar o PIX para pagamento?`;
  }

  return `Olá ${task.studentName}, passando para lembrar da mensalidade de ${centsToCurrency(
    task.openCents
  )}, com vencimento em ${formatShortDate(task.dueDate)}. Posso te enviar o PIX?`;
}

const priorityMeta: Record<
  TaskPriority,
  {
    label: string;
    className: string;
  }
> = {
  alta: {
    label: "Alta prioridade",
    className: "border-red-500/35 bg-red-500/15 text-red-200",
  },
  media: {
    label: "Média prioridade",
    className: "border-amber-500/35 bg-amber-500/15 text-amber-200",
  },
  baixa: {
    label: "Baixa prioridade",
    className: "border-emerald-500/35 bg-emerald-500/15 text-emerald-200",
  },
};

const kindMeta: Record<TaskKind, string> = {
  atrasada: "Atrasada",
  hoje: "Vence hoje",
  proxima: "Próximo vencimento",
};

const filterLabels: Record<TaskFilter, string> = {
  todas: "Todas",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  atrasadas: "Atrasadas",
  hoje: "Hoje",
};

export function TarefasCobrancaView() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<TaskFilter>("todas");
  const [search, setSearch] = useState("");
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: context, error: contextError } = await getUserOrgContext(supabase);
      if (contextError || !context) {
        throw new Error(contextError ?? "Falha ao carregar a organização.");
      }
      setOrganizationId(context.organizationId);

      const [studentsResponse, invoicesResponse] = await Promise.all([
        supabase
          .from("students")
          .select("id, full_name, phone")
          .eq("organization_id", context.organizationId)
          .eq("status", "active"),
        supabase
          .from("invoices")
          .select("id, student_id, due_date, amount_cents, paid_amount_cents, status")
          .eq("organization_id", context.organizationId)
          .in("status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true })
          .limit(600),
      ]);

      if (studentsResponse.error) throw new Error(studentsResponse.error.message);
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);

      const students = (studentsResponse.data ?? []) as StudentTaskRow[];
      const invoices = (invoicesResponse.data ?? []) as InvoiceTaskRow[];
      const studentById = new Map(students.map((student) => [student.id, student]));

      const nextTasks: TaskItem[] = [];

      for (const invoice of invoices) {
        const student = studentById.get(invoice.student_id);
        if (!student) continue;

        const openCents = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
        if (openCents <= 0) continue;

        const overdueDays = daysLate(invoice.due_date);
        const dueInDays = daysUntilDue(invoice.due_date);

        if (overdueDays <= 0 && dueInDays > 7) continue;

        const kind = getTaskKind(overdueDays, dueInDays);
        const priority = getTaskPriority(overdueDays, dueInDays, openCents);

        nextTasks.push({
          id: invoice.id,
          studentName: student.full_name ?? "Cliente",
          rawPhone: student.phone ?? "",
          whatsappPhone: normalizeWhatsappPhone(student.phone ?? ""),
          dueDate: invoice.due_date,
          openCents,
          daysOverdue: overdueDays,
          daysToDue: dueInDays,
          priority,
          kind,
          message: buildTaskMessage({
            studentName: student.full_name ?? "Cliente",
            openCents,
            dueDate: invoice.due_date,
            overdueDays,
          }),
        });
      }

      const priorityRank: Record<TaskPriority, number> = { alta: 0, media: 1, baixa: 2 };

      nextTasks.sort((a, b) => {
        const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
        if (byPriority !== 0) return byPriority;
        if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
        if (a.daysToDue !== b.daysToDue) return a.daysToDue - b.daysToDue;
        return b.openCents - a.openCents;
      });

      setTasks(nextTasks);
      setLastSync(
        new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date())
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao carregar tarefas de cobrança.";
      setErrorMessage(message);
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!copiedTaskId) return;
    const timer = window.setTimeout(() => setCopiedTaskId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedTaskId]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesSearch =
        !term ||
        task.studentName.toLowerCase().includes(term) ||
        task.rawPhone.toLowerCase().includes(term);

      if (!matchesSearch) return false;

      if (activeFilter === "todas") return true;
      if (activeFilter === "alta" || activeFilter === "media" || activeFilter === "baixa") {
        return task.priority === activeFilter;
      }
      if (activeFilter === "atrasadas") return task.kind === "atrasada";
      if (activeFilter === "hoje") return task.kind === "hoje";
      return true;
    });
  }, [activeFilter, search, tasks]);

  const counters = useMemo(() => {
    return {
      todas: tasks.length,
      alta: tasks.filter((task) => task.priority === "alta").length,
      media: tasks.filter((task) => task.priority === "media").length,
      baixa: tasks.filter((task) => task.priority === "baixa").length,
      atrasadas: tasks.filter((task) => task.kind === "atrasada").length,
      hoje: tasks.filter((task) => task.kind === "hoje").length,
      totalOpenCents: tasks.reduce((total, task) => total + task.openCents, 0),
      withoutWhatsapp: tasks.filter((task) => !task.whatsappPhone).length,
    };
  }, [tasks]);

  const logTaskAction = useCallback(
    async (
      task: TaskItem,
      outcome: "sent" | "failed" | "no_reply" | "promised" | "paid" | "other",
      notes: string
    ) => {
      if (!organizationId) return;
      const templateKind = task.kind === "atrasada" ? "overdue" : "reminder";
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.rpc("log_collection_event", {
          p_org_id: organizationId,
          p_invoice_id: task.id,
          p_channel: "whatsapp",
          p_template_kind: templateKind,
          p_outcome: outcome,
          p_message: task.message,
          p_notes: notes,
        });
      } catch {
        // Keep UI flow responsive if audit logging fails.
      }
    },
    [organizationId]
  );

  const handleOpenWhatsapp = (task: TaskItem) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!task.whatsappPhone) {
      setErrorMessage(`Telefone inválido para WhatsApp em ${task.studentName}.`);
      void logTaskAction(task, "failed", "Telefone inválido para disparo de cobrança.");
      return;
    }

    window.open(buildWhatsappUrl(task.whatsappPhone, task.message), "_blank", "noopener,noreferrer");
    void logTaskAction(task, "sent", "Disparo pela central de tarefas.");
  };

  const handleCopyMessage = async (task: TaskItem) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await copyToClipboard(task.message);
      setCopiedTaskId(task.id);
      setSuccessMessage(`Mensagem copiada para ${task.studentName}.`);
      void logTaskAction(task, "other", "Mensagem copiada na central de tarefas.");
    } catch {
      setErrorMessage("Não foi possível copiar a mensagem.");
    }
  };

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-md border-l-2 border-[var(--accent)] px-4 py-6 md:px-6 md:py-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Cobrança operacional</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100 md:text-3xl">
              Central de tarefas de cobrança
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              Saiba quem cobrar hoje, com prioridade clara e ação rápida via WhatsApp.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadTasks()}
            className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold"
          >
            <RefreshCcw size={14} />
            Atualizar tarefas
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1">
            <Clock3 size={12} />
            {lastSync ? `última atualização ${lastSync}` : "sincronizando"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1">
            <AlertTriangle size={12} />
            {counters.atrasadas} atrasadas
          </span>
        </div>
      </header>

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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Tarefas</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">{counters.todas}</p>
        </article>
        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Alta prioridade</p>
          <p className="mt-2 text-2xl font-semibold text-red-300">{counters.alta}</p>
        </article>
        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Valor em aberto</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">
            {centsToCurrency(counters.totalOpenCents)}
          </p>
        </article>
        <article className="surface-soft rounded-md p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Sem WhatsApp válido</p>
          <p className="mt-2 text-2xl font-semibold text-amber-300">{counters.withoutWhatsapp}</p>
        </article>
      </div>

      <section className="surface rounded-md p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(filterLabels) as TaskFilter[]).map((filter) => {
              const isActive = activeFilter === filter;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={[
                    "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition",
                    isActive
                      ? "border-[var(--accent)] bg-[var(--card-soft)] text-zinc-100"
                      : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
                  ].join(" ")}
                >
                  {filterLabels[filter]}
                  <span className="text-[10px] text-zinc-500">
                    ({counters[filter]})
                  </span>
                </button>
              );
            })}
          </div>

          <label className="relative w-full lg:w-[280px]">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="field glow-focus h-10 w-full rounded-md pl-8 pr-3 text-sm outline-none"
              placeholder="Buscar cliente ou telefone"
            />
          </label>
        </div>

        <div className="mt-4 space-y-2">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`task-skeleton-${index}`} className="h-[124px] rounded-md" />
            ))
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
              Nenhuma tarefa encontrada para o filtro atual.
            </div>
          ) : (
            filteredTasks.map((task) => (
              <article key={task.id} className="rounded-md border border-white/10 bg-white/5 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">{task.studentName}</p>
                    <p className="mt-1 text-xs text-zinc-500">{task.rawPhone || "Telefone não informado"}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-medium ${priorityMeta[task.priority].className}`}
                      >
                        {priorityMeta[task.priority].label}
                      </span>
                      <span className="inline-flex rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300">
                        {kindMeta[task.kind]}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-zinc-400">
                      Vencimento: {formatShortDate(task.dueDate)} • Em aberto: {centsToCurrency(task.openCents)}
                      {task.daysOverdue > 0 ? ` • ${task.daysOverdue} dias de atraso` : ""}
                      {task.kind === "proxima" ? ` • vence em ${task.daysToDue} dias` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenWhatsapp(task)}
                      disabled={!task.whatsappPhone}
                      className="btn-primary inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <MessageCircle size={13} />
                      Cobrar no WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyMessage(task)}
                      className="btn-muted inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs"
                    >
                      {copiedTaskId === task.id ? <CheckCircle2 size={13} /> : <Clipboard size={13} />}
                      {copiedTaskId === task.id ? "Copiado" : "Copiar mensagem"}
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
