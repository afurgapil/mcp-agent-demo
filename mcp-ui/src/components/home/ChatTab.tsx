"use client";

import { FormEvent, useRef, useState } from "react";
import { ChatMessage } from "../../types/home";
import { DataTable, DataChart, SavePromptModal } from "..";
import { createPrompt } from "../../services/api";
import { extractRows } from "../../utils/format";
function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
    >
      <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1z" />
      <path d="M20 5H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H10V7h10v14z" />
    </svg>
  );
}

export default function ChatTab({
  query,
  onQueryChange,
  onSubmit,
  loading,
  messages,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  messages: ChatMessage[];
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveDraft, setSaveDraft] = useState<{
    title: string;
    category: string;
    prompt: string;
    sql?: string | null;
    modelOutput?: string | null;
  } | null>(null);
  return (
    <div className="bg-zinc-900/30 backdrop-blur-xl rounded-3xl p-4 md:p-8 border border-zinc-800/50 shadow-2xl">
      <div className="mb-2 text-xs text-zinc-400">Chat</div>
      <style>{`.chat-thread::-webkit-scrollbar{width:8px} .chat-thread::-webkit-scrollbar-track{background:transparent} .chat-thread::-webkit-scrollbar-thumb{background:rgba(100,116,139,0.4);border-radius:9999px} .chat-thread::-webkit-scrollbar-thumb:hover{background:rgba(100,116,139,0.6)}`}</style>
      <div
        className="mb-6 h-[55vh] overflow-y-auto pr-1 chat-thread"
        data-testid="chat-thread"
      >
        <div className="space-y-3">
          {messages.map((m) => {
            const isUser = m.role === "user";
            if (isUser) {
              return (
                <div key={m.id} className="flex justify-end gap-2">
                  <div className="inline-flex items-start max-w-[70%] rounded-2xl px-4 py-2 bg-blue-600/25 border border-blue-500/40 text-blue-100 shadow-sm">
                    <div className="text-right">
                      <div className="whitespace-pre-wrap break-words">
                        {m.content}
                      </div>
                      {m.createdAt ? (
                        <div className="mt-1 text-[10px] text-blue-200/70">
                          {new Date(m.createdAt).toLocaleTimeString()}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-700/50 border border-blue-500/50 flex items-center justify-center text-[11px]">
                    U
                  </div>
                </div>
              );
            }
            const showSql = !!m.sql && m.sql !== m.content;
            const isError =
              typeof m.content === "string" &&
              m.content.toLowerCase().startsWith("error:");
            const rows = extractRows(m.executionResult);
            return (
              <div key={m.id} className="flex justify-start gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-zinc-700/60 border border-zinc-600/60 flex items-center justify-center text-[11px]">
                  A
                </div>
                <div className="max-w-[80%] space-y-2">
                  <div
                    className={`relative inline-flex items-center rounded-xl px-3 py-2 border ${
                      isError
                        ? "bg-red-900/30 border-red-800/60 text-red-100"
                        : "bg-zinc-800/70 border-zinc-700/60 text-zinc-100"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words pr-16">
                      {m.content}
                    </div>
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                      {!isError && (m.sql || m.modelOutput) && (
                        <button
                          type="button"
                          aria-label="Save"
                          className="p-1 rounded bg-transparent text-emerald-100"
                          onClick={() => {
                            setSaveDraft({
                              title: (m.sql || m.modelOutput || "").slice(
                                0,
                                60
                              ),
                              category: "Chat",
                              prompt: m.content,
                              sql: m.sql || null,
                              modelOutput: m.modelOutput || null,
                            });
                            setSaveOpen(true);
                          }}
                        >
                          💾
                        </button>
                      )}
                      {!isError && (
                        <button
                          type="button"
                          aria-label="Copy message"
                          className="p-1 rounded bg-zinc-700/60 hover:bg-zinc-600/60 text-zinc-200"
                          onClick={() =>
                            navigator.clipboard?.writeText(
                              String(m.content || "")
                            )
                          }
                        >
                          <CopyIcon />
                        </button>
                      )}
                    </div>
                  </div>
                  {showSql && (
                    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/70 p-3">
                      <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-400 flex items-center justify-between">
                        <div className="inline-flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700">
                            SQL
                          </span>
                          {m.strategy === "tool" && m.toolCall?.name ? (
                            <span className="text-zinc-500">
                              • {m.toolCall.name}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          aria-label="Copy SQL"
                          className="p-1 rounded bg-zinc-800/70 hover:bg-zinc-700/70 text-zinc-200 border border-zinc-700/60"
                          onClick={() =>
                            navigator.clipboard?.writeText(String(m.sql || ""))
                          }
                        >
                          <CopyIcon />
                        </button>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap break-words bg-zinc-900/40 border border-zinc-800/60 rounded p-2 text-zinc-200">
                        {m.sql}
                      </pre>
                    </div>
                  )}
                  {m.executionResult != null && (
                    <div className="rounded-2xl border border-gray-200/10 bg-zinc-900/60 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[11px] uppercase tracking-wide text-zinc-400">
                          Execution Result
                        </div>
                        <button
                          type="button"
                          aria-label="Copy JSON"
                          className="p-1 rounded bg-zinc-800/70 hover:bg-zinc-700/70 text-zinc-200 border border-zinc-700/60"
                          onClick={() =>
                            navigator.clipboard?.writeText(
                              JSON.stringify(m.executionResult ?? {}, null, 2)
                            )
                          }
                        >
                          <CopyIcon />
                        </button>
                      </div>
                      {rows.length > 0 ? (
                        <div className="space-y-2">
                          <DataTable rows={rows} />
                          <div className="mt-2">
                            <DataChart rows={rows} />
                          </div>
                        </div>
                      ) : (
                        <pre className="text-xs whitespace-pre-wrap break-words bg-zinc-900/40 border border-zinc-800/60 rounded p-2 text-zinc-200">
                          {JSON.stringify(m.executionResult ?? {}, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {loading && (
          <div
            className="flex justify-start gap-2"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-zinc-700/60 border border-zinc-600/60 flex items-center justify-center text-[11px]">
              A
            </div>
            <div className="max-w-[80%]">
              <div className="inline-flex items-center rounded-xl px-3 py-2 border bg-zinc-800/70 border-zinc-700/60 text-zinc-100">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.2s]"></span>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.1s]"></span>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce"></span>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
        <textarea
          className="w-full h-28 rounded-2xl border border-zinc-700/50 bg-zinc-800/50 backdrop-blur-sm text-zinc-100 placeholder:text-zinc-500 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 shadow-xl transition-all duration-300"
          placeholder="Write your message..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          data-testid="prompt-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!loading && query.trim()) {
                try {
                  formRef.current?.requestSubmit();
                } catch {}
              }
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xs font-medium disabled:opacity-60 shadow-md hover:shadow-lg hover:scale-105 transition-all duration-300 transform disabled:hover:scale-100"
            disabled={loading || !query.trim()}
            data-testid="submit-button"
          >
            Send message
          </button>
        </div>
      </form>
      {/* All outputs are rendered as assistant messages above; no external panels while chat is active */}

      <SavePromptModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={async ({ title, category }) => {
          if (!saveDraft) return;
          try {
            await createPrompt({
              title,
              category,
              prompt: saveDraft.prompt,
              sql: saveDraft.sql || null,
              modelOutput: saveDraft.modelOutput || null,
            });
          } finally {
            setSaveOpen(false);
            setSaveDraft(null);
          }
        }}
        initialTitle={saveDraft?.title || ""}
        initialCategory={saveDraft?.category || "General"}
      />
    </div>
  );
}
