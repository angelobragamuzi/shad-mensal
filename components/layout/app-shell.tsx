"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  UsersRound,
  X,
} from "lucide-react";
import {
  BRANDING_CHANGE_EVENT,
  type BrandingChangeDetail,
  buildBrandCssVariables,
  DEFAULT_SITE_ACCENT_COLOR,
  normalizeHexColor,
} from "@/lib/shad-manager/branding";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";

interface AppShellProps {
  children: ReactNode;
}

type MenuItem = {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number }>;
};

interface SiteBrandingRow {
  site_logo_url: string | null;
  site_accent_color: string | null;
}

const menuItems: MenuItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Clientes", href: "/clientes", icon: UsersRound },
  { label: "Calendário", href: "/calendario", icon: CalendarDays },
  { label: "Organização", href: "/organizacao", icon: Building2 },
  { label: "Cobranças", href: "/cobrancas", icon: QrCode },
];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandAccentColor, setBrandAccentColor] = useState(DEFAULT_SITE_ACCENT_COLOR);
  const [isBrandingSupported, setIsBrandingSupported] = useState(true);
  const [logoLoadError, setLogoLoadError] = useState(false);

  const loadSiteBranding = useCallback(
    async (organizationId: string, supabase = getSupabaseBrowserClient()) => {
      const { data, error } = await supabase
        .from("organization_settings")
        .select("site_logo_url, site_accent_color")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) {
        const normalizedMessage = error.message.toLowerCase();
        const missingLogoColumn =
          normalizedMessage.includes("site_logo_url") && normalizedMessage.includes("does not exist");
        const missingAccentColumn =
          normalizedMessage.includes("site_accent_color") &&
          normalizedMessage.includes("does not exist");

        if (missingLogoColumn || missingAccentColumn) {
          setIsBrandingSupported(false);
          setBrandLogoUrl("");
          setBrandAccentColor(DEFAULT_SITE_ACCENT_COLOR);
          return;
        }

        throw new Error(error.message);
      }

      const branding = data as SiteBrandingRow | null;
      setIsBrandingSupported(true);
      setBrandLogoUrl(branding?.site_logo_url?.trim() ?? "");
      setBrandAccentColor(normalizeHexColor(branding?.site_accent_color));
    },
    []
  );

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

        const { data: orgContext, error: orgError } = await getUserOrgContext(supabase);
        if (!ignore && (orgError || !orgContext)) {
          router.replace("/onboarding");
          return;
        }

        if (!ignore && orgContext) {
          try {
            await loadSiteBranding(orgContext.organizationId, supabase);
          } catch {
            if (!ignore) {
              setIsBrandingSupported(false);
              setBrandLogoUrl("");
              setBrandAccentColor(DEFAULT_SITE_ACCENT_COLOR);
            }
          }
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
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setUserEmail(session.user.email ?? "");
      const { data: orgContext } = await getUserOrgContext(supabase);
      if (!orgContext) {
        router.replace("/onboarding");
        return;
      }
      try {
        await loadSiteBranding(orgContext.organizationId, supabase);
      } catch {
        setIsBrandingSupported(false);
        setBrandLogoUrl("");
        setBrandAccentColor(DEFAULT_SITE_ACCENT_COLOR);
      }
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, [loadSiteBranding, router]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setLogoLoadError(false);
  }, [brandLogoUrl]);

  useEffect(() => {
    const onBrandingChange = (event: Event) => {
      const detail = (event as CustomEvent<BrandingChangeDetail>).detail;
      if (!detail) return;
      setIsBrandingSupported(true);
      setBrandLogoUrl(detail.logoUrl?.trim() ?? "");
      setBrandAccentColor(normalizeHexColor(detail.accentColor));
    };

    window.addEventListener(BRANDING_CHANGE_EVENT, onBrandingChange);
    return () => {
      window.removeEventListener(BRANDING_CHANGE_EVENT, onBrandingChange);
    };
  }, []);

  const userName = useMemo(() => {
    if (!userEmail) return "Conta";
    return userEmail.split("@")[0];
  }, [userEmail]);

  const currentSection = useMemo(
    () => menuItems.find((item) => pathname === item.href)?.label ?? "Painel",
    [pathname]
  );

  const shellStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isBrandingSupported) return undefined;
    return buildBrandCssVariables(brandAccentColor) as CSSProperties;
  }, [brandAccentColor, isBrandingSupported]);

  const resolvedLogoSrc = useMemo(
    () => (!logoLoadError && brandLogoUrl ? brandLogoUrl : "/manager.svg"),
    [brandLogoUrl, logoLoadError]
  );
  const isDefaultLogo = resolvedLogoSrc === "/manager.svg";

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
    <div className="relative min-h-screen text-[var(--foreground)]" style={shellStyle}>
      <div className="app-bg fixed inset-0 -z-20" />

      <aside className="surface fixed inset-y-0 left-0 z-40 hidden w-64 border-r md:flex md:flex-col md:rounded-none md:border-l-0 md:border-t-0 md:border-b-0 md:shadow-none">
        <div className="border-b border-[var(--border)] px-6 py-5">
          <div
            className={
              isDefaultLogo
                ? "h-12 w-[200px] overflow-hidden"
                : "flex min-h-[56px] w-full items-center justify-center"
            }
          >
            <img
              src={resolvedLogoSrc}
              alt="Shad Manager"
              className={
                isDefaultLogo
                  ? "h-full w-full object-cover object-left"
                  : "max-h-[56px] w-full max-w-[200px] object-contain object-center"
              }
              onError={() => setLogoLoadError(true)}
            />
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
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-soft)]">Usuário</p>
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
          <div
            className={
              isDefaultLogo
                ? "h-10 w-[165px] overflow-hidden"
                : "flex h-10 w-full max-w-[165px] items-center justify-center"
            }
          >
            <img
              src={resolvedLogoSrc}
              alt="Shad Manager"
              className={
                isDefaultLogo
                  ? "h-full w-full object-cover object-left"
                  : "max-h-10 w-full object-contain object-center"
              }
              onError={() => setLogoLoadError(true)}
            />
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

