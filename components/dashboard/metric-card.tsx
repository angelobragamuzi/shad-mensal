type MetricTone = "positive" | "neutral" | "alert";

interface MetricCardProps {
  title: string;
  value: string;
  helper: string;
  tone?: MetricTone;
}

const toneClasses: Record<MetricTone, string> = {
  positive: "text-emerald-300",
  neutral: "text-zinc-100",
  alert: "text-amber-300",
};

export function MetricCard({ title, value, helper, tone = "neutral" }: MetricCardProps) {
  return (
    <article className="surface rounded-3xl p-5">
      <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">{title}</p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${toneClasses[tone]}`}>{value}</p>
      <p className="mt-2 text-sm text-zinc-400">{helper}</p>
    </article>
  );
}
