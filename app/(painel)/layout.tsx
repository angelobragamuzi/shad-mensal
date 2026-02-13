import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

interface PainelLayoutProps {
  children: ReactNode;
}

export default function PainelLayout({ children }: PainelLayoutProps) {
  return <AppShell>{children}</AppShell>;
}
