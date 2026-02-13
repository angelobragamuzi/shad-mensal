"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";
import {
  centsToCurrency,
  daysLate,
  formatHour,
  formatShortDate,
  type InvoiceRow,
  type PaymentRow,
  type StudentRow,
} from "@/lib/shad-manager/utils";

interface MetricsRpcRow {
  total_students: number;
  total_to_receive_cents: number;
  total_received_cents: number;
  total_overdue_cents: number;
}

interface RecentPaymentItem {
  id: string;
  nome: string;
  valor: string;
  valorCents: number;
  horario: string;
}

interface OpenInvoiceItem {
  id: string;
  nome: string;
  vencimento: string;
  statusText: string;
  aberto: string;
  abertoCents: number;
  daysLateValue: number;
  daysToDue: number;
}

type MetricTone = "neutral" | "positive" | "alert";

interface MetricItem {
  id: string;
  title: string;
  value: string;
  helper: string;
  icon: ComponentType<{ size?: number }>;
  tone: MetricTone;
}

const emptyMetrics: MetricsRpcRow = {
  total_students: 0,
  total_to_receive_cents: 0,
  total_received_cents: 0,
  total_overdue_cents: 0,
};

const toneClassName: Record<MetricTone, string> = {
  neutral: "text-zinc-100",
  positive: "text-emerald-300",
  alert: "text-amber-300",
};

function getDueMeta(isoDate: string) {
  const late = daysLate(isoDate);
  if (late > 0) {
    return {
      text: `${late} dias de atraso`,
      daysLateValue: late,
      daysToDue: 0,
    };
  }

  const due = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - today.getTime();
  const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  return {
    text: diffDays === 0 ? "vence hoje" : `vence em ${diffDays} dias`,
    daysLateValue: 0,
    daysToDue: diffDays,
  };
}

function ratioToWidth(ratio: number) {
  const safeRatio = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  return `${safeRatio * 100}%`;
}

export function DashboardView() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsRpcRow>(emptyMetrics);
  const [pagamentosRecentes, setPagamentosRecentes] = useState<RecentPaymentItem[]>([]);
  const [faturasAbertas, setFaturasAbertas] = useState<OpenInvoiceItem[]>([]);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: orgContext, error: orgError } = await getUserOrgContext(supabase);
      if (orgError || !orgContext) {
        throw new Error(orgError ?? "Falha ao validar organização.");
      }

      const organizationId = orgContext.organizationId;

      const [metricsResponse, studentsResponse, paymentsResponse, invoicesResponse] =
        await Promise.all([
          supabase.rpc("get_dashboard_metrics", { p_org_id: organizationId }),
          supabase
            .from("students")
            .select("id, full_name, phone, billing_cycle, amount_cents, due_day")
            .eq("organization_id", organizationId),
          supabase
            .from("payments")
            .select("id, student_id, invoice_id, amount_cents, paid_at")
            .eq("organization_id", organizationId)
            .order("paid_at", { ascending: false })
            .limit(10),
          supabase
            .from("invoices")
            .select("id, student_id, due_date, amount_cents, paid_amount_cents, status, paid_at")
            .eq("organization_id", organizationId)
            .in("status", ["pending", "partial", "overdue"])
            .order("due_date", { ascending: true })
            .limit(40),
        ]);

      if (metricsResponse.error) throw new Error(metricsResponse.error.message);
      if (studentsResponse.error) throw new Error(studentsResponse.error.message);
      if (paymentsResponse.error) throw new Error(paymentsResponse.error.message);
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);

      const metricsRow = (metricsResponse.data?.[0] ?? emptyMetrics) as MetricsRpcRow;
      const students = (studentsResponse.data ?? []) as StudentRow[];
      const payments = (paymentsResponse.data ?? []) as PaymentRow[];
      const invoices = (invoicesResponse.data ?? []) as InvoiceRow[];

      const studentNameById = new Map(students.map((student) => [student.id, student.full_name]));

      const paymentItems = payments.map((payment) => ({
        id: payment.id,
        nome: studentNameById.get(payment.student_id) ?? "Cliente",
        valor: centsToCurrency(payment.amount_cents),
        valorCents: payment.amount_cents,
        horario: formatHour(payment.paid_at),
      }));

      const openInvoiceItems = invoices.map((invoice) => {
        const abertoCents = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
        const dueMeta = getDueMeta(invoice.due_date);

        return {
          id: invoice.id,
          nome: studentNameById.get(invoice.student_id) ?? "Cliente",
          vencimento: formatShortDate(invoice.due_date),
          statusText: dueMeta.text,
          aberto: centsToCurrency(abertoCents),
          abertoCents,
          daysLateValue: dueMeta.daysLateValue,
          daysToDue: dueMeta.daysToDue,
        } satisfies OpenInvoiceItem;
      });

      setMetrics(metricsRow);
      setPagamentosRecentes(paymentItems);
      setFaturasAbertas(openInvoiceItems);
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
      const message = error instanceof Error ? error.message : "Erro ao carregar dashboard.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const dataAtual = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      }).format(new Date()),
    []
  );

  const totalEmAbertoCents = useMemo(
    () => faturasAbertas.reduce((acc, item) => acc + item.abertoCents, 0),
    [faturasAbertas]
  );

  const totalPagamentosRecentesCents = useMemo(
    () => pagamentosRecentes.reduce((acc, item) => acc + item.valorCents, 0),
    [pagamentosRecentes]
  );

  const criticalInvoices = useMemo(
    () =>
      [...faturasAbertas]
        .filter((item) => item.daysLateValue > 0)
        .sort((a, b) => b.daysLateValue - a.daysLateValue || b.abertoCents - a.abertoCents)
        .slice(0, 6),
    [faturasAbertas]
  );

  const upcomingInvoices = useMemo(
    () =>
      [...faturasAbertas]
        .filter((item) => item.daysLateValue === 0)
        .sort((a, b) => a.daysToDue - b.daysToDue || b.abertoCents - a.abertoCents)
        .slice(0, 6),
    [faturasAbertas]
  );

  const recebimentoRatio = useMemo(() => {
    if (metrics.total_to_receive_cents <= 0) return 0;
    return metrics.total_received_cents / metrics.total_to_receive_cents;
  }, [metrics.total_received_cents, metrics.total_to_receive_cents]);

  const inadimplenciaRatio = useMemo(() => {
    if (metrics.total_to_receive_cents <= 0) return 0;
    return metrics.total_overdue_cents / metrics.total_to_receive_cents;
  }, [metrics.total_overdue_cents, metrics.total_to_receive_cents]);

  const ticketMedioCents = useMemo(() => {
    if (metrics.total_students <= 0) return 0;
    return Math.round(metrics.total_to_receive_cents / metrics.total_students);
  }, [metrics.total_students, metrics.total_to_receive_cents]);

  const metricCards: MetricItem[] = [
    {
      id: "students",
      title: "Clientes ativos",
      value: String(metrics.total_students ?? 0),
      helper: "base atual de contratos",
      icon: UsersRound,
      tone: "neutral",
    },
    {
      id: "to-receive",
      title: "A receber no mês",
      value: centsToCurrency(metrics.total_to_receive_cents ?? 0),
      helper: `${faturasAbertas.length} faturas em aberto`,
      icon: Wallet,
      tone: "neutral",
    },
    {
      id: "received",
      title: "Recebido no mês",
      value: centsToCurrency(metrics.total_received_cents ?? 0),
      helper: `${Math.round(recebimentoRatio * 100)}% da meta mensal`,
      icon: CheckCircle2,
      tone: "positive",
    },
    {
      id: "overdue",
      title: "Inadimplência",
      value: centsToCurrency(metrics.total_overdue_cents ?? 0),
      helper: `${criticalInvoices.length} casos críticos`,
      icon: AlertTriangle,
      tone: "alert",
    },
  ];

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface relative overflow-hidden rounded-3xl border-l-4 border-amber-400/60 px-4 py-4 pl-5 md:px-6 md:py-5 md:pl-7">
        <div className="pointer-events-none absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5">
              <CalendarDays size={13} />
              {dataAtual}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5">
              <Clock3 size={13} />
              {lastSync ? `última atualização ${lastSync}` : "sincronizando dados"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="btn-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            >
              <RefreshCcw size={14} />
              Atualizar dados
            </button>

            <Link
              href="/clientes"
              className="btn-muted inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
            >
              Ir para clientes
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {errorMessage ? (
        <div className="surface rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? metricCards.map((metric) => <Skeleton key={metric.id} className="h-[132px] rounded-2xl" />)
          : metricCards.map((metric) => {
              const Icon = metric.icon;
              return (
                <article
                  key={metric.id}
                  className="surface-soft rounded-2xl p-4 transition duration-200 hover:-translate-y-[1px] hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">{metric.title}</p>
                      <p className={`mt-2 text-2xl font-semibold ${toneClassName[metric.tone]}`}>
                        {metric.value}
                      </p>
                    </div>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300">
                      <Icon size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">{metric.helper}</p>
                </article>
              );
            })}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[1.45fr_0.95fr]">
        <section className="surface rounded-3xl p-4 md:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">Agenda de cobrança</h3>
              <p className="mt-1 text-sm text-zinc-400">
                {faturasAbertas.length} faturas abertas, total de {centsToCurrency(totalEmAbertoCents)}.
              </p>
            </div>
            <Link
              href="/clientes"
              className="btn-muted inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
            >
              Gerenciar carteira
              <ArrowRight size={13} />
            </Link>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="surface-soft rounded-2xl p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Críticos em atraso</p>
              <div className="mt-2 space-y-2">
                {isLoading
                  ? Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={`critical-skeleton-${index}`} className="h-14 rounded-xl" />
                    ))
                  : criticalInvoices.length === 0
                    ? (
                        <p className="rounded-xl border border-white/8 bg-zinc-950/35 px-3 py-2 text-xs text-zinc-400">
                          Nenhuma fatura em atraso no momento.
                        </p>
                      )
                    : criticalInvoices.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-white/8 bg-zinc-950/35 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-medium text-zinc-100">{item.nome}</p>
                            <p className="text-sm font-semibold text-red-300">{item.aberto}</p>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.vencimento} - {item.statusText}
                          </p>
                        </div>
                      ))}
              </div>
            </article>

            <article className="surface-soft rounded-2xl p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Próximos vencimentos</p>
              <div className="mt-2 space-y-2">
                {isLoading
                  ? Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={`upcoming-skeleton-${index}`} className="h-14 rounded-xl" />
                    ))
                  : upcomingInvoices.length === 0
                    ? (
                        <p className="rounded-xl border border-white/8 bg-zinc-950/35 px-3 py-2 text-xs text-zinc-400">
                          Sem vencimentos pendentes para os próximos dias.
                        </p>
                      )
                    : upcomingInvoices.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-white/8 bg-zinc-950/35 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-medium text-zinc-100">{item.nome}</p>
                            <p className="text-sm font-semibold text-amber-300">{item.aberto}</p>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.vencimento} - {item.statusText}
                          </p>
                        </div>
                      ))}
              </div>
            </article>
          </div>
        </section>

        <aside className="space-y-4">
          <article className="surface rounded-3xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-zinc-100">Saúde da receita</h3>
              <TrendingUp size={16} className="text-zinc-400" />
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Meta recebida</span>
                  <span className="text-zinc-200">{Math.round(recebimentoRatio * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-900">
                  <div
                    className="h-2 rounded-full bg-emerald-400/80"
                    style={{ width: ratioToWidth(recebimentoRatio) }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Inadimplência</span>
                  <span className="text-zinc-200">{Math.round(inadimplenciaRatio * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-900">
                  <div
                    className="h-2 rounded-full bg-amber-400/80"
                    style={{ width: ratioToWidth(inadimplenciaRatio) }}
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="surface-soft rounded-xl p-3">
                  <p className="text-xs text-zinc-500">Ticket médio</p>
                  <p className="mt-1 text-base font-semibold text-zinc-100">
                    {centsToCurrency(ticketMedioCents)}
                  </p>
                </div>
                <div className="surface-soft rounded-xl p-3">
                  <p className="text-xs text-zinc-500">Entradas recentes</p>
                  <p className="mt-1 text-base font-semibold text-emerald-300">
                    {centsToCurrency(totalPagamentosRecentesCents)}
                  </p>
                </div>
              </div>
            </div>
          </article>

          <article className="surface rounded-3xl p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-zinc-100">Pagamentos recentes</h3>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400">
                {pagamentosRecentes.length} registros
              </span>
            </div>

            <div className="space-y-2">
              {isLoading
                ? Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={`payment-skeleton-${index}`} className="h-14 rounded-xl" />
                  ))
                : pagamentosRecentes.length === 0
                  ? (
                      <p className="surface-soft rounded-xl px-3 py-2 text-sm text-zinc-400">
                        Nenhum pagamento registrado ainda.
                      </p>
                    )
                  : pagamentosRecentes.map((item) => (
                      <div
                        key={item.id}
                        className="surface-soft flex items-center justify-between rounded-xl px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-100">{item.nome}</p>
                          <p className="mt-1 text-xs text-zinc-500">{item.horario}</p>
                        </div>
                        <p className="text-sm font-semibold text-emerald-300">{item.valor}</p>
                      </div>
                    ))}
            </div>
          </article>
        </aside>
      </div>
    </section>
  );
}
