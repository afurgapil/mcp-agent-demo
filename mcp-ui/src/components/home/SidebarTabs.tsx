"use client";

export default function SidebarTabs({
  active,
  onChange,
}: {
  active: "chat" | "query" | "tools" | "history";
  onChange: (t: "chat" | "query" | "tools" | "history") => void;
}) {
  const items: Array<{
    id: "chat" | "query" | "tools" | "history";
    label: string;
    icon: string;
  }> = [
    { id: "chat", label: "Chat", icon: "💬" },
    { id: "query", label: "Query", icon: "🧠" },
    { id: "tools", label: "Tools", icon: "🛠️" },
    { id: "history", label: "History", icon: "💾" },
  ];
  return (
    <nav className="sticky top-4 space-y-2">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={`w-full text-left px-3 py-2 rounded-xl text-sm flex items-center gap-2 border transition ${
            active === it.id
              ? "bg-gradient-to-r from-blue-500/10 to-purple-500/10 text-blue-200 border-blue-500/30"
              : "bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:bg-zinc-900/70"
          }`}
        >
          <span>{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
