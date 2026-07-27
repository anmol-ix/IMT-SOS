import { withAuth } from "@workos-inc/authkit-nextjs";
import {
  AccessNotApprovedError,
  getCurrentUser,
} from "@/server/auth/current-user";
import { searchSellableProducts } from "@/server/catalog";
import SellWorkspace from "./SellWorkspace";

export default async function Home() {
  const session = await withAuth();
  let currentUser = null;

  if (session.user) {
    try {
      currentUser = await getCurrentUser();
    } catch (error) {
      if (error instanceof AccessNotApprovedError) {
        return (
          <main className="signed-out">
            <section className="card access-card">
              <p className="eyebrow">Sign-in successful</p>
              <h1>This email does not have access yet.</h1>
              <p className="lede">
                You signed in as <strong>{error.email}</strong>. Ask the business
                owner to invite this exact email from Team &amp; Access.
              </p>
              <div className="access-state" role="status">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Your Google sign-in is working</strong>
                  <small>No Railway or database setup is needed for this user.</small>
                </div>
              </div>
              <a className="button secondary-button" href="/sign-out">
                Sign out and use another email
              </a>
            </section>
          </main>
        );
      }
      throw error;
    }
  }

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
          <span>Application ready</span>
        </div>
        <a className="button" href="/sign-in">Sign in to start selling</a>
      </section>
    </main>
  );
}
