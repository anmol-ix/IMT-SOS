export default function SignOutPage() {
  return (
    <main className="signed-out">
      <section className="card sign-in-card">
        <p className="eyebrow">ItsMyToy Operations</p>
        <h1>Sign out?</h1>
        <p className="lede">This will end the session on this device only.</p>
        <form action="/api/v1/auth/logout" method="post">
          <button className="button" type="submit">Sign out</button>
        </form>
      </section>
    </main>
  );
}
