import { database } from "~/database/context";
import * as schema from "~/database/schema";

import type { Route } from "./+types/home";
import Header from '../components/Header'
import Hero from '../components/Hero'
import JobListings from '../components/JobListings'
import Footer from '../components/Footer'

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "Hire Juniors" },
    { name: "description", content: "Get started in tech. Find your dream teach job." },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  let name = formData.get("name");
  let email = formData.get("email");
  if (typeof name !== "string" || typeof email !== "string") {
    return { guestBookError: "Name and email are required" };
  }

  name = name.trim();
  email = email.trim();
  if (!name || !email) {
    return { guestBookError: "Name and email are required" };
  }

  const db = database();
  try {
    await db.insert(schema.guestBook).values({ name, email });
  } catch (error) {
    return { guestBookError: "Error adding to guest book" };
  }
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = database();

  try {
    const jobs = await db.query.jobs.findMany({
      columns: {
        id: true,
        title: true,
        city: true,
        countryCode: true,
        description: true,
        jobType: true,
        companyListingUrl: true,
        createdAt: true,
      },
      where: (jobs, { eq }) => eq(jobs.archived, false),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      with: {
        company: {
          columns: {
            logo: true,
            name: true,
          }
        },
      },
    });
    return jobs
  } catch (error) {
    console.error(error);
    return [];
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const jobs = loaderData;
  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100">
      <Header />
      <main className="flex-grow">
        <Hero />
        <JobListings jobs={jobs} />
      </main>
      <Footer />
    </div>
  )
}
