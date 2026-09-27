// @ts-nocheck
import { GlassCard } from "@/components/GlassCard";

/** A single pulsing placeholder bar/block. Compose these into page-shaped skeletons. */
export function SkeletonBlock({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted/40 ${className}`} style={style} />;
}

/** Row of stat tiles, shaped like the Dashboard's top row. */
export function SkeletonStatRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <GlassCard key={i} hover={false}>
          <SkeletonBlock className="h-3 w-20 mb-3" />
          <SkeletonBlock className="h-7 w-16" />
        </GlassCard>
      ))}
    </div>
  );
}

/** A chart-shaped placeholder — header line + a tall block where the chart will render. */
export function SkeletonChart({ height = 300 }: { height?: number }) {
  return (
    <GlassCard hover={false}>
      <div className="flex items-center justify-between mb-3">
        <SkeletonBlock className="h-3 w-32" />
        <SkeletonBlock className="h-3 w-20" />
      </div>
      <SkeletonBlock className="w-full" style={{ height }} />
    </GlassCard>
  );
}

/** Grid of card-shaped placeholders, for report/dataset/forecast listing pages. */
export function SkeletonCardGrid({ count = 6, columns = "md:grid-cols-2 lg:grid-cols-3" }: { count?: number; columns?: string }) {
  return (
    <div className={`grid grid-cols-1 ${columns} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <GlassCard key={i} hover={false} className="space-y-3">
          <SkeletonBlock className="h-4 w-3/4" />
          <SkeletonBlock className="h-3 w-full" />
          <SkeletonBlock className="h-3 w-5/6" />
          <div className="flex gap-2 pt-2">
            <SkeletonBlock className="h-8 flex-1" />
            <SkeletonBlock className="h-8 w-8" />
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

/** Full-page skeleton shown while a lazy-loaded route's JS is still downloading. */
export function SkeletonPage() {
  return (
    <div className="space-y-6">
      <div>
        <SkeletonBlock className="h-7 w-48 mb-2" />
        <SkeletonBlock className="h-4 w-72" />
      </div>
      <SkeletonStatRow />
      <SkeletonChart />
    </div>
  );
}
