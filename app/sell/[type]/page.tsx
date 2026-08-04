import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/server/auth/current-user";
import { searchSellableProducts } from "@/server/catalog";
import SellWorkspace from "../../SellWorkspace";

export default async function SellPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (type !== "retail" && type !== "wholesale") notFound();

  const user = await requireCurrentUser();
  const initialProducts = await searchSellableProducts(user, "");
  return (
    <SellWorkspace
      cacheKey={`${user.id}:${user.role}`}
      userId={user.id}
      displayName={user.displayName}
      role={user.role}
      initialProducts={initialProducts}
      initialSaleType={type === "wholesale" ? "WHOLESALE" : "RETAIL"}
      fixedSaleType
    />
  );
}
