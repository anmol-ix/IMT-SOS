import { redirect } from "next/navigation";
import type { Route } from "next";
import BrandMark from "@/components/BrandMark";
import { currentSessionUser, safeReturnPath } from "@/server/auth/session";

type Props = {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo);
  if (await currentSessionUser()) redirect(returnTo as Route);

  return (
    <main className="signed-out">
      <section className="card sign-in-card">
        <BrandMark className="auth-brand" />
        <h1>Welcome back.</h1>
        <p className="lede">
          Use the email and password configured for this internal operations app.
        </p>
        {query.error && (
          <div className="auth-error" role="alert">
            Email or password is incorrect. Please try again.
          </div>
        )}
        <form className="auth-form" action="/api/v1/auth/login" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button" type="submit">Sign in</button>
        </form>
        <p className="auth-help">
          Need access or a new password? Ask the business owner for a setup link.
        </p>
      </section>
    </main>
  );
}
