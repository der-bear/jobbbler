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
  applicationDisclosureForValues,
  applicationReadinessForValues,
  isAgentAssistedApplication,
  isLiveApplicationAssistance,
  isLiveApplicationDataGrant,
} from "./application-model";
import styles from "./application-view.module.css";

export type ApplicationAction = "review_and_submit";
type SubmittedReceipt = Extract<
  NonNullable<ApplicationWorkspace["receipt"]>,
  { readonly status: "submitted" }
>;

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
  readonly saveState?: "idle" | "saving" | "saved" | "error";
  onFieldChange(fieldKey: string, value: string): void;
  onFieldCommit?(fieldKey: string, value: string): void;
  onAction(action: ApplicationAction): void;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (character) => character.toUpperCase());
}

function receiptTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function submittedAnswerValue(
  value: ApplicationWorkspace["draft"]["answers"][number]["value"],
): string | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.join(", ");
  if (typeof value === "string") return value.trim().length === 0 ? null : value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function ApplicationField({
  workspace,
  fieldValues,
  fieldKey,
  readOnly,
  onFieldChange,
  onFieldCommit,
}: Readonly<{
  workspace: ApplicationWorkspace;
  fieldValues: Readonly<Record<string, string>>;
  fieldKey: string;
  readOnly: boolean;
  onFieldChange(fieldKey: string, value: string): void;
  onFieldCommit?(fieldKey: string, value: string): void;
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
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onFieldCommit?.(field.fieldKey, event.currentTarget.value),
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
  const live = workspace.delegationRequests.find((delegation) =>
    isLiveApplicationAssistance(delegation, now),
  );
  const requested = live?.status === "requested" ? live : undefined;
  const latest = workspace.delegationRequests.at(-1);
  const ended = live === undefined && latest !== undefined;
  if (requested === undefined && !ended) return null;
  return (
    <section aria-labelledby="agent-assistance-heading" className={styles["assistance"]}>
      <div>
        <p className={styles["eyebrow"]}>Agent preparation</p>
        {ended ? (
          <>
            <h2 id="agent-assistance-heading">Continue here</h2>
            <p>
              Agent access ended. You can edit and submit here, or ask the agent to request access
              again.
            </p>
          </>
        ) : (
          <>
            <h2 id="agent-assistance-heading">Your decision is needed</h2>
            <p>
              Decide in your agent app whether the agent may prepare this application. This request
              applies only to this application.
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
  saveState = "idle",
  onFieldChange,
  onFieldCommit,
  onAction,
}: Pick<
  ApplicationViewProps,
  | "workspace"
  | "fieldValues"
  | "busy"
  | "now"
  | "saveState"
  | "onFieldChange"
  | "onFieldCommit"
  | "onAction"
>) {
  const readiness = applicationReadinessForValues(workspace, fieldValues);
  const disclosure = applicationDisclosureForValues(workspace, fieldValues);
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
            <p className={styles["eyebrow"]}>In progress</p>
            <h2 id="review-heading">Application details</h2>
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
              ? "Review the application here. This page stays read-only while agent assistance is active; ask your agent to change anything before the final decision."
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
              {...(onFieldCommit === undefined ? {} : { onFieldCommit })}
              readOnly={agentAssisted}
              workspace={workspace}
            />
          ))}
        </div>

        {agentAssisted ? null : (
          <p aria-live="polite" className={styles["saveStatus"]}>
            {saveState === "saving"
              ? "Saving changes…"
              : saveState === "error"
                ? "Changes could not be saved. Leave the field again to retry."
                : "Changes save automatically."}
          </p>
        )}

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
                <dd>
                  <Link href="/privacy">Read our privacy notice</Link>
                </dd>
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
                : "Answer the missing questions there so the agent can finish the application."}
            </p>
          </div>
        ) : (
          <div aria-busy={busy} className={styles["actions"]}>
            <button
              aria-busy={busy}
              className={styles["primaryAction"]}
              disabled={busy || !readiness.readyForReview}
              onClick={() => onAction("review_and_submit")}
              type="button"
            >
              {busy ? (
                "Submitting…"
              ) : (
                <>
                  <PaperPlaneTiltIcon aria-hidden="true" /> Submit to {workspace.recipient.name}
                </>
              )}
            </button>
            {busy ? (
              <p aria-live="polite" role="status">
                Submitting your application.
              </p>
            ) : (
              <p>Nothing is sent until this final action succeeds.</p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function SubmittedApplicationSnapshot({
  fields,
}: Readonly<{ fields: SubmittedReceipt["submission"]["fields"] }>) {
  const presentedFields = fields.flatMap((field) => {
    const value = submittedAnswerValue(field.value);
    return value === null ? [] : [{ ...field, value }];
  });

  return (
    <section
      aria-labelledby="submitted-application-heading"
      className={styles["submittedSnapshot"]}
    >
      <h3 id="submitted-application-heading">Application sent</h3>
      <p>Read-only copy of the exact fields stored with this Jobbbler demo submission.</p>
      {presentedFields.length === 0 ? (
        <p>No application fields were included.</p>
      ) : (
        <dl className={styles["reviewList"]}>
          {presentedFields.map((field) => (
            <div key={field.fieldKey}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function CompletePanel({ workspace }: Readonly<{ workspace: ApplicationWorkspace }>) {
  const receipt = workspace.receipt;
  if (receipt === null) {
    const missingEmployerLink = workspace.draft.state === "handed_off";
    return (
      <section aria-labelledby="complete-heading" className={styles["stagePanel"]}>
        <WarningCircleIcon aria-hidden="true" className={styles["statusIcon"]} weight="fill" />
        <p className={styles["eyebrow"]}>Needs attention</p>
        <h2 id="complete-heading">
          {missingEmployerLink ? "Employer link unavailable" : "Submission status unavailable"}
        </h2>
        <p className={styles["sectionIntro"]}>
          The receipt could not be loaded. Refresh this page before relying on the application
          status.
        </p>
        <a
          className={styles["primaryLink"]}
          href={`/apply/${encodeURIComponent(workspace.draft.id)}`}
        >
          Refresh status
        </a>
        <Link className={styles["secondaryLink"]} href="/applications">
          Back to applications
        </Link>
      </section>
    );
  }

  const handedOff = receipt.status === "handed_off";
  const externalUrl = handedOff ? receipt.externalUrl : null;
  const submission = receipt.status === "submitted" ? receipt.submission : null;
  return (
    <section aria-labelledby="complete-heading" className={styles["stagePanel"]}>
      <CheckCircleIcon aria-hidden="true" className={styles["completeIcon"]} weight="fill" />
      <p className={styles["eyebrow"]}>{handedOff ? "Next step" : "Done"}</p>
      <h2 id="complete-heading">
        {handedOff
          ? "Ready to continue on the employer's website"
          : "Jobbbler demo submission complete"}
      </h2>
      {handedOff ? (
        <p className={styles["receiptDate"]}>
          Prepared <time dateTime={receipt.createdAt}>{receiptTimestamp(receipt.createdAt)}</time>
        </p>
      ) : null}
      <p className={styles["sectionIntro"]}>
        {handedOff
          ? "Jobbbler did not submit this application. It prepared the reviewed details for the exact employer link below."
          : `Jobbbler delivered the exact reviewed application to its managed demo inbox for ${submission?.recipient.name ?? "the saved demo recipient"}. This receipt records the acknowledged Jobbbler demo submission.`}
      </p>
      {externalUrl === null ? null : (
        <a className={styles["primaryLink"]} href={externalUrl} rel="noreferrer" target="_blank">
          Continue on the employer's website
        </a>
      )}
      {handedOff ? (
        <details className={styles["technicalDetails"]}>
          <summary>Employer link details</summary>
          <dl className={styles["permissionGrid"]}>
            <div>
              <dt>Status</dt>
              <dd>Not submitted by Jobbbler</dd>
            </div>
            <div>
              <dt>Prepared at</dt>
              <dd>
                <time dateTime={receipt.createdAt}>{receiptTimestamp(receipt.createdAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Record reference</dt>
              <dd>{receipt.id}</dd>
            </div>
          </dl>
        </details>
      ) : submission === null ? null : (
        <>
          <dl aria-label="Submission receipt" className={styles["permissionGrid"]}>
            <div>
              <dt>Sent to</dt>
              <dd>{submission.recipient.name}</dd>
            </div>
            <div>
              <dt>Submitted at</dt>
              <dd>
                <time dateTime={submission.submittedAt}>
                  {receiptTimestamp(submission.submittedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Receipt reference</dt>
              <dd>{submission.providerReferenceId}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{submission.role.title}</dd>
            </div>
            <div>
              <dt>Job ID</dt>
              <dd>{submission.role.id}</dd>
            </div>
          </dl>
          <SubmittedApplicationSnapshot fields={submission.fields} />
        </>
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
      <p className={styles["eyebrow"]}>Older external application</p>
      <h2 id="legacy-external-heading">This historical record is read-only</h2>
      <p className={styles["sectionIntro"]}>
        External roles now continue on the employer&apos;s website. Jobbbler cannot edit, review,
        prepare, or submit this older record.
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

function ClosedRolePanel({
  workspace,
  now,
}: Readonly<{ workspace: ApplicationWorkspace; now: string }>) {
  const activeConsent =
    isLiveApplicationDataGrant(workspace.dataGrant, now) && workspace.dataGrant.status === "active";
  return (
    <section aria-labelledby="closed-role-heading" className={styles["stagePanel"]}>
      <p className={styles["eyebrow"]}>Application closed</p>
      <h2 id="closed-role-heading">Role closed — nothing submitted.</h2>
      <p className={styles["sectionIntro"]}>
        The employer is no longer accepting applications for this role. Your saved application is
        read-only and remains available here.
      </p>
      {activeConsent ? (
        <p>You can still withdraw consent for future processing in your agent client.</p>
      ) : null}
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
  saveState = "idle",
  onFieldChange,
  onFieldCommit,
  onAction,
}: ApplicationViewProps) {
  const terminal =
    workspace.receipt !== null ||
    workspace.draft.state === "submitted" ||
    workspace.draft.state === "handed_off";
  const submittedReceipt = workspace.receipt?.status === "submitted" ? workspace.receipt : null;
  const submitted = submittedReceipt !== null;
  const handedOff = workspace.receipt?.status === "handed_off";
  const missingReceipt =
    workspace.receipt === null &&
    (workspace.draft.state === "submitted" || workspace.draft.state === "handed_off");
  const legacyExternalDraft = workspace.applyMode === "external" && !terminal;
  const closedDraft = job.status !== "open" && !terminal;
  return (
    <div className={styles["page"]}>
      <header className={styles["hero"]}>
        <Link className={styles["backLink"]} href={`/jobs/${encodeURIComponent(job.id)}`}>
          <ArrowLeftIcon aria-hidden="true" /> Back to role
        </Link>
        <h1>
          {submitted
            ? "Application receipt"
            : handedOff
              ? "Continue on the employer's website"
              : missingReceipt
                ? "Application status"
                : closedDraft
                  ? "Role closed — nothing submitted."
                  : legacyExternalDraft
                    ? "Older external application"
                    : `Application for ${job.title}`}
        </h1>
        <p className={styles["heroSub"]}>
          {submittedReceipt !== null
            ? `Jobbbler demo · ${submittedReceipt.submission.recipient.name}`
            : terminal
              ? `${job.title} · ${job.organizationName}`
              : closedDraft
                ? `${job.title} · ${job.organizationName} · Read-only`
                : legacyExternalDraft
                  ? `${job.title} · ${job.organizationName}`
                  : "Review the details below and submit when everything looks right."}
        </p>
      </header>
      {error === null ? null : (
        <p className={styles["error"]} role="alert">
          <WarningCircleIcon aria-hidden="true" /> {error}
        </p>
      )}
      <div className={styles["workspace"]}>
        {terminal ? (
          <CompletePanel workspace={workspace} />
        ) : closedDraft ? (
          <ClosedRolePanel now={now} workspace={workspace} />
        ) : legacyExternalDraft ? (
          <LegacyExternalPanel job={job} now={now} workspace={workspace} />
        ) : (
          <ReviewDocument
            busy={busy}
            fieldValues={fieldValues}
            now={now}
            onAction={onAction}
            onFieldChange={onFieldChange}
            {...(onFieldCommit === undefined ? {} : { onFieldCommit })}
            saveState={saveState}
            workspace={workspace}
          />
        )}
      </div>
    </div>
  );
}
