import { createApp, type Bindings } from "./app";
import { createDb } from "./db/client";

const app = createApp((env) => createDb(env.DATABASE_URL));

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
