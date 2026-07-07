export function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-zinc-800 bg-zinc-900/30 p-4 rounded-md">
      <div className="text-xs text-zinc-500 font-medium mb-1">{label}</div>
      <div className="text-2xl font-semibold text-zinc-100 truncate" title={value}>{value}</div>
      {hint && <div className="mt-1 truncate text-xs text-zinc-500" title={hint}>{hint}</div>}
    </div>
  );
}
