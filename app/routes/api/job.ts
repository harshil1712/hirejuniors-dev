import type { Route } from "./+types/job"
import * as schema from "../../../database/schema";

export async function loader({ request, context }: Route.LoaderArgs) {
	console.log('INSIDE LOADER')
	const db = context.db;
	const jobs = await db.select().from(schema.jobs)

	return new Response(JSON.stringify(jobs), {
		status: 200,
		headers: {
			"content-type": "application/json",
		},
	});
}