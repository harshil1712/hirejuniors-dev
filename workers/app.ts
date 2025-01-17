import { drizzle } from "drizzle-orm/d1";
import { createRequestHandler } from "react-router";

import { DatabaseContext } from "~/database/context";
import * as schema from "~/database/schema";

// import { AmazonWorkflow } from "./workflows/amazon";

interface CloudflareEnvironment {
  DB: D1Database;
  AMAZON: Workflow;
  AI: Ai;
}

declare module "react-router" {
  export interface AppLoadContext {
    VALUE_FROM_CLOUDFLARE: string;
  }
}

const requestHandler = createRequestHandler(
  // @ts-expect-error - virtual module provided by React Router at build time
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

// export {
//   AmazonWorkflow
// }

export default {
  fetch(request, env) {
    const db = drizzle(env.DB, { schema });
    return DatabaseContext.run(db, () =>
      requestHandler(request, {
        VALUE_FROM_CLOUDFLARE: "Hello from Cloudflare",
      })
    );
  },
  scheduled(event, env, ctx) {
    console.log("Scheduled event");
    const id = Date.now().toString();
    ctx.waitUntil(env.AMAZON.create({ id }));

  }
} satisfies ExportedHandler<CloudflareEnvironment>;
