export function DetailItem({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-sm ${strong ? 'font-medium text-zinc-200' : accent ? 'text-emerald-400' : 'text-zinc-300'}`}>{value || '-'}</div>
    </div>
  );
}
