import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from "cloudflare:workers";
import { drizzle } from 'drizzle-orm/d1';
import * as schema from "../../database/schema";
import { z } from 'zod';
import { getCountryCode } from "utils/countryCode";
import { eq } from 'drizzle-orm';

const locationSchema = z.object({
	name: z.string(),
});

const metadataSchema = z.object({
	id: z.number(),
	name: z.string(),
	value: z.union([z.string(), z.array(z.string()), z.null()]),
	value_type: z.string(),
});

const greenhouseJobSchema = z.object({
	absolute_url: z.string().url(),
	internal_job_id: z.number(),
	location: locationSchema,
	metadata: z.array(metadataSchema),
	id: z.number(),
	updated_at: z.string(),
	title: z.string(),
	company_name: z.string(),
});

const greenhouseApiResponseSchema = z.object({
	jobs: z.array(greenhouseJobSchema)
});

export class CloudflareWorkflow extends WorkflowEntrypoint<Env> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const fetchJobs = await step.do('fetch jobs', async () => {
			console.log('Step 1 - Fetching University Jobs from Greenhouse API');
			const response = await fetch('https://boards-api.greenhouse.io/v1/boards/cloudflare/departments/70480?content=true');
			const rawData = await response.json();

			try {
				const parsedResponse = greenhouseApiResponseSchema.parse(rawData);
				return parsedResponse.jobs;
			} catch (error) {
				if (error instanceof z.ZodError) {
					console.error('Validation error:', JSON.stringify(error.errors, null, 2));
				}
				throw error;
			}
		});

		const refineData = await step.do('refine data', async () => {
			console.log('Step 2 - Refining job data');
			const processedJobs = fetchJobs.map(job => {
				const locationMetadata = job.metadata.find(m => m.name === "Job Posting Location");
				const location = locationMetadata?.value;
				const city = Array.isArray(location) ? location[0].split(", ")[0] : "Remote";
				const countryCode = Array.isArray(location) ? location[0].split(", ")[1] : "ANY";

				return {
					listingId: job.id.toString(),
					title: job.title,
					city,
					countryCode: getCountryCode(countryCode),
					description: `Join Cloudflare and help build a better internet. Apply today for the role of ${job.title}`,
					jobType: "internship",
					portalPostedDate: job.updated_at,
					companyListingUrl: job.absolute_url,
					portalUpdatedTime: job.updated_at,
				};
			});
			return processedJobs;
		});

		const insertJobs = await step.do('insert jobs', async () => {
			console.log('Step 3 - Inserting jobs into database');
			const db = drizzle(this.env.DB);
			// Get company ID
			const company = await db.select().from(schema.companies).where(eq(schema.companies.name, 'Cloudflare'));
			const companyId = company[0].id;

			// Map the jobs to the schema
			const jobs = refineData.map(job => {
				const j = {
					companyId: companyId
				};
				Object.assign(j, job);
				return j;
			}
			);

			// Create a batch of 5 to avoid SQL Param limit
			for (let i = 0; i < jobs.length; i += 5) {
				const batch = jobs.slice(i, i + 5);
				await db.insert(schema.jobs).values(batch).onConflictDoUpdate({
					target: schema.jobs.listingId,
					set: schema.jobs,
				});
			}

			console.log('Ingested Jobs:', jobs.length);

		});
	}
}