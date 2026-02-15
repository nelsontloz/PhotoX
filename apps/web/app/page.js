import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell py-10">
      <section className="panel p-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ocean-500">Phase P2</p>
        <h1 className="mb-3 text-3xl font-black tracking-tight text-ocean-900">Web auth and upload UI is live</h1>
        <p className="max-w-2xl text-[15px] leading-7 text-ocean-700">
          Register, login, and upload photos with resumable chunked transfer against the ingest API. Errors are
          surfaced with API codes so failures are actionable.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/register" className="btn btn-primary">
            Create account
          </Link>
          <Link href="/login" className="btn btn-secondary">
            Sign in
          </Link>
          <Link href="/upload" className="btn btn-secondary">
            Go to upload
          </Link>
        </div>
      </section>
    </main>
  );
}
