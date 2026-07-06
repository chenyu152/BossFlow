import { useMemo } from 'react';
import { Check } from 'lucide-react';
import type { ConfigPatch, ConfigPayload } from '../types';

export function Rules({ config, updateConfig, onSave }: { config: ConfigPayload; updateConfig: (patch: ConfigPatch) => void; onSave: () => void }) {
  const jsonStatus = useMemo(() => {
    try {
      const value = JSON.parse(config.catRulesText || '{}');
      return typeof value === 'object' && !Array.isArray(value) ? 'Valid JSON' : 'Must be object';
    } catch {
      return 'Invalid JSON';
    }
  }, [config.catRulesText]);
  const valid = jsonStatus === 'Valid JSON';

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">Data Cleaning Rules</h1>
        <button onClick={onSave} className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors">Save Rules</button>
      </div>

      <div className="grid grid-cols-2 gap-8 flex-1">
        <div className="flex flex-col h-full">
          <label className="block text-sm font-medium text-zinc-300 mb-2">Category Rules (JSON)</label>
          <div className="flex-1 border border-zinc-800 rounded-md bg-[#1e1e1e] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-[#3c3c3c]">
              <span className="text-xs text-zinc-400 font-mono">rules.json</span>
              <div className={`flex items-center gap-1.5 text-xs ${valid ? 'text-emerald-400' : 'text-red-400'}`}>
                <Check size={12} />
                {jsonStatus}
              </div>
            </div>
            <textarea
              className="flex-1 w-full bg-transparent p-4 text-[13px] text-zinc-300 font-mono leading-relaxed outline-none resize-none"
              value={config.catRulesText}
              onChange={(event) => updateConfig({ catRulesText: event.target.value })}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="space-y-6">
          <RuleTextArea label="Fallback Keywords" note="If category not matched" value={config.relevanceText} onChange={(value) => updateConfig({ relevanceText: value })} />
          <RuleTextArea label="Blacklist Keywords" note="Discard job if title matches" value={config.blacklistText} onChange={(value) => updateConfig({ blacklistText: value })} />
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Minimum Avg Salary (K/month)</label>
            <input type="number" value={config.minSalary} onChange={(event) => updateConfig({ minSalary: Number(event.target.value || 0) })} className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500" />
            <p className="mt-2 text-xs text-zinc-500">Jobs below this threshold will be discarded during processing.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleTextArea({ label, note, value, onChange }: { label: string; note: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-2 flex items-center justify-between">
        {label}
        <span className="text-xs text-zinc-500 font-normal">{note}</span>
      </label>
      <textarea
        className="w-full h-32 bg-zinc-900/50 border border-zinc-800 rounded-md p-3 text-sm text-zinc-200 focus:border-indigo-500 outline-none font-mono resize-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
