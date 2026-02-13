"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, Menu, UsersRound, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

interface AppShellProps {
  children: ReactNode;
}

type MenuItem = {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number }>;
};

const menuItems: MenuItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Alunos", href: "/alunos", icon: UsersRound },
];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    let ignore = false;
    const supabase = getSupabaseBrowserClient();

    const validateSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!ignore && !session) {
          router.replace("/login");
          return;
        }

        if (!ignore && session?.user.email) {
          setUserEmail(session.user.email);
        }
      } finally {
        if (!ignore) {
          setIsAuthChecking(false);
        }
      }
    };

    validateSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setUserEmail(session.user.email ?? "");
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  const userName = useMemo(() => {
    if (!userEmail) return "Conta";
    return userEmail.split("@")[0];
  }, [userEmail]);

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.replace("/login");
    } finally {
      setLogoutLoading(false);
    }
  };

  if (isAuthChecking) {
    return (
      <div className="relative min-h-screen text-zinc-100">
        <div className="app-bg fixed inset-0 -z-20" />
        <div className="px-3 pt-4 md:px-4">
          <div className="surface h-64 animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen text-zinc-100">
      <div className="app-bg fixed inset-0 -z-20" />

      <div className="min-h-screen md:pl-[250px]">
        <aside className="surface hidden border-r border-white/10 md:fixed md:inset-y-4 md:left-4 md:flex md:w-[230px] md:flex-col md:rounded-2xl md:p-4">
          <div className="mb-6">
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">ShadSolutions</p>
            <h1 className="mt-2 text-xl font-semibold text-zinc-100">ShadMensal</h1>
          </div>

          <nav className="grid gap-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={[
                    "inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition",
                    isActive
                      ? "border-white/30 bg-white/10 text-zinc-100"
                      : "border-transparent text-zinc-400 hover:border-white/15 hover:bg-white/5 hover:text-zinc-100",
                  ].join(" ")}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-white/10 pt-4">
            <p className="text-xs text-zinc-500">Usuário</p>
            <p className="mt-1 truncate text-sm font-medium text-zinc-200">{userName}</p>
            <button
              type="button"
              onClick={handleLogout}
              disabled={logoutLoading}
              className="btn-muted mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LogOut size={15} />
              {logoutLoading ? "Saindo..." : "Sair"}
            </button>
          </div>
        </aside>

        <header className="surface sticky top-0 z-30 m-3 flex items-center justify-between rounded-2xl px-3 py-2 md:hidden">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">ShadSolutions</p>
            <p className="text-sm font-semibold text-zinc-100">ShadMensal</p>
          </div>
          <button
            type="button"
            onClick={() => setIsMenuOpen((value) => !value)}
            className="btn-muted rounded-lg p-2"
            aria-label="Abrir menu"
          >
            {isMenuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </header>

        {isMenuOpen ? (
          <div className="surface mx-3 mb-3 grid gap-2 rounded-2xl p-3 md:hidden">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={[
                    "inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition",
                    isActive
                      ? "border-white/30 bg-white/10 text-zinc-100"
                      : "border-transparent text-zinc-400 hover:border-white/15 hover:bg-white/5 hover:text-zinc-100",
                  ].join(" ")}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={handleLogout}
              disabled={logoutLoading}
              className="btn-muted mt-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LogOut size={15} />
              {logoutLoading ? "Saindo..." : "Sair"}
            </button>
          </div>
        ) : null}

        <main className="px-3 pb-4 md:px-4 md:pb-5 md:pt-4">{children}</main>
      </div>
    </div>
  );
}
