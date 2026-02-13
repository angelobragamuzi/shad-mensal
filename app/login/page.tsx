"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-4 py-12">
          <div className="h-60 w-full animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-zinc-100">
      <div className="app-bg fixed inset-0 -z-20" />

      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-12">
        <div className="h-40 w-[700px] max-w-full overflow-hidden sm:h-52 sm:w-[900px]">
          <img
            src="/manager.svg"
            alt="Shad Manager"
            className="h-full w-full object-cover object-left"
          />
        </div>

        <section className="mt-1 w-full rounded-2xl border-l-4 border-amber-400/60 p-6 pl-5 sm:p-8 sm:pl-7 surface">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-xl font-semibold text-white sm:text-2xl">Entrar</h1>
            <p className="mt-1 text-sm text-zinc-400">Acesso ao painel.</p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-2 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Email
              </span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                required
                placeholder="admin@empresa.com"
                className="field glow-focus h-11 w-full rounded-lg px-3 text-base outline-none transition"
              />
            </label>

            <label className="block space-y-2 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Senha
              </span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                required
                placeholder="********"
                className="field glow-focus h-11 w-full rounded-lg px-3 text-base outline-none transition"
              />
            </label>

            {errorMessage ? (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {errorMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
