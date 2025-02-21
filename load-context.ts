import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./database/schema";
import type { ExecutionContext } from "@cloudflare/workers-types";
import type { AppLoadContext } from "react-router";


declare global {
	interface CloudflareEnvironment extends Env { }
}

declare module "react-router" {
	// eslint-disable-next-line @typescript-eslint/no-empty-interface
	interface AppLoadContext {
		cloudflare: {
			env: Env;
			caches: CacheStorage;
			cf: Request["cf"];
			ctx: ExecutionContext;
		};
		db: DrizzleD1Database<typeof schema>;
	}
}

type GetLoadContextArgs = {
	request: Request;
	context: Pick<AppLoadContext, "cloudflare">;
};

export function getLoadContext({ context }: GetLoadContextArgs) {
	const db = drizzle(context.cloudflare.env.DB, { schema });
	return {
		cloudflare: context.cloudflare,
		db
	};
}