"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    const checkSession = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!ignore && session) {
          router.replace("/dashboard");
          return;
        }
      } catch (error) {
        if (!ignore) {
          const message = error instanceof Error ? error.message : "Erro ao validar sessão.";
          setErrorMessage(message);
        }
      } finally {
        if (!ignore) {
          setIsCheckingSession(false);
        }
      }
    };

    checkSession();

    return () => {
      ignore = true;
    };
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      router.replace("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao autenticar.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="relative min-h-screen overflow-hidden text-zinc-100">
        <div className="app-bg fixed inset-0 -z-20" />
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-3">
          <div className="surface h-80 w-full animate-pulse rounded-3xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-zinc-100">
      <div className="app-bg fixed inset-0 -z-20" />

      <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-3 py-8">
        <section className="surface animate-scale-in w-full rounded-3xl p-7 sm:p-9">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 h-10 w-10 rounded-lg border border-white/25 bg-white/10" />
            <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">ShadSolutions</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">ShadMensal</h1>
            <p className="mt-2 text-sm text-zinc-400">Acesse sua conta para continuar.</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm text-zinc-300">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                placeholder="admin@empresa.com"
                className="field glow-focus h-12 w-full rounded-xl px-4 text-zinc-100 outline-none"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-zinc-300">Senha</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                required
                placeholder="********"
                className="field glow-focus h-12 w-full rounded-xl px-4 text-zinc-100 outline-none"
              />
            </label>

            {errorMessage ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {errorMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
              <ArrowRight size={16} />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
