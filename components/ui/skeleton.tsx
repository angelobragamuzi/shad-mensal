interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-shimmer relative overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card-soft)] ${className}`}
    />
  );
}
