"use client";

export default function DebugJsonCard({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  let displayValue: string;
  try {
    displayValue = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    displayValue = String(value);
  }
  if (displayValue === undefined) {
    displayValue = "undefined";
  }
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3">
      <h5 className="text-xs font-semibold text-zinc-300 mb-2">{title}</h5>
      <pre className="text-[11px] text-zinc-300 bg-zinc-900 border border-zinc-600 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
        {displayValue}
      </pre>
    </div>
  );
}
