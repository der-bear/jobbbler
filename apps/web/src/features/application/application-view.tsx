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
  isLiveApplicationAssistance,
  isLiveApplicationDataGrant,
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
  readonly now: string;
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

function AgentAssistanceRequest({
  workspace,
  now,
}: Pick<ApplicationViewProps, "workspace" | "now">) {
  const requested = workspace.delegationRequests.find(
    (delegation) =>
      delegation.status === "requested" && isLiveApplicationAssistance(delegation, now),
  );
  const latest = workspace.delegationRequests.at(-1);
  const ended =
    requested === undefined &&
    latest !== undefined &&
    (latest.status === "requested" || latest.status === "active") &&
    !isLiveApplicationAssistance(latest, now);
  if (requested === undefined && !ended) return null;
  return (
    <section aria-labelledby="agent-assistance-heading" className={styles["assistance"]}>
      <div>
        <p className={styles["eyebrow"]}>Agent preparation</p>
        {ended ? (
          <>
            <h2 id="agent-assistance-heading">Agent access ended</h2>
            <p>You can continue here, or ask the agent to request access again.</p>
          </>
        ) : (
          <>
            <h2 id="agent-assistance-heading">Your decision is needed</h2>
            <p>
              Decide in your agent app whether the agent may prepare this application. This request
              applies only to this draft.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function ReviewDocument({
  workspace,
  fieldValues,
  busy,
  now,
  onFieldChange,
  onAction,
}: Pick<
  ApplicationViewProps,
  "workspace" | "fieldValues" | "busy" | "now" | "onFieldChange" | "onAction"
>) {
  const readiness = applicationReadiness(workspace);
  const disclosure = applicationDisclosure(workspace);
  const agentAssisted = isAgentAssistedApplication(workspace, now);
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
      <AgentAssistanceRequest now={now} workspace={workspace} />
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
              ? "Review the draft here. This page stays read-only while agent assistance is active; ask your agent to change anything before the final decision."
              : "Your agent still needs information. Answer in your agent app; this page stays read-only while assistance is active."
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
              <p className={styles["eyebrow"]}>Before submission</p>
              <h3 id="sharing-heading">Your data, this application only</h3>
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
              <dd>Any change requires a new decision. Your agent cannot reuse it.</dd>
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
              <strong>Continue in your agent chat.</strong>{" "}
              {readiness.readyForReview
                ? "Ask for any changes there, then decide whether to submit the exact application shown here."
                : "Answer the missing questions there so the agent can finish the draft."}
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
              <dd>{receipt.status === "submitted" ? "Submitted" : "Employer website"}</dd>
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
  now,
}: Readonly<{ workspace: ApplicationWorkspace; job: Job; now: string }>) {
  const activeConsent =
    isLiveApplicationDataGrant(workspace.dataGrant, now) && workspace.dataGrant.status === "active";
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
  now,
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
              : "Your agent prepares the draft. You review it once and decide whether to submit."}
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
          <LegacyExternalPanel job={job} now={now} workspace={workspace} />
        ) : (
          <ReviewDocument
            busy={busy}
            fieldValues={fieldValues}
            now={now}
            onAction={onAction}
            onFieldChange={onFieldChange}
            workspace={workspace}
          />
        )}
      </div>
    </div>
  );
}
