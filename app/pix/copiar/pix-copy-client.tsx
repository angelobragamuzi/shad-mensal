"use client";

import { useState } from "react";

type CopyStatus = "idle" | "success" | "error";

async function copyPixCode(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Copiar nao suportado.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Nao foi possivel copiar.");
  }
}

interface PixCopyClientProps {
  initialCode: string;
}

export default function PixCopyClient({ initialCode }: PixCopyClientProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const pixCode = initialCode.trim();
  const canCopy = pixCode.length > 0;

  const handleCopyClick = async () => {
    if (!canCopy) return;
    try {
      await copyPixCode(pixCode);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl shadow-black/30">
        <h1 className="text-xl font-semibold">Copiar PIX</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Use o botao abaixo para copiar o codigo PIX da cobranca.
        </p>

        {!canCopy ? (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Codigo PIX nao encontrado no link.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void handleCopyClick()}
          disabled={!canCopy}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Copiar codigo PIX
        </button>

        {copyStatus === "success" ? (
          <p className="mt-3 text-sm text-emerald-300">Codigo copiado.</p>
        ) : null}
        {copyStatus === "error" ? (
          <p className="mt-3 text-sm text-rose-300">Nao foi possivel copiar automaticamente.</p>
        ) : null}

        <label className="mt-5 block">
          <span className="mb-2 block text-sm text-zinc-300">PIX copia e cola</span>
          <textarea
            readOnly
            value={pixCode}
            rows={6}
            className="w-full resize-y rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs leading-relaxed text-zinc-100 outline-none"
          />
        </label>
      </section>
    </main>
  );
}
