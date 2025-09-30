"use client";

export default function ConfirmModal({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  inputPlaceholder,
  defaultValue = "",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  inputPlaceholder?: string;
  defaultValue?: string;
  onConfirm: (value?: string) => void | Promise<void>;
  onClose: () => void;
}) {
  if (!open) return null;
  let inputRef: HTMLInputElement | null = null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}></div>
      <div className="relative w-[92vw] max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl">
        <div className="text-sm font-semibold text-zinc-100">{title}</div>
        {description && (
          <div className="mt-1 text-xs text-zinc-400">{description}</div>
        )}
        {typeof inputPlaceholder === "string" && (
          <input
            ref={(r) => {
              inputRef = r;
            }}
            className="mt-3 w-full rounded-lg bg-zinc-800/70 border border-zinc-700/60 p-2 text-sm text-zinc-100"
            placeholder={inputPlaceholder}
            defaultValue={defaultValue}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onConfirm((inputRef?.value || "").trim());
              }
            }}
          />
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            onClick={onClose}
          >
            {cancelText}
          </button>
          <button
            className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
            onClick={() => onConfirm((inputRef?.value || "").trim())}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
