"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, LayoutDashboard, LogOut, Menu, UsersRound, X } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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
  { label: "Clientes", href: "/clientes", icon: UsersRound },
  { label: "Calendario", href: "/calendario", icon: CalendarDays },
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

    void validateSession();

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

  const currentSection = useMemo(
    () => menuItems.find((item) => pathname === item.href)?.label ?? "Painel",
    [pathname]
  );

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
      <div className="relative min-h-screen text-[var(--foreground)]">
        <div className="app-bg fixed inset-0 -z-20" />
        <div className="h-screen p-4 md:p-6">
          <div className="surface h-full animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen text-[var(--foreground)]">
      <div className="app-bg fixed inset-0 -z-20" />

      <aside className="surface fixed inset-y-0 left-0 z-40 hidden w-64 border-r md:flex md:flex-col md:rounded-none md:border-l-0 md:border-t-0 md:border-b-0 md:shadow-none">
        <div className="border-b border-[var(--border)] px-6 py-5">
          <div className="h-12 w-[200px] overflow-hidden">
            <img src="/manager.svg" alt="Shad Manager" className="h-full w-full object-cover object-left" />
          </div>
          <h1 className="sr-only">Shad Manager</h1>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={[
                  "inline-flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition",
                  isActive
                    ? "border-[var(--accent)] bg-[var(--card-soft)] text-[var(--foreground-strong)]"
                    : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--card-soft)] hover:text-[var(--foreground)]",
                ].join(" ")}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--border)] px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-soft)]">Usuario</p>
              <p className="truncate text-sm font-medium text-[var(--foreground)]">{userName}</p>
            </div>
            <ThemeToggle compact />
          </div>

          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="btn-muted inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            <LogOut size={15} />
            {logoutLoading ? "Saindo..." : "Sair"}
          </button>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-3 backdrop-blur md:hidden">
          <div className="h-10 w-[165px] overflow-hidden">
            <img src="/manager.svg" alt="Shad Manager" className="h-full w-full object-cover object-left" />
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <button
              type="button"
              onClick={() => setIsMenuOpen((value) => !value)}
              className="btn-muted inline-flex h-9 w-9 items-center justify-center rounded-md"
              aria-label="Abrir menu"
            >
              {isMenuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </header>

        {isMenuOpen ? (
          <div className="surface mx-3 mt-3 grid gap-2 rounded-md p-3 md:hidden">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={[
                    "inline-flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition",
                    isActive
                      ? "border-[var(--accent)] bg-[var(--card-soft)] text-[var(--foreground)]"
                      : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--card-soft)] hover:text-[var(--foreground)]",
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
              className="btn-muted mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LogOut size={15} />
              {logoutLoading ? "Saindo..." : "Sair"}
            </button>
          </div>
        ) : null}

        <header className="sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-8 backdrop-blur md:flex">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted-soft)]">Painel</p>
            <h2 className="text-base font-semibold text-[var(--foreground-strong)]">{currentSection}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="max-w-[220px] truncate text-sm text-[var(--muted)]">{userEmail}</span>
            <ThemeToggle />
          </div>
        </header>

        <main className="px-3 py-4 md:px-8 md:py-6">{children}</main>
      </div>
    </div>
  );
}
