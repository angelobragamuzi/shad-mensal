"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function OnboardingPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    const validateSession = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!ignore && !session) {
          router.replace("/login");
          return;
        }

        if (!ignore && session) {
          const { data: orgContext } = await getUserOrgContext(supabase);
          if (orgContext) {
            router.replace("/dashboard");
            return;
          }
        }
      } catch (error) {
        if (!ignore) {
          const message = error instanceof Error ? error.message : "Erro ao validar sessao.";
          setErrorMessage(message);
        }
      } finally {
        if (!ignore) {
          setIsChecking(false);
        }
      }
    };

    validateSession();

    return () => {
      ignore = true;
    };
  }, [router]);

  const suggestedSlug = useMemo(() => slugify(name), [name]);
  const slugIsValid = useMemo(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), [slug]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage("Informe o nome da organizacao.");
      return;
    }

    if (!slugIsValid) {
      setErrorMessage("Slug invalido. Use apenas letras, numeros e hifen.");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("create_organization", {
        p_name: name.trim(),
        p_slug: slug.trim(),
      });

      if (error) {
        throw new Error(error.message);
      }

      router.replace("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao criar organizacao.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!slugTouched) {
      setSlug(suggestedSlug);
    }
  }, [slugTouched, suggestedSlug]);

  if (isChecking) {
    return (
      <div className="relative min-h-screen overflow-hidden text-zinc-100">
        <div className="app-bg fixed inset-0 -z-20" />
        <div className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4 py-12">
          <div className="h-72 w-full animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-zinc-100">
      <div className="app-bg fixed inset-0 -z-20" />

      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-4 py-12">
        <div className="h-36 w-[680px] max-w-full overflow-hidden sm:h-44 sm:w-[820px]">
          <img
            src="/manager.svg"
            alt="Shad Manager"
            className="h-full w-full object-cover object-left"
          />
        </div>

        <section className="mt-2 w-full rounded-2xl border-l-4 border-amber-400/60 p-6 pl-5 sm:p-8 sm:pl-7 surface">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-xl font-semibold text-white sm:text-2xl">Crie sua organizacao</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Configure o espaco de trabalho antes de acessar o painel.
            </p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-2 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Nome
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                placeholder="ShadSolutions"
                className="field glow-focus h-11 w-full rounded-lg px-3 text-base outline-none transition"
              />
            </label>

            <label className="block space-y-2 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Slug
              </span>
              <input
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
                required
                placeholder="shadsolutions"
                className="field glow-focus h-11 w-full rounded-lg px-3 text-base outline-none transition"
              />
              <p className="text-xs text-zinc-500">
                Usado no seu ambiente interno. Ex.: {suggestedSlug || "sua-empresa"}
              </p>
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
              {isSubmitting ? "Criando..." : "Criar organizacao"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
