"use client";

import { useState } from "react";

export default function SavePromptModal({
  open,
  onClose,
  onSave,
  initialTitle,
  initialCategory,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: { title: string; category: string }) => Promise<void> | void;
  initialTitle?: string | null;
  initialCategory?: string | null;
}) {
  const [title, setTitle] = useState<string>(initialTitle || "");
  const [category, setCategory] = useState<string>(initialCategory || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSave() {
    if (!title.trim() || !category.trim()) {
      setError("Lütfen başlık ve kategori girin");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ title: title.trim(), category: category.trim() });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Kaydedilemedi";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-zinc-100 mb-4">
          Promptu Kaydet
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Başlık</label>
            <input
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 p-2 text-sm text-zinc-100"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Son 30 Gün Satışları"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Kategori</label>
            <input
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 p-2 text-sm text-zinc-100"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Örn: Satış Raporları"
            />
          </div>
          {error && <div className="text-xs text-red-400">Hata: {error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              disabled={saving}
            >
              İptal
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
