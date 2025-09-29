"use client";

import { useState } from "react";
import { login, getToken } from "../../../src/services/api";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("E-posta ve şifre gerekli");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      if (getToken()) {
        router.replace("/");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Giriş başarısız";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-black to-zinc-900 text-white p-6">
      <div className="w-full max-w-sm bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-6 shadow-xl">
        <h1 className="text-2xl font-semibold mb-6">Giriş Yap</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">E-posta</label>
            <input
              type="email"
              className="w-full px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@firma.com"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Şifre</label>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="text-red-400 text-sm" role="alert">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition disabled:opacity-60"
          >
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>
      </div>
    </div>
  );
}
