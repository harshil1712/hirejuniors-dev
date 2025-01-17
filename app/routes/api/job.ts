import type { Route } from "./+types/job"
import { database } from "~/database/context";
import * as schema from "~/database/schema";

export async function loader({ request }: Route.LoaderArgs) {
	const db = database();
	const jobs = await db.select().from(schema.jobs)

	return new Response(JSON.stringify(jobs), {
		status: 200,
		headers: {
			"content-type": "application/json",
		},
	});
}