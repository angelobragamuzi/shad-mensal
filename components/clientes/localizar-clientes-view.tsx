"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, RefreshCcw, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { getUserOrgContext } from "@/lib/supabase/auth-org";

interface LocalizarCliente {
  id: string;
  nome: string;
  telefone: string;
  cep: string;
  numeroResidencia: string;
}

function normalizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatCep(value: string) {
  const digits = normalizeCep(value);
  if (!digits) return "";
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function buildAddressQuery(cliente: LocalizarCliente): string | null {
  const cepDigits = normalizeCep(cliente.cep);
  const number = cliente.numeroResidencia.trim();
  if (cepDigits.length !== 8 || !number) return null;
  return `${formatCep(cepDigits)} ${number}`;
}

export function LocalizarClientesView() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientes, setClientes] = useState<LocalizarCliente[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadClientes = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: context, error: contextError } = await getUserOrgContext(supabase);
      if (contextError || !context) {
        throw new Error(contextError ?? "Falha ao carregar sessão.");
      }

      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, phone, postal_code, address_number")
        .eq("organization_id", context.organizationId)
        .order("full_name", { ascending: true });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as Array<{
        id: string;
        full_name: string;
        phone: string;
        postal_code: string | null;
        address_number: string | null;
      }>;

      setClientes(
        rows.map((row) => ({
          id: row.id,
          nome: row.full_name,
          telefone: row.phone,
          cep: row.postal_code ?? "",
          numeroResidencia: row.address_number ?? "",
        }))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao carregar clientes.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClientes();
  }, [loadClientes]);

  useEffect(() => {
    if (selectedClientId || clientes.length === 0) return;
    const withAddress = clientes.find((cliente) => buildAddressQuery(cliente));
    setSelectedClientId(withAddress?.id ?? clientes[0]?.id ?? null);
  }, [clientes, selectedClientId]);

  const filteredClientes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clientes;

    return clientes.filter((cliente) => {
      return (
        cliente.nome.toLowerCase().includes(term) ||
        cliente.telefone.toLowerCase().includes(term) ||
        formatCep(cliente.cep).includes(term) ||
        cliente.numeroResidencia.toLowerCase().includes(term)
      );
    });
  }, [clientes, search]);

  const selectedCliente = useMemo(
    () => clientes.find((cliente) => cliente.id === selectedClientId) ?? null,
    [clientes, selectedClientId]
  );

  const addressQuery = selectedCliente ? buildAddressQuery(selectedCliente) : null;
  const mapSrc = addressQuery
    ? `https://www.google.com/maps?q=${encodeURIComponent(addressQuery)}&output=embed`
    : "";

  return (
    <section className="animate-fade-up space-y-4">
      <header className="surface rounded-md border-l-2 border-[var(--accent)] px-4 py-6 md:px-6 md:py-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Localização</p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight text-zinc-100 sm:text-4xl">
              Localize clientes com CEP e número.
            </h2>
            <p className="mt-3 text-sm text-zinc-300">
              Selecione um cliente para exibir o endereço no mapa.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadClientes()}
            className="btn-muted inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm"
          >
            <RefreshCcw size={14} />
            Atualizar
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div className="surface rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="surface rounded-md p-4 md:p-5">
          <div className="mb-4 flex flex-col gap-3">
            <div className="relative w-full">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                size={16}
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, telefone, CEP ou número"
                className="field glow-focus h-11 w-full rounded-md pl-9 pr-4 text-sm outline-none"
              />
            </div>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] text-left">
              <thead className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                <tr>
                  <th className="px-3 py-3">Nome</th>
                  <th className="px-3 py-3">Telefone</th>
                  <th className="px-3 py-3">CEP</th>
                  <th className="px-3 py-3">Número</th>
                  <th className="px-3 py-3">Mapa</th>
                </tr>
              </thead>
              <tbody className="text-sm text-zinc-200">
                {isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`localizar-skeleton-${index}`} className="border-t border-white/8">
                        <td className="px-3 py-3"><Skeleton className="h-6 w-36" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-28" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-24" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-16" /></td>
                        <td className="px-3 py-3"><Skeleton className="h-6 w-24" /></td>
                      </tr>
                    ))
                  : filteredClientes.length === 0
                    ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-sm text-zinc-400">
                            Nenhum cliente encontrado para o filtro atual.
                          </td>
                        </tr>
                      )
                    : filteredClientes.map((cliente) => {
                        const address = buildAddressQuery(cliente);
                        const isSelected = cliente.id === selectedClientId;

                        return (
                          <tr
                            key={cliente.id}
                            className={[
                              "border-t border-white/8 transition",
                              isSelected ? "bg-white/5" : "hover:bg-zinc-900/35",
                            ].join(" ")}
                          >
                            <td className="px-3 py-3 font-medium text-zinc-100">{cliente.nome}</td>
                            <td className="px-3 py-3 text-zinc-300">{cliente.telefone}</td>
                            <td className="px-3 py-3 text-zinc-300">{formatCep(cliente.cep) || "-"}</td>
                            <td className="px-3 py-3 text-zinc-300">{cliente.numeroResidencia || "-"}</td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => setSelectedClientId(cliente.id)}
                                disabled={!address}
                                className={[
                                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition",
                                  address
                                    ? "btn-muted hover:border-white/35"
                                    : "cursor-not-allowed border border-white/10 bg-zinc-900/60 text-zinc-500",
                                ].join(" ")}
                              >
                                <MapPin size={14} />
                                {address ? (isSelected ? "Selecionado" : "Ver no mapa") : "Sem endereço"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {isLoading
              ? Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={`localizar-mobile-skeleton-${index}`} className="h-[132px] rounded-md" />
                ))
              : filteredClientes.length === 0
                ? (
                    <p className="surface-soft rounded-md px-4 py-3 text-sm text-zinc-400">
                      Nenhum cliente encontrado para o filtro atual.
                    </p>
                  )
                : filteredClientes.map((cliente) => {
                    const address = buildAddressQuery(cliente);
                    const isSelected = cliente.id === selectedClientId;

                    return (
                      <article
                        key={cliente.id}
                        className={[
                          "surface-soft rounded-md p-3 transition",
                          isSelected ? "border border-white/10" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-zinc-100">{cliente.nome}</p>
                            <p className="mt-1 text-xs text-zinc-500">{cliente.telefone}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedClientId(cliente.id)}
                            disabled={!address}
                            className={[
                              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition",
                              address
                                ? "btn-muted"
                                : "cursor-not-allowed border border-white/10 bg-zinc-900/60 text-zinc-500",
                            ].join(" ")}
                          >
                            <MapPin size={12} />
                            {address ? "Mapa" : "Sem endereço"}
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-zinc-400">
                          CEP: {formatCep(cliente.cep) || "-"} | Nº {cliente.numeroResidencia || "-"}
                        </p>
                      </article>
                    );
                  })}
          </div>
        </section>

        <aside className="surface rounded-md p-4 md:p-5">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Mapa do cliente</p>
          <div className="mt-3">
            {selectedCliente ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-zinc-100">{selectedCliente.nome}</p>
                <p className="text-xs text-zinc-500">
                  {addressQuery
                    ? `CEP ${formatCep(selectedCliente.cep)} · Nº ${selectedCliente.numeroResidencia}`
                    : "Endereço não informado."}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Selecione um cliente para visualizar o mapa.</p>
            )}
          </div>

          <div className="mt-4">
            {addressQuery ? (
              <iframe
                key={mapSrc}
                title={`Mapa de ${selectedCliente?.nome ?? "cliente"}`}
                src={mapSrc}
                loading="lazy"
                className="h-[360px] w-full rounded-md border border-white/10"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            ) : (
              <div className="flex h-[360px] items-center justify-center rounded-md border border-dashed border-white/15 bg-zinc-950/20 px-6 text-center text-sm text-zinc-500">
                Informe CEP e número da residência no cadastro para habilitar o mapa.
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
