import BrandMark from "@/components/BrandMark";

export default function SignOutPage() {
  return (
    <main className="signed-out">
      <section className="card sign-in-card">
        <BrandMark className="auth-brand" />
        <h1>Sign out?</h1>
        <p className="lede">This will end the session on this device only.</p>
        <form action="/api/v1/auth/logout" method="post">
          <button className="button" type="submit">Sign out</button>
        </form>
      </section>
    </main>
  );
}
