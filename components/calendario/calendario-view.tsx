"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";
import {
  centsToCurrency,
  formatShortDate,
  type InvoiceRow,
  type StudentRow,
} from "@/lib/shad-manager/utils";

type CalendarInvoice = {
  id: string;
  nome: string;
  dueDate: string;
  status: InvoiceRow["status"];
  abertoCents: number;
};

const weekDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function mapInvoiceStatus(status: InvoiceRow["status"]) {
  if (status === "overdue") return "Atrasado";
  if (status === "partial") return "Parcial";
  return "Aberto";
}

const statusTone: Record<string, string> = {
  Atrasado: "border-red-500/30 bg-red-500/10 text-red-300",
  Parcial: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Aberto: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

export function CalendarioView() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => toIsoDate(new Date()));
  const [invoices, setInvoices] = useState<CalendarInvoice[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const monthEnd = useMemo(() => endOfMonth(currentMonth), [currentMonth]);
  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const loadCalendar = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: orgContext, error: orgError } = await getUserOrgContext(supabase);
      if (orgError || !orgContext) {
        throw new Error(orgError ?? "Falha ao validar organizacao.");
      }

      const monthStartIso = toIsoDate(monthStart);
      const monthEndIso = toIsoDate(monthEnd);

      const [studentsResponse, invoicesResponse] = await Promise.all([
        supabase
          .from("students")
          .select("id, full_name")
          .eq("organization_id", orgContext.organizationId),
        supabase
          .from("invoices")
          .select("id, student_id, due_date, amount_cents, paid_amount_cents, status")
          .eq("organization_id", orgContext.organizationId)
          .gte("due_date", monthStartIso)
          .lt("due_date", monthEndIso)
          .in("status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true }),
      ]);

      if (studentsResponse.error) throw new Error(studentsResponse.error.message);
      if (invoicesResponse.error) throw new Error(invoicesResponse.error.message);

      const students = (studentsResponse.data ?? []) as Pick<StudentRow, "id" | "full_name">[];
      const invoiceRows = (invoicesResponse.data ?? []) as InvoiceRow[];

      const studentNameById = new Map(students.map((student) => [student.id, student.full_name]));

      const calendarInvoices = invoiceRows.map((invoice) => {
        const abertoCents = Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0);
        return {
          id: invoice.id,
          nome: studentNameById.get(invoice.student_id) ?? "Cliente",
          dueDate: invoice.due_date,
          status: invoice.status,
          abertoCents,
        } satisfies CalendarInvoice;
      });

      setInvoices(calendarInvoices);
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
      const message = error instanceof Error ? error.message : "Erro ao carregar calendario.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [monthEnd, monthStart]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    const selected = new Date(`${selectedDate}T00:00:00`);
    if (selected < monthStart || selected >= monthEnd) {
      setSelectedDate(toIsoDate(monthStart));
    }
  }, [monthEnd, monthStart, selectedDate]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
      }).format(monthStart),
    [monthStart]
  );

  const selectedDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(new Date(`${selectedDate}T00:00:00`)),
    [selectedDate]
  );

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarInvoice[]>();
    for (const invoice of invoices) {
      const list = map.get(invoice.dueDate) ?? [];
      list.push(invoice);
      map.set(invoice.dueDate, list);
    }
    return map;
  }, [invoices]);

  const totalMonthCents = useMemo(
    () => invoices.reduce((acc, invoice) => acc + invoice.abertoCents, 0),
    [invoices]
  );

  const selectedItems = itemsByDate.get(selectedDate) ?? [];
  const selectedTotalCents = selectedItems.reduce((acc, invoice) => acc + invoice.abertoCents, 0);

  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const firstDay = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    const offset = (firstDay.getDay() + 6) % 7;

    const days: Array<{ date: Date; iso: string } | null> = [];
    for (let i = 0; i < offset; i += 1) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      days.push({ date, iso: toIsoDate(date) });
    }

    while (days.length % 7 !== 0) {
      days.push(null);
    }

    return days;
  }, [monthStart]);

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(toIsoDate(today));
  };

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-3xl border-l-4 border-amber-400/60 px-4 py-6 pl-5 md:px-6 md:py-7 md:pl-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Controle</p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight text-zinc-100 sm:text-4xl">
              Calendario de recebimentos
            </h2>
            <p className="mt-3 text-sm text-zinc-300">
              Visualize os dias com cobrancas em aberto e mantenha o fluxo em dia.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="surface-soft rounded-2xl px-3 py-2">
              <p className="text-xs text-zinc-500">Total do mes</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">
                {centsToCurrency(totalMonthCents)}
              </p>
            </div>
            <div className="surface-soft rounded-2xl px-3 py-2">
              <p className="text-xs text-zinc-500">Dias marcados</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">{itemsByDate.size}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="surface rounded-3xl p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <CalendarDays size={16} />
                <span className="capitalize">{monthLabel}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Selecione um dia para ver os detalhes.</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="btn-muted inline-flex items-center justify-center rounded-lg p-2"
                aria-label="Mes anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="btn-muted inline-flex items-center justify-center rounded-lg p-2"
                aria-label="Proximo mes"
              >
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="btn-muted rounded-lg px-3 py-2 text-xs"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => void loadCalendar()}
                className="btn-muted inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
              >
                <RefreshCcw size={14} />
                Atualizar
              </button>
            </div>
          </div>

          {errorMessage ? (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-6 grid grid-cols-7 gap-2 text-xs text-zinc-500">
            {weekDays.map((label) => (
              <div key={label} className="text-center uppercase tracking-[0.18em]">
                {label}
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-7 gap-2">
            {isLoading
              ? Array.from({ length: 35 }).map((_, index) => (
                  <Skeleton key={`calendar-skeleton-${index}`} className="h-12 rounded-lg" />
                ))
              : calendarDays.map((day, index) => {
                  if (!day) {
                    return <div key={`empty-${index}`} className="h-12" />;
                  }

                  const hasItems = (itemsByDate.get(day.iso) ?? []).length > 0;
                  const isSelected = day.iso === selectedDate;
                  const isToday = day.iso === todayIso;
                  const count = itemsByDate.get(day.iso)?.length ?? 0;

                  return (
                    <button
                      type="button"
                      key={day.iso}
                      onClick={() => setSelectedDate(day.iso)}
                      className={[
                        "group flex h-12 flex-col items-center justify-center rounded-lg border text-sm transition",
                        isSelected
                          ? "border-white/40 bg-white/10 text-zinc-100"
                          : "border-transparent text-zinc-300 hover:border-white/20 hover:bg-white/5",
                        isToday && !isSelected ? "border-emerald-400/40" : "",
                      ].join(" ")}
                      aria-pressed={isSelected}
                    >
                      <span className="text-sm font-semibold">{day.date.getDate()}</span>
                      {hasItems ? (
                        <span className="mt-1 inline-flex items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">
                          {count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
          </div>

          {lastSync ? (
            <p className="mt-4 text-xs text-zinc-500">Atualizado em {lastSync}</p>
          ) : null}
        </div>

        <aside className="surface rounded-3xl p-4 md:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-100">Recebimentos do dia</p>
              <p className="mt-1 text-xs text-zinc-500">{selectedDateLabel}</p>
            </div>
            <div className="surface-soft rounded-xl px-3 py-1.5 text-xs text-zinc-300">
              Total: {centsToCurrency(selectedTotalCents)}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`list-skeleton-${index}`} className="h-16 rounded-xl" />
              ))
            ) : selectedItems.length === 0 ? (
              <p className="surface-soft rounded-xl px-3 py-2 text-sm text-zinc-400">
                Nenhum recebimento previsto para este dia.
              </p>
            ) : (
              selectedItems.map((item) => {
                const statusLabel = mapInvoiceStatus(item.status);
                return (
                  <div key={item.id} className="surface-soft rounded-xl p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-100">{item.nome}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Vencimento {formatShortDate(item.dueDate)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-2 py-1 text-[11px] ${statusTone[statusLabel]}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-zinc-100">
                      {centsToCurrency(item.abertoCents)}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
