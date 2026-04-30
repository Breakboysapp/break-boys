"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteMixerButton({ mixerId }: { mixerId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function onClick() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/mixers/${mixerId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/mixers");
      router.refresh();
    } else {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deleting}
      className={`rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight-2 transition ${
        confirming
          ? "bg-accent text-white"
          : "border border-slate-200 bg-white text-slate-500 hover:border-accent hover:text-accent"
      }`}
    >
      {deleting ? "Deleting…" : confirming ? "Confirm delete" : "Delete mixer"}
    </button>
  );
}
