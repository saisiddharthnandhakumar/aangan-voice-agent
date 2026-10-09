export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="text-2xl font-semibold">Aangan voice agent</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        The designer and founder dashboard arrives in Phase 6. Service status is at{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
        .
      </p>
    </main>
  );
}
