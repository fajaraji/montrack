import { createApp, type Bindings } from "./app";
import { createDb } from "./db/client";
import { dailyChecks, pokeAll, weeklyRecapNotification } from "./services/push";

const app = createApp((env) => createDb(env.DATABASE_URL));

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  /** Cron (UTC): "0 13 * * *" = 20.00 WIB setiap hari; "0 1 * * 1" = Senin 08.00 WIB. */
  async scheduled(event, env, ctx) {
    const db = createDb(env.DATABASE_URL);
    const run = async () => {
      let created = 0;
      if (event.cron === "0 1 * * 1") created += (await weeklyRecapNotification(db)) ? 1 : 0;
      else created += await dailyChecks(db);
      if (created > 0) await pokeAll(db, env);
    };
    ctx.waitUntil(run());
  },
} satisfies ExportedHandler<Bindings>;
