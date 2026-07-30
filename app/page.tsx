import { redirect } from "next/navigation";
import { getCurrentUser, UnauthenticatedError } from "@/server/auth/current-user";
import { searchSellableProducts } from "@/server/catalog";
import SellWorkspace from "./SellWorkspace";

export default async function Home() {
  let currentUser = null;

  try {
    currentUser = await getCurrentUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/sign-in");
    throw error;
  }

  const initialProducts = await searchSellableProducts(currentUser, "");
  return (
    <SellWorkspace
      cacheKey={`${currentUser.id}:${currentUser.role}`}
      userId={currentUser.id}
      displayName={currentUser.displayName}
      role={currentUser.role}
      initialProducts={initialProducts}
    />
  );
}
