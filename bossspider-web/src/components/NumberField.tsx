export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="number-field grid grid-cols-2 gap-4 items-center">
      <label className="text-sm text-zinc-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        className="bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
      />
    </div>
  );
}
