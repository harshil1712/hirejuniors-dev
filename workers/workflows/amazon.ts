import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import * as schema from "../../database/schema";
import { sql, eq } from 'drizzle-orm';
import { getCountryCode } from 'utils/countryCode';

const jobResponseSchema = z.array(z.object({
	id: z.string(),
	title: z.string(),
	city: z.string(),
	country_code: z.string(),
	description_short: z.string(),
	job_schedule_type: z.string(),
	posted_date: z.string(),
	job_path: z.string(),
	updated_time: z.string(),
	basic_qualifications: z.string(),
	description: z.string(),
	preferred_qualifications: z.string(),
}))

const amazonApi = "https://www.amazon.jobs/en/search.json?sort=recent&category%5B%5D=software-development&category%5B%5D=operations-it-support-engineering&category%5B%5D=project-program-product-management-technical&category%5B%5D=solutions-architect&category%5B%5D=machine-learning-science&category%5B%5D=systems-quality-security-engineering&category%5B%5D=hardware-development&category%5B%5D=data-science&category%5B%5D=research-science&business_category%5B%5D=student-programs&radius=24km&facets%5B%5D=normalized_country_code&facets%5B%5D=normalized_state_name&facets%5B%5D=normalized_city_name&facets%5B%5D=location&facets%5B%5D=business_category&facets%5B%5D=category&facets%5B%5D=schedule_type_id&facets%5B%5D=employee_class&facets%5B%5D=normalized_location&facets%5B%5D=job_function_id&facets%5B%5D=is_manager&facets%5B%5D=is_intern&offset=0&result_limit=50&sort=recent&latitude=&longitude=&loc_group_id=&loc_query=&base_query=&city=&country=&region=&county=&query_options=&"

function isOlderThanThreeMonths(timeString: string): boolean {
	// Handle full date format (e.g., "February 14, 2024")
	if (timeString.includes(',')) {
		const date = new Date(timeString);
		if (!isNaN(date.getTime())) {
			const threeMonthsAgo = new Date();
			threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
			return date < threeMonthsAgo;
		}
	}

	// Handle relative time format (e.g., "4 days", "2 months")
	const matches = timeString.match(/\d+/);
	if (!matches) return false;

	const num = parseInt(matches[0]);
	if (isNaN(num)) return false;

	const str = timeString.toLowerCase();
	if (str.includes('year') || str.includes('yr')) return true;
	if (str.includes('month') || str.includes('mont')) {
		return str.includes('about') ? num >= 3 : num > 3;
	}
	if (str.includes('day')) return num >= 90;

	return false;
}

export class AmazonWorkflow extends WorkflowEntrypoint<Env> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {

		const fetchJobs = await step.do('fetch jobs from Amazon API', async () => {
			console.log('Step 1 - Fetching Jobs');
			const response = await fetch(amazonApi);
			const data: any = await response.json();
			const parsedData = jobResponseSchema.parse(data.jobs)
			return parsedData
		});

		const refineJobs = await step.do('refine jobs', async () => {
			console.log('Step 2 - Refining Jobs');
			console.log('Total Jobs:', fetchJobs.length);
			const titleFilteredJobs = fetchJobs.filter((job: typeof jobResponseSchema._type[0]) => {
				const title = job.title.toLowerCase();
				return !title.includes('sr.') && !title.includes('senior') && !title.includes('lead') && !title.includes('principal');
			})

			console.log('Filtered Jobs:', titleFilteredJobs.length);

			return titleFilteredJobs;

			const messages = [
				{
					role: 'system',
					content: "You are an AI assistant. You help with filtering jobs. Given the array of jobs, return only the tech jobs that are suitable for junior developers. This can include jobs that are for interns and graduates. Return the jobs in the same format as the input. The list will be provided by the user. Don't provide me the code. You do the work and only return only the list."
				},
				{
					role: 'user',
					content: `Here is the list of jobs: ${titleFilteredJobs}`
				}
			]
			// const aiFilteredJobs = await this.env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
			// 	messages
			// })

			// console.log('AI Filtered Jobs:', aiFilteredJobs.response);
		})

		const ingestJobs = await step.do('ingest jobs into database', async () => {
			console.log('Step 3 - Ingesting Jobs');
			const db = drizzle(this.env.DB);
			// Get company ID
			const company = await db.select().from(schema.companies).where(eq(schema.companies.name, 'Amazon'));
			const companyId = company[0].id;

			// Map the jobs to the schema
			const jobs = refineJobs.map((job: typeof jobResponseSchema._type[0]) => {
				const j = {
					listingId: job.id,
					title: job.title,
					city: job.city,
					countryCode: getCountryCode(job.country_code),
					description: job.description_short,
					jobType: job.job_schedule_type,
					portalPostedDate: job.posted_date,
					companyListingUrl: `https://amazon.jobs${job.job_path}`,
					portalUpdatedTime: job.updated_time,
					companyId,
				}
				schema.insertJob.parse(j);
				return j;
			})

			// Create a batch of 5 to avoid SQL Param limit
			for (let i = 0; i < jobs.length; i += 5) {
				const batch = jobs.slice(i, i + 5);
				await db.insert(schema.jobs).values(batch).onConflictDoUpdate({
					target: schema.jobs.listingId,
					set: schema.jobs,
				});
			}

			console.log('Ingested Jobs:', jobs.length);
		})

		step.do('Archive Jobs based on portalPostedDate and portalUpdatedTime', async () => {
			console.log('Step 4 - Archive Jobs based on portalPostedDate and portalUpdatedTime');
			const db = drizzle(this.env.DB);

			let totalJobs = await db.select({ count: sql<number>`count(*)` }).from(schema.jobs);
			console.log('Total Active Jobs:', totalJobs);

			const oldJobs = await db.select({
				id: schema.jobs.id,
				postTime: schema.jobs.portalPostedDate,
				updateTime: schema.jobs.portalUpdatedTime,
				title: schema.jobs.title
			})
				.from(schema.jobs)
				.where(sql`${schema.jobs.portalPostedDate} IS NOT NULL AND ${schema.jobs.portalUpdatedTime} IS NOT NULL AND ${schema.jobs.archived} = 0`);

			const jobsToArchive = oldJobs.filter(job => {
				const isOldPost = isOlderThanThreeMonths(job.postTime);
				const isOldUpdate = isOlderThanThreeMonths(job.updateTime);
				return isOldPost || isOldUpdate;
			});

			console.log('Jobs to archive:', jobsToArchive.length);

			if (jobsToArchive.length > 0) {
				// Update jobs in batches of 5 to avoid parameter limits
				for (let i = 0; i < jobsToArchive.length; i += 5) {
					const batch = jobsToArchive.slice(i, i + 5);
					const placeholders = batch.map(() => '?').join(',');
					await db.run(
						sql`UPDATE jobs SET archived = 1 WHERE id IN (${sql.join(batch.map(j => j.id), sql`, `)})`
					);
				}
			}

			const activeJobs = await db.select({ count: sql<number>`count(*)` }).from(schema.jobs).where(sql`${schema.jobs.archived} = 0`);
			console.log('Remaining Active Jobs:', activeJobs);
		})
	}
}