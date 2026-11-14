import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Input,
  InputGroup,
  Loader,
  Select,
  Table,
  Text,
} from "@cloudflare/kumo";
import { MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import type { Company, Job, JobStatus } from "../../../worker/api/schemas";
import { listCompanies, listJobs, type JobFilters } from "../../lib/admin-api";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { CrewEmpty } from "../../components/crew-empty";

interface JobsSearch {
  status?: JobStatus;
  level?: string;
  country?: string;
  companyId?: string;
  q?: string;
}

export const Route = createFileRoute("/_authed/jobs")({
  validateSearch: (search: JobsSearch): JobsSearch => ({
    status: search.status === "retired" || search.status === "active" ? search.status : undefined,
    level: search.level || undefined,
    country: search.country || undefined,
    companyId: search.companyId || undefined,
    q: search.q || undefined,
  }),
  component: Jobs,
});

const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Retired", value: "retired" },
];
const LEVEL_OPTIONS = [
  { label: "Internship", value: "internship" },
  { label: "Apprenticeship", value: "apprenticeship" },
  { label: "Graduate", value: "graduate" },
  { label: "Junior", value: "junior" },
];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Jobs() {
  useDocumentTitle("Jobs");
  const navigate = useNavigate({ from: "/jobs" });
  const search = Route.useSearch();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qInput, setQInput] = useState(search.q ?? "");

  const filters: JobFilters = {
    status: search.status ?? "active",
    level: search.level,
    country: search.country,
    companyId: search.companyId,
    q: search.q,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await listJobs(filters);
      setJobs(page.data);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.status, search.level, search.country, search.companyId, search.q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void listCompanies()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, []);

  // Debounce the title search into the URL.
  useEffect(() => {
    if (qInput === (search.q ?? "")) return;
    const t = setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, q: qInput || undefined }),
        replace: true,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, search.q, navigate]);

  const setFilter = (patch: Partial<JobsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listJobs(filters, nextCursor);
      setJobs((prev) => [...prev, ...page.data]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Every listing the pipeline has ingested."
        actions={
          <InputGroup className="w-full sm:w-72">
            <InputGroup.Addon>
              <MagnifyingGlass aria-hidden />
            </InputGroup.Addon>
            <InputGroup.Input
              type="search"
              placeholder="Search titles"
              aria-label="Search job titles"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </InputGroup>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={filters.status}
          onValueChange={(v) => setFilter({ status: v === "retired" ? "retired" : "active" })}
          items={STATUS_OPTIONS}
        />
        <Select
          label="Level"
          value={filters.level ?? ""}
          onValueChange={(v) => setFilter({ level: v || undefined })}
          items={[{ label: "All levels", value: "" }, ...LEVEL_OPTIONS]}
        />
        <Select
          label="Company"
          value={filters.companyId ?? ""}
          onValueChange={(v) => setFilter({ companyId: v || undefined })}
          items={[
            { label: "All companies", value: "" },
            ...companies.map((cmp) => ({ label: cmp.name, value: cmp.id })),
          ]}
        />
        <Input
          label="Country (alpha-2)"
          placeholder="US"
          className="w-28"
          value={filters.country ?? ""}
          onChange={(e) => setFilter({ country: e.target.value || undefined })}
        />
      </div>

      {loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load jobs"
          description={loadError}
          action={<Banner.Action onClick={() => void load()}>Try again</Banner.Action>}
        />
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading jobs" />
        </div>
      ) : jobs.length === 0 ? (
        <CrewEmpty
          title="No jobs match"
          description="Try widening the filters, or wait for the next ingest run."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-kumo-line" aria-busy={loading}>
            <Table layout="fixed" className="min-w-[720px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head>Title</Table.Head>
                  <Table.Head className="w-40">Company</Table.Head>
                  <Table.Head className="w-28">Level</Table.Head>
                  <Table.Head className="w-48">Location</Table.Head>
                  <Table.Head className="w-28">First seen</Table.Head>
                  <Table.Head className="w-24">Status</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {jobs.map((j) => (
                  <Table.Row key={j.id}>
                    <Table.Cell>
                      <Link
                        to="/jobs/$id"
                        params={{ id: j.id }}
                        className="truncate font-medium text-kumo-default hover:underline"
                      >
                        {j.title}
                      </Link>
                      <Text variant="secondary" size="sm" truncate>
                        {j.postedAt
                          ? `posted ${dateFormat.format(new Date(j.postedAt))}`
                          : "no posted date"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>{j.company.name}</Table.Cell>
                    <Table.Cell>
                      <Badge variant="outline">{j.level}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text variant="secondary" size="sm" truncate>
                        {j.locationRaw}
                        {j.countryCode ? ` · ${j.countryCode}` : ""}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>{dateFormat.format(new Date(j.firstSeenAt))}</Table.Cell>
                    <Table.Cell>
                      <Badge variant={j.status === "active" ? "success" : "neutral"}>
                        {j.status}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
