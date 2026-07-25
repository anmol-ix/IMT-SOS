import { withAuth } from "@workos-inc/authkit-nextjs";
import { getCurrentUser } from "@/server/auth/current-user";
import { searchSellableProducts } from "@/server/catalog";
import SellWorkspace from "./SellWorkspace";

export default async function Home() {
  const session = await withAuth();
  const currentUser = session.user ? await getCurrentUser() : null;

  if (currentUser) {
    const initialProducts = await searchSellableProducts(currentUser, "");
    return (
      <SellWorkspace
        displayName={currentUser.displayName}
        role={currentUser.role}
        initialProducts={initialProducts}
      />
    );
  }

  return (
    <main className="signed-out">
      <section className="card sign-in-card">
        <p className="eyebrow">ItsMyToy Operations</p>
        <h1>Sell toys without calling the owner.</h1>
        <p className="lede">
          Scan a product, see the available stock and give only the discount your role permits.
        </p>
        <div className="status" aria-label="Foundation status">
          <span className="dot" aria-hidden="true" />
          <span>Application online</span>
        </div>
        <a className="button" href="/sign-in">Sign in to start selling</a>
      </section>
    </main>
  );
}
