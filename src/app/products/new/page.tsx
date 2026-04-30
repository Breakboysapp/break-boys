import Link from "next/link";
import NewProductForm from "./NewProductForm";

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <Link
          href="/"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          ← All products
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight-3">
          New Product
        </h1>
      </div>
      <NewProductForm />
    </div>
  );
}
