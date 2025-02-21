import type { Route } from "./+types/company"
import * as schema from "../../../database/schema";
import { eq } from "drizzle-orm";

export async function action({ request, context }: Route.ActionArgs) {
	// Get the auth header
	const authHeader = request.headers.get("authorization");
	if (!authHeader) {
		return new Response(JSON.stringify({
			error: "Unauthorized",
			message: "Authorization header is required"
		}), {
			status: 401,
			headers: {
				"content-type": "application/json",
			},
		});
	}

	// Validate the token
	const token = authHeader.replace("Bearer ", "");
	const isValid = context.cloudflare.env.AUTH_TOKEN === token;
	if (!isValid) {
		return new Response(JSON.stringify({
			error: "Unauthorized",
			message: "Invalid token"
		}), {
			status: 401,
			headers: {
				"content-type": "application/json",
			},
		});
	}

	const body = await request.json();

	try {
		const company = schema.insertCompany.parse(body);
		const db = context.db;
		const existingCompany = await db.select().from(schema.companies).where(eq(schema.companies.name, company.name));
		if (existingCompany.length > 0) {
			return new Response(JSON.stringify({
				error: "Company already exists",
				message: `Company "${company.name}" already exists`,
			}), {
				status: 400,
				headers: {
					"content-type": "application/json",
				},
			});
		}


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

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.db;
	const companies = await db.select().from(schema.companies)

	return new Response(JSON.stringify(companies), {
		status: 200,
		headers: {
			"content-type": "application/json",
		},
	});
}