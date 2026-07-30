import { redirect } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { currentSessionUser } from "@/server/auth/session";

type Props = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function ActivatePage({ searchParams }: Props) {
  const query = await searchParams;
  if (await currentSessionUser()) redirect("/");
  const token = query.token?.trim() ?? "";

  return (
    <main className="signed-out">
      <section className="card sign-in-card">
        <BrandMark className="auth-brand" />
        <p className="eyebrow">Private account setup</p>
        <h1>Create your password.</h1>
        <p className="lede">
          This one-time link activates your ItsMyToy Operations account.
        </p>
        {(!token || query.error) && (
          <div className="auth-error" role="alert">
            {!token
              ? "This setup link is incomplete."
              : query.error === "mismatch"
                ? "The two passwords do not match."
                : query.error === "password"
                  ? "Use a password with at least 12 characters."
                  : "This setup link is invalid, expired, or already used."}
          </div>
        )}
        {token && (
          <form className="auth-form" action="/api/v1/auth/activate" method="post">
            <input type="hidden" name="token" value={token} />
            <input
              type="text"
              name="username"
              value=""
              autoComplete="username"
              readOnly
              hidden
            />
            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirm password
              <input
                name="confirmPassword"
                type="password"
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
                required
              />
            </label>
            <button className="button" type="submit">Activate account</button>
          </form>
        )}
      </section>
    </main>
  );
}
