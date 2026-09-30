// Next.js instrumentation hook — starts the durable background scheduler
// exactly once per server process (dev + production).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
