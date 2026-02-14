"use client";

export type BillingCycle = "monthly" | "weekly" | "quarterly";
export type InvoiceStatus = "pending" | "partial" | "paid" | "overdue" | "canceled";
export type UiStudentStatus = "Pago" | "Inadimplente" | "Próximo do vencimento";

export interface StudentRow {
  id: string;
  full_name: string;
  phone: string;
  billing_cycle: BillingCycle;
  amount_cents: number;
  due_day: number;
}

export interface InvoiceRow {
  id: string;
  student_id: string;
  due_date: string;
  amount_cents: number;
  paid_amount_cents: number;
  status: InvoiceStatus;
  paid_at: string | null;
}

export interface PaymentRow {
  id: string;
  student_id: string;
  invoice_id: string;
  amount_cents: number;
  paid_at: string;
}

export function centsToCurrency(valueCents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    valueCents / 100
  );
}

export function mapBillingCycleLabel(cycle: BillingCycle): string {
  if (cycle === "weekly") return "Semanal";
  if (cycle === "quarterly") return "Trimestral";
  return "Mensal";
}

export function mapStatusLabel(invoice: InvoiceRow | null): UiStudentStatus {
  if (!invoice) {
    return "Próximo do vencimento";
  }

  if (invoice.status === "paid") {
    return "Pago";
  }

  const dueDate = new Date(`${invoice.due_date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (invoice.status === "overdue" || dueDate < today) {
    return "Inadimplente";
  }

  return "Próximo do vencimento";
}

export function buildCurrentPeriodDates(
  dueDay: number
): { start: string; end: string; dueDate: string } {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const lastDay = monthEnd.getDate();
  const due = new Date(
    now.getFullYear(),
    now.getMonth(),
    Math.min(Math.max(dueDay, 1), lastDay)
  );

  return {
    start: monthStart.toISOString().slice(0, 10),
    end: monthEnd.toISOString().slice(0, 10),
    dueDate: due.toISOString().slice(0, 10),
  };
}

export function daysLate(isoDate: string): number {
  const due = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = today.getTime() - due.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function formatShortDate(isoDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(
    new Date(`${isoDate}T00:00:00`)
  );
}

export function formatHour(isoDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(isoDate)
  );
}
