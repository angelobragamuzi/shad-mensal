"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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
          const message = error instanceof Error ? error.message : "Erro ao validar sessao.";
          setErrorMessage(message);
        }
      } finally {
        if (!ignore) {
          setIsCheckingSession(false);
        }
      }
    };

    void checkSession();

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
      <div className="relative min-h-screen overflow-hidden text-[var(--foreground)]">
        <div className="login-bg fixed inset-0 -z-30" />
        <div className="login-fx fixed inset-0 -z-20" />
        <div className="h-screen p-4 md:p-8">
          <div className="surface h-full animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-[var(--foreground)]">
      <div className="login-bg fixed inset-0 -z-30" />
      <div className="login-fx fixed inset-0 -z-20" />

      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      <main className="grid min-h-screen lg:grid-cols-[1.35fr_0.65fr]">
        <section className="flex items-center justify-center border-b border-[var(--border)] px-5 py-12 md:px-10 lg:border-b-0 lg:border-r lg:px-14">
          <div className="h-28 w-[460px] max-w-full overflow-hidden md:h-36 md:w-[620px] lg:h-44 lg:w-[760px]">
            <img src="/manager.svg" alt="Shad Manager" className="h-full w-full object-cover object-left" />
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-8 md:px-8">
          <div className="surface w-full max-w-md p-6 md:p-8">
            <div className="text-left">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted-soft)]">Acesso</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground-strong)]">Entrar no painel</h2>
            </div>

            <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-2 text-left">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-soft)]">
                  Email
                </span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="admin@empresa.com"
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none transition"
                />
              </label>

              <label className="block space-y-2 text-left">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-soft)]">
                  Senha
                </span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="********"
                  className="field glow-focus h-11 w-full rounded-md px-3 text-sm outline-none transition"
                />
              </label>

              {errorMessage ? (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {errorMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? "Entrando..." : "Entrar"}
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
