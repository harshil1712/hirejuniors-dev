import type { Route } from "./+types/company"
import { database } from "~/database/context";
import * as schema from "~/database/schema";

export async function action({ request }: Route.ActionArgs) {
	const body = await request.json();

	try {
		const company = schema.insertCompany.parse(body);
		const db = database();
		await db.insert(schema.companies).values(company);

		return new Response(JSON.stringify({
			message: `Company "${company.name}" added successfully`,
		}), {
			status: 200,
			headers: {
				"content-type": "application/json",
			},
		});
	} catch (error: any) {
		// Format Zod errors into a cleaner structure
		if (error.issues) {
			const validationErrors = error.issues.map((issue: any) => ({
				field: issue.path.join('.'),
				message: issue.message
			}));

			return new Response(JSON.stringify({
				error: "Validation Error",
				details: validationErrors
			}), {
				status: 400,
				headers: {
					"content-type": "application/json",
				},
			});
		}

		// Handle other types of errors
		return new Response(JSON.stringify({
			error: "Server Error",
			message: error.message
		}), {
			status: 500,
			headers: {
				"content-type": "application/json",
			},
		});
	}
}

export async function loader({ request }: Route.LoaderArgs) {
	const db = database();
	const companies = await db.select().from(schema.companies)

	return new Response(JSON.stringify(companies), {
		status: 200,
		headers: {
			"content-type": "application/json",
		},
	});
}