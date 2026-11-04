import { createApp, type Bindings } from "./app";
import { createDb } from "./db/client";
import { runRecurringFees } from "./services/fees";

const app = createApp((env) => createDb(env.DATABASE_URL));

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  /** Cron harian (00.05 WIB): catat biaya rutin yang jatuh tempo. */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runRecurringFees(createDb(env.DATABASE_URL)).then(() => undefined));
  },
} satisfies ExportedHandler<Bindings>;
