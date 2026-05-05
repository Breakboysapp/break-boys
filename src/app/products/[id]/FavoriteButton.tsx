"use client";

/**
 * Heart-toggle button for favoriting / unfavoriting a product. Shown
 * top-right of the product hero.
 *
 * Optimistic: flips the icon immediately, fires the request in the
 * background. If the request fails, reverts. Smaller flicker than
 * waiting for the round-trip.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function FavoriteButton({
  productId,
  initialFavorited,
}: {
  productId: string;
  initialFavorited: boolean;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, setPending] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // The button sits inside a card-y product hero; click should not
    // bubble up to any parent link if one ever wraps it.
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !favorited;
    setFavorited(next);
    setPending(true);
    try {
      const res = await fetch(`/api/products/${productId}/favorite`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        // Revert on error so the UI doesn't lie about the saved state.
        setFavorited(!next);
      } else {
        // Refresh server components so the /favorites page count + the
        // nav badge reflect the change without a hard reload.
        router.refresh();
      }
    } catch {
      setFavorited(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={favorited}
      title={favorited ? "Remove from favorites" : "Add to favorites"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition ${
        favorited
          ? "border-accent bg-accent text-white hover:opacity-90"
          : "border-slate-200 bg-white text-slate-400 hover:border-accent hover:text-accent"
      } ${pending ? "opacity-70" : ""}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill={favorited ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
      </svg>
    </button>
  );
}
