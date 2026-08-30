import {
  ArrowLeftIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";

import type { ApplicationWorkspace, Job } from "@jobbbler/contracts";

import { externalApplicationUrl } from "@/features/job-detail/application-capability";

import {
  applicationDisclosure,
  applicationReadiness,
  isAgentAssistedApplication,
} from "./application-model";
import styles from "./application-view.module.css";

export type ApplicationAction = "use_demo_profile" | "review_and_submit";

export interface ApplicationConfirmationView {
  readonly confirmationId: string;
  readonly expiresAt: string;
}

export interface ApplicationViewProps {
  readonly workspace: ApplicationWorkspace;
  readonly job: Job;
  readonly fieldValues: Readonly<Record<string, string>>;
  readonly confirmation: ApplicationConfirmationView | null;
  readonly busy: boolean;
  readonly error: string | null;
  onFieldChange(fieldKey: string, value: string): void;
  onAction(action: ApplicationAction): void;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (character) => character.toUpperCase());
}

function receiptDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function ApplicationField({
  workspace,
  fieldValues,
  fieldKey,
  readOnly,
  onFieldChange,
}: Readonly<{
  workspace: ApplicationWorkspace;
  fieldValues: Readonly<Record<string, string>>;
  fieldKey: string;
  readOnly: boolean;
  onFieldChange(fieldKey: string, value: string): void;
}>) {
  const field = workspace.requirements.find((candidate) => candidate.fieldKey === fieldKey);
  if (field === undefined) return null;
  const answer = workspace.draft.answers.find((candidate) => candidate.fieldKey === field.fieldKey);
  const shared = {
    id: `application-${field.fieldKey}`,
    name: field.fieldKey,
    required: field.required,
    value: fieldValues[field.fieldKey] ?? "",
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => onFieldChange(field.fieldKey, event.target.value),
  };

  return (
    <div
      className={styles["field"]}
      data-missing={(fieldValues[field.fieldKey] ?? "").trim() === ""}
    >
      <div className={styles["fieldLabel"]}>
        <label htmlFor={shared.id}>{field.label}</label>
        <span>
          {answer?.provenance === "agent_suggestion" ? (
            <>
              <PencilSimpleIcon aria-hidden="true" /> Agent suggestion
            </>
          ) : field.sensitive ? (
            "Private"
          ) : field.required ? (
            "Required"
          ) : (
            "Optional"
          )}
        </span>
      </div>
      <p>{field.description}</p>
      {field.input === "textarea" ? (
        <textarea {...shared} maxLength={10_000} readOnly={readOnly} rows={5} />
      ) : field.input === "select" ? (
        <select {...shared} aria-readonly={readOnly} disabled={readOnly}>
          <option value="">Choose one</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          autoComplete={field.fieldKey === "email" ? "email" : "off"}
          maxLength={500}
          readOnly={readOnly}
          type={field.input}
        />
      )}
    </div>
  );
}

function AgentAssistanceRequest({ workspace }: Pick<ApplicationViewProps, "workspace">) {
  const requested = workspace.delegationRequests.find(({ status }) => status === "requested");
  if (requested === undefined) return null;
  return (
    <section aria-labelledby="agent-assistance-heading" className={styles["assistance"]}>
      <div>
        <p className={styles["eyebrow"]}>Agent assistance</p>
        <h2 id="agent-assistance-heading">Your agent requested preparation access</h2>
        <p>
          Complete this decision in your external agent client. Jobbbler will accept only the
          decision bound to this exact request; this page cannot approve it.
        </p>
      </div>
    </section>
  );
}

function ReviewDocument({
  workspace,
  fieldValues,
  busy,
  onFieldChange,
  onAction,
}: Pick<
  ApplicationViewProps,
  "workspace" | "fieldValues" | "busy" | "onFieldChange" | "onAction"
>) {
  const readiness = applicationReadiness(workspace);
  const disclosure = applicationDisclosure(workspace);
  const agentAssisted = isAgentAssistedApplication(workspace);
  const missingFields = readiness.missingFieldKeys
    .map((fieldKey) => workspace.requirements.find((field) => field.fieldKey === fieldKey))
    .filter((field) => field !== undefined);
  const disclosedLabels = disclosure.fieldKeys.map(
    (fieldKey) =>
      workspace.requirements.find((field) => field.fieldKey === fieldKey)?.label ??
      humanize(fieldKey),
  );
  const sensitiveLabels = disclosure.sensitiveFieldKeys.map(
    (fieldKey) =>
      workspace.requirements.find((field) => field.fieldKey === fieldKey)?.label ??
      humanize(fieldKey),
  );

  return (
    <>
      <AgentAssistanceRequest workspace={workspace} />
      <section aria-labelledby="review-heading" className={styles["stagePanel"]}>
        <div className={styles["sectionHeading"]}>
          <div>
            <p className={styles["eyebrow"]}>Application draft</p>
            <h2 id="review-heading">Review your application</h2>
          </div>
          <p className={styles["completion"]}>
            {readiness.readyForReview
              ? `${String(readiness.completed)} of ${String(readiness.required)} details ready`
              : `${String(missingFields.length)} ${missingFields.length === 1 ? "detail" : "details"} needed`}
          </p>
        </div>
        <p className={styles["sectionIntro"]}>
          {agentAssisted
            ? readiness.readyForReview
              ? "This page is read-only for this agent-assisted draft. Ask the agent to revise anything before the exact decision in your external client."
              : "This page is read-only for this agent-assisted draft. Ask the agent to prepare the missing facts in your external client."
            : readiness.readyForReview
              ? "Everything required is ready. Edit anything that does not sound like you."
              : "Ask your agent or fill it in here. You only need to resolve the items that are missing."}
        </p>

        {missingFields.length === 0 ? null : (
          <div aria-label="Missing application details" className={styles["missingSummary"]}>
            <strong>Still needed</strong>
            <span>{missingFields.map(({ label }) => label).join(" · ")}</span>
          </div>
        )}

        <div className={styles["fields"]}>
          {workspace.requirements.map((field) => (
            <ApplicationField
              fieldKey={field.fieldKey}
              fieldValues={fieldValues}
              key={field.fieldKey}
              onFieldChange={onFieldChange}
              readOnly={agentAssisted}
              workspace={workspace}
            />
          ))}
        </div>

        <section aria-labelledby="sharing-heading" className={styles["sharingSummary"]}>
          <div className={styles["sharingTitle"]}>
            <ShieldCheckIcon aria-hidden="true" weight="fill" />
            <div>
              <p className={styles["eyebrow"]}>Before you submit</p>
              <h3 id="sharing-heading">One approval, for this application only</h3>
            </div>
          </div>
          <dl className={styles["permissionGrid"]}>
            <div>
              <dt>Sending to</dt>
              <dd>{workspace.recipient.name}</dd>
            </div>
            <div>
              <dt>Included</dt>
              <dd>
                {disclosedLabels.length === 0 ? "No information yet" : disclosedLabels.join(" · ")}
              </dd>
            </div>
            <div>
              <dt>Your control</dt>
              <dd>Any edit cancels the approval. Your agent cannot reuse or submit it again.</dd>
            </div>
          </dl>
          <details className={styles["technicalDetails"]}>
            <summary>Privacy details</summary>
            <dl className={styles["permissionGrid"]}>
              <div>
                <dt>Purpose</dt>
                <dd>{workspace.purpose}</dd>
              </div>
              <div>
                <dt>Private fields</dt>
                <dd>{sensitiveLabels.length === 0 ? "None" : sensitiveLabels.join(" · ")}</dd>
              </div>
              <div>
                <dt>Privacy notice</dt>
                <dd>{workspace.noticeVersion}</dd>
              </div>
            </dl>
          </details>
        </section>

        {agentAssisted ? (
          <div className={styles["actions"]}>
            <p>
              <strong>Complete this decision in your external agent client.</strong> Ask the agent
              to revise any answer first. This page cannot approve assistance, consent, or
              submission for an agent-assisted draft.
            </p>
          </div>
        ) : (
          <div className={styles["actions"]}>
            <button
              className={styles["primaryAction"]}
              disabled={busy || !readiness.readyForReview}
              onClick={() => onAction("review_and_submit")}
              type="button"
            >
              <PaperPlaneTiltIcon aria-hidden="true" /> Review and submit to{" "}
              {workspace.recipient.name}
            </button>
            <p>Nothing is sent until this final action succeeds.</p>
          </div>
        )}
      </section>
    </>
  );
}

function CompletePanel({ workspace }: Readonly<{ workspace: ApplicationWorkspace }>) {
  const receipt = workspace.receipt;
  const externalUrl = receipt?.status === "handed_off" ? receipt.externalUrl : null;
  return (
    <section aria-labelledby="complete-heading" className={styles["stagePanel"]}>
      <CheckCircleIcon aria-hidden="true" className={styles["completeIcon"]} weight="fill" />
      <p className={styles["eyebrow"]}>Done</p>
      <h2 id="complete-heading">
        {receipt?.status === "handed_off"
          ? "Ready to continue on the employer's website"
          : "Application submitted"}
      </h2>
      {receipt === null ? null : (
        <p className={styles["receiptDate"]}>
          {receipt.status === "submitted" ? "Submitted" : "Prepared"}{" "}
          {receiptDate(receipt.createdAt)}
        </p>
      )}
      <p className={styles["sectionIntro"]}>
        {receipt?.status === "handed_off"
          ? "Jobbbler did not submit this application. It prepared the reviewed details for the exact employer link below."
          : "The employer received the exact application you reviewed. A private receipt is saved here."}
      </p>
      {externalUrl === null ? null : (
        <a className={styles["primaryLink"]} href={externalUrl} rel="noreferrer" target="_blank">
          Continue on the employer's website
        </a>
      )}
      {receipt === null ? null : (
        <details className={styles["technicalDetails"]}>
          <summary>Receipt details</summary>
          <dl className={styles["permissionGrid"]}>
            <div>
              <dt>Status</dt>
              <dd>{receipt.status === "submitted" ? "Submitted" : "External handoff"}</dd>
            </div>
            <div>
              <dt>Receipt reference</dt>
              <dd>{receipt.id}</dd>
            </div>
          </dl>
        </details>
      )}
      <Link className={styles["secondaryLink"]} href="/applications">
        Back to applications
      </Link>
    </section>
  );
}

function LegacyExternalPanel({
  workspace,
  job,
}: Readonly<{ workspace: ApplicationWorkspace; job: Job }>) {
  const activeConsent = workspace.dataGrant?.status === "active";
  const employerUrl = externalApplicationUrl(job);
  return (
    <section aria-labelledby="legacy-external-heading" className={styles["stagePanel"]}>
      <p className={styles["eyebrow"]}>Legacy external application</p>
      <h2 id="legacy-external-heading">This historical draft is read-only</h2>
      <p className={styles["sectionIntro"]}>
        External roles now continue on the employer&apos;s website. Jobbbler cannot edit, review,
        prepare, or submit this legacy draft.
      </p>
      {activeConsent ? (
        <p>
          Active consent remains revocable. You can still withdraw consent in your agent client.
        </p>
      ) : null}
      {employerUrl === null ? null : (
        <a className={styles["primaryLink"]} href={employerUrl} rel="noreferrer" target="_blank">
          Continue on the employer&apos;s website
        </a>
      )}
      <Link className={styles["secondaryLink"]} href="/applications">
        Back to applications
      </Link>
    </section>
  );
}

export function ApplicationView({
  workspace,
  job,
  fieldValues,
  busy,
  error,
  onFieldChange,
  onAction,
}: ApplicationViewProps) {
  const complete =
    workspace.receipt !== null ||
    workspace.draft.state === "submitted" ||
    workspace.draft.state === "handed_off";
  const legacyExternalDraft = workspace.applyMode === "external" && !complete;
  return (
    <div className={styles["page"]}>
      <header className={styles["hero"]}>
        <Link className={styles["backLink"]} href={`/jobs/${encodeURIComponent(job.id)}`}>
          <ArrowLeftIcon aria-hidden="true" /> Back to role
        </Link>
        <h1>
          {complete
            ? "Application receipt"
            : legacyExternalDraft
              ? "Legacy external application"
              : `Application for ${job.title}`}
        </h1>
        <p className={styles["heroSub"]}>
          {complete
            ? `${job.title} · ${job.organizationName}`
            : legacyExternalDraft
              ? `${job.title} · ${job.organizationName}`
              : "Your agent can prepare the work. Check the details once, then submit."}
        </p>
      </header>
      {error === null ? null : (
        <p className={styles["error"]} role="alert">
          <WarningCircleIcon aria-hidden="true" /> {error}
        </p>
      )}
      <div className={styles["workspace"]}>
        {complete ? (
          <CompletePanel workspace={workspace} />
        ) : legacyExternalDraft ? (
          <LegacyExternalPanel job={job} workspace={workspace} />
        ) : (
          <ReviewDocument
            busy={busy}
            fieldValues={fieldValues}
            onAction={onAction}
            onFieldChange={onFieldChange}
            workspace={workspace}
          />
        )}
      </div>
    </div>
  );
}
