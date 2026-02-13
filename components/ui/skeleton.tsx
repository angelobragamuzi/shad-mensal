interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div className={`animate-shimmer relative overflow-hidden rounded-xl bg-zinc-900/80 ${className}`} />
  );
}
