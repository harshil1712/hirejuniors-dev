import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, LayerCard, Loader, Select, Text } from "@cloudflare/kumo";
import { ArrowSquareOut, WarningCircle } from "@phosphor-icons/react";
import type { Job } from "../../../worker/api/schemas";
import { approveJob, getJob, rejectJob, setJobStatus } from "../../lib/admin-api";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { ConfirmDialog } from "../../components/confirm-dialog";

const LEVEL_OPTIONS = [
  { label: "Internship", value: "internship" },
  { label: "Apprenticeship", value: "apprenticeship" },
  { label: "Graduate", value: "graduate" },
  { label: "Junior", value: "junior" },
];

export const Route = createFileRoute("/_authed/jobs_/$id")({ component: JobDetail });

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const fmt = (iso: string | null) => (iso ? dateTimeFormat.format(new Date(iso)) : "—");

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text variant="secondary" size="sm">
        {label}
      </Text>
      <Text>{value ?? "—"}</Text>
    </div>
  );
}

function JobDetail() {
  const { id } = Route.useParams();
  useDocumentTitle("Job");
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approveLevel, setApproveLevel] = useState("junior");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setJob(await getJob(id));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const retire = job?.status === "active";
  const toggle = async () => {
    const updated = await setJobStatus(id, retire ? "retired" : "active");
    setJob(updated);
    toast.success(retire ? "Job retired" : "Job restored", updated.title);
    void router.invalidate();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={job?.title ?? "Job"}
        description={
          job ? (
            <>
              {job.company.name} · <Badge variant="outline">{job.level}</Badge>
            </>
          ) : undefined
        }
        actions={
          job ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                icon={ArrowSquareOut}
                onClick={() => window.open(job.applyUrl, "_blank", "noopener")}
              >
                Apply
              </Button>
              {(job.status === "review" || job.status === "rejected") && (
                <>
                  <Select
                    label="Level"
                    value={approveLevel}
                    onValueChange={(v) => v && setApproveLevel(v)}
                    items={LEVEL_OPTIONS}
                    className="w-36"
                  />
                  <Button
                    variant="primary"
                    onClick={() => {
                      void (async () => {
                        try {
                          setJob(await approveJob(id, approveLevel));
                          toast.success("Job approved");
                        } catch (e) {
                          toast.error("Approve failed", (e as Error).message);
                        }
                      })();
                    }}
                  >
                    Approve
                  </Button>
                </>
              )}
              {job.status !== "rejected" && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void (async () => {
                      try {
                        setJob(await rejectJob(id));
                        toast.success("Job rejected");
                      } catch (e) {
                        toast.error("Reject failed", (e as Error).message);
                      }
                    })();
                  }}
                >
                  Reject
                </Button>
              )}
              <Button
                variant={retire ? "destructive" : "primary"}
                onClick={() => setConfirmOpen(true)}
              >
                {retire ? "Retire" : "Restore"}
              </Button>
            </div>
          ) : undefined
        }
      />

      {loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load the job"
          description={loadError}
          action={
            <>
              <Banner.Action onClick={() => void load()}>Try again</Banner.Action>{" "}
              <Link to="/jobs">Back to jobs</Link>
            </>
          }
        />
      ) : job === null ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading job" />
        </div>
      ) : (
        <>
          <LayerCard>
            <LayerCard.Secondary>Listing</LayerCard.Secondary>
            <LayerCard.Primary>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Status"
                  value={
                    <>
                      <Badge variant={job.status === "active" ? "success" : "neutral"}>
                        {job.status}
                      </Badge>
                      {job.retireReason ? ` (${job.retireReason})` : ""}
                    </>
                  }
                />
                <Field label="Level" value={job.level} />
                <Field label="Employment type" value={job.employmentType} />
                <Field label="Workplace" value={job.workplace} />
                <Field label="Location" value={job.locationRaw} />
                <Field
                  label="City / region / country"
                  value={
                    [job.city, job.region, job.countryCode].filter(Boolean).join(" · ") || null
                  }
                />
                <Field label="Posted" value={fmt(job.postedAt)} />
                <Field label="Valid through" value={fmt(job.validThrough)} />
                <Field label="First seen" value={fmt(job.firstSeenAt)} />
                <Field label="Last seen" value={fmt(job.lastSeenAt)} />
                <Field label="Last checked" value={fmt(job.lastCheckedAt)} />
                <Field label="Retired" value={fmt(job.retiredAt)} />
                <Field label="Missed runs" value={String(job.missedRuns)} />
                <Field label="Classified by" value={job.classifiedBy} />
                <Field label="Classified at" value={fmt(job.classifiedAt)} />
                <Field
                  label="Classifier confidence"
                  value={
                    job.classifierConfidence == null ? null : job.classifierConfidence.toFixed(2)
                  }
                />
                <Field label="Reject reason" value={job.rejectReason} />
                <Field label="Review reason" value={job.reviewReason} />
                <Field
                  label="Salary"
                  value={
                    job.salaryMin && job.salaryMax
                      ? `${job.salaryCurrency ?? ""} ${job.salaryMin}–${job.salaryMax} / ${job.salaryPeriod ?? "?"}`
                      : null
                  }
                />
                <Field
                  label="Grad year"
                  value={job.graduationYear ? String(job.graduationYear) : null}
                />
                <Field label="Slug" value={job.slug} />
                <Field label="Company" value={`${job.company.name} (${job.company.slug})`} />
                <Field
                  label="Apply URL"
                  value={
                    <a
                      href={job.applyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-kumo-link underline"
                    >
                      {job.applyUrl}
                    </a>
                  }
                />
              </div>
            </LayerCard.Primary>
          </LayerCard>

          <LayerCard>
            <LayerCard.Secondary>Description</LayerCard.Secondary>
            <LayerCard.Primary>
              <div className="whitespace-pre-wrap">
                <Text>{job.descriptionText || "—"}</Text>
              </div>
            </LayerCard.Primary>
          </LayerCard>
        </>
      )}

      <ConfirmDialog
        title={retire ? "Retire this job?" : "Restore this job?"}
        description={
          retire
            ? "It disappears from the board and ingest won't bring it back — manual retirement is sticky."
            : "It returns to the active listings and its missed-run counter resets."
        }
        confirmLabel={retire ? "Retire job" : "Restore job"}
        variant={retire ? "destructive" : "primary"}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={toggle}
      />
    </div>
  );
}
