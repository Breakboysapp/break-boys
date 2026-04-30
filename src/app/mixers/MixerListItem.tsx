"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MixerListItem({
  id,
  name,
  breakerHandle,
  productCount,
  totalCards,
  productNames,
}: {
  id: string;
  name: string;
  breakerHandle: string | null;
  productCount: number;
  totalCards: number;
  productNames: string[];
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      // Auto-cancel the confirm state after 4s if they don't click again
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/mixers/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <li>
      <div className="group relative h-full rounded-xl border border-slate-200 bg-white p-5 transition hover:border-ink hover:shadow-lg">
        {/* Delete button — top-right corner, doesn't trigger the wrapping link */}
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className={`absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tight-2 transition ${
            confirming
              ? "bg-accent text-white"
              : "border border-slate-200 bg-white text-slate-400 opacity-0 hover:border-accent hover:text-accent group-hover:opacity-100"
          }`}
          aria-label="Delete mixer"
        >
          {deleting ? "…" : confirming ? "Confirm delete" : "Delete"}
        </button>

        <Link href={`/mixers/${id}`} className="block">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
            <span>Mixer</span>
            {breakerHandle && (
              <>
                <span aria-hidden className="text-slate-400">
                  ·
                </span>
                <span>@{breakerHandle}</span>
              </>
            )}
          </div>
          <div className="pr-16 text-base font-bold leading-tight tracking-tight-2">
            {name}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {productNames.map((pn) => (
              <span
                key={pn}
                className="rounded bg-bone px-2 py-0.5 text-[10px] font-semibold text-slate-700"
              >
                {pn}
              </span>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>
              {productCount} products · {totalCards} cards
            </span>
            <span className="font-semibold text-ink group-hover:text-accent">
              Open →
            </span>
          </div>
        </Link>
      </div>
    </li>
  );
}
