import {
  ArrowLeftIcon,
  CheckCircleIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

import type { ApplicationWorkspace, Job } from "@jobbbler/contracts";

import { externalApplicationUrl } from "@/features/job-detail/application-capability";
import { titleWithoutEmploymentSuffix } from "@/lib/job-format";

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
  showErrors,
  onFieldChange,
  onFieldCommit,
}: Readonly<{
  workspace: ApplicationWorkspace;
  fieldValues: Readonly<Record<string, string>>;
  fieldKey: string;
  readOnly: boolean;
  showErrors?: boolean;
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

  const empty = (fieldValues[field.fieldKey] ?? "").trim() === "";
  const invalid = showErrors === true && field.required && empty;
  const describedBy = [`${shared.id}-description`, invalid ? `${shared.id}-error` : null]
    .filter((id) => id !== null)
    .join(" ");

  return (
    <div
      className={styles["field"]}
      data-invalid={invalid}
      data-missing={field.required && empty}
      data-wide={field.input === "textarea"}
    >
      <div className={styles["fieldLabel"]}>
        <label htmlFor={shared.id}>
          {field.label}
          {/*
           * Requiredness has to be readable on the field itself. It used to
           * share one badge slot with provenance and privacy, and privacy won
           * the chain — every required field is also sensitive, so "Required"
           * never rendered and the form never said which answers it needed.
           * Marking the exceptions is the quieter half of that: the note above
           * the fields says everything else is required.
           */}
          {field.required ? null : <span className={styles["optionalMark"]}> · optional</span>}
        </label>
        {/*
         * Only provenance goes here now. "Private" sat on five of the six
         * fields, which told the reader nothing about any of them — and the
         * block above the button already names the exact list that leaves,
         * which is the same promise stated once and precisely.
         */}
        <span>
          {answer?.provenance === "agent_suggestion" ? (
            <>
              <PencilSimpleIcon aria-hidden="true" /> Agent suggestion
            </>
          ) : null}
        </span>
      </div>
      {field.input === "textarea" ? (
        <textarea
          {...shared}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          maxLength={10_000}
          readOnly={readOnly}
          rows={5}
        />
      ) : field.input === "select" ? (
        <select
          {...shared}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-readonly={readOnly}
          disabled={readOnly}
          onChange={(event) => {
            onFieldChange(field.fieldKey, event.currentTarget.value);
            onFieldCommit?.(field.fieldKey, event.currentTarget.value);
          }}
        >
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
          aria-describedby={describedBy}
          aria-invalid={invalid}
          autoComplete={field.fieldKey === "email" ? "email" : "off"}
          maxLength={500}
          readOnly={readOnly}
          type={field.input}
        />
      )}
      {/*
       * The help sits under its control, not between the label and it. Above,
       * it pushed a line of grey text into the gap that ties a label to its
       * field, so every field read as three loose things instead of one.
       */}
      <p className={styles["fieldHint"]} id={`${shared.id}-description`}>
        {field.description}
      </p>
      {invalid ? (
        <p className={styles["fieldError"]} id={`${shared.id}-error`}>
          <WarningCircleIcon aria-hidden="true" />
          {field.input === "select"
            ? "Choose one to continue."
            : `Fill in your ${field.label.toLowerCase()} to continue.`}
        </p>
      ) : null}
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
  /*
   * Errors appear once the person has tried to submit, not while they are
   * still typing their name. Before that the form stays quiet; after it, every
   * unanswered field says so on the field itself.
   */
  const [showErrors, setShowErrors] = useState(false);
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
  return (
    <>
      <AgentAssistanceRequest now={now} workspace={workspace} />
      <section aria-labelledby="review-heading" className={styles["stagePanel"]}>
        <div className={styles["sectionHeading"]}>
          <div>
            <p className={styles["eyebrow"]}>Not submitted yet</p>
            <h2 id="review-heading">Application details</h2>
          </div>
          <p className={styles["completion"]} data-ready={readiness.readyForReview}>
            {readiness.readyForReview
              ? `${String(readiness.completed)} of ${String(readiness.required)} details ready`
              : `${String(missingFields.length)} ${missingFields.length === 1 ? "detail" : "details"} needed`}
          </p>
        </div>
        {/*
         * Only the agent case needs a sentence here: it has to say why the
         * page is read-only. Filling in by hand needs none — the counter
         * beside the title already says what is left.
         */}
        {agentAssisted ? (
          <p className={styles["sectionIntro"]}>
            {readiness.readyForReview
              ? "Review the application here. This page stays read-only while agent assistance is active; ask your agent to change anything before the final decision."
              : "Your agent still needs information. Answer in your agent app; this page stays read-only while assistance is active."}
          </p>
        ) : null}

        {/*
         * This used to stand there from the moment the page opened, listing
         * every field as "still needed" before anyone had typed a character —
         * a warning about not having done something yet. Now it only answers
         * a failed submit, and the fields themselves carry the rest.
         */}
        {showErrors && missingFields.length > 0 ? (
          <div className={styles["missingSummary"]} role="alert">
            <strong>Still missing</strong>
            <span>{missingFields.map(({ label }) => label).join(" · ")}</span>
          </div>
        ) : null}

        {/*
         * Both house rules sit above the fields: what has to be answered, and
         * what happens to an answer once it is typed. The saving line used to
         * be underneath the last field, where it arrives after the fact.
         */}
        <p className={styles["requiredNote"]}>Required unless marked optional.</p>
        {agentAssisted ? null : (
          <p aria-live="polite" className={styles["saveStatus"]}>
            {saveState === "saving"
              ? "Saving changes…"
              : saveState === "error"
                ? "Changes could not be saved. Leave the field again to retry."
                : saveState === "saved"
                  ? "Changes saved."
                  : "Saves when you move to the next field."}
          </p>
        )}

        {/*
         * A real form, so Enter submits and the browser treats this as one
         * thing. The submit button lives outside the section and reaches it
         * through its `form` attribute.
         */}
        <form
          className={styles["fields"]}
          id="application-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if (!readiness.readyForReview) {
              setShowErrors(true);
              const first = readiness.missingFieldKeys[0];
              if (first !== undefined) document.getElementById(`application-${first}`)?.focus();
              return;
            }
            onAction("review_and_submit");
          }}
        >
          {/*
           * Short answers first, the written one last. In source order the
           * cover letter sits mid-list, and once it spans both columns the
           * field after it is stranded alone beside an empty cell.
           */}
          {[...workspace.requirements]
            .sort((a, b) => Number(a.input === "textarea") - Number(b.input === "textarea"))
            .map((field) => (
              <ApplicationField
                fieldKey={field.fieldKey}
                fieldValues={fieldValues}
                key={field.fieldKey}
                onFieldChange={onFieldChange}
                {...(onFieldCommit === undefined ? {} : { onFieldCommit })}
                readOnly={agentAssisted}
                showErrors={showErrors}
                workspace={workspace}
              />
            ))}
        </form>

        <section aria-labelledby="sharing-heading" className={styles["sharingSummary"]}>
          <div className={styles["sharingTitle"]}>
            <ShieldCheckIcon aria-hidden="true" weight="fill" />
            <h3 id="sharing-heading">What this application will send</h3>
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
            {/*
             * Only when an agent is involved. The plain case said the same
             * thing the line under the submit button says, one screen-inch
             * apart; the agent case makes a claim nothing else on the page
             * makes, so it stays.
             */}
            {agentAssisted ? (
              <div>
                <dt>Your control</dt>
                <dd>
                  Your agent can submit only this unchanged application after your final decision.
                </dd>
              </div>
            ) : null}
          </dl>
          <Link className={styles["privacyLink"]} href="/privacy">
            Read our privacy notice
          </Link>
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
            {/*
             * Enabled even when the form is incomplete. A greyed-out button
             * cannot say what is wrong: pressing it is how a person asks, and
             * the answer belongs on the fields that are empty.
             */}
            <button
              aria-describedby="application-submit-guidance"
              aria-busy={busy}
              className={styles["primaryAction"]}
              disabled={busy}
              form="application-form"
              type="submit"
            >
              {busy ? "Submitting…" : `Submit to ${workspace.recipient.name}`}
            </button>
            {busy ? (
              <p aria-live="polite" id="application-submit-guidance" role="status">
                Submitting your application.
              </p>
            ) : (
              <p id="application-submit-guidance">
                {readiness.readyForReview
                  ? "Nothing is sent until this final action succeeds."
                  : `Complete ${String(missingFields.length)} required ${missingFields.length === 1 ? "detail" : "details"} before submitting.`}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function SubmittedApplicationSnapshot({
  workspace,
  fields,
}: Readonly<{
  workspace: ApplicationWorkspace;
  fields: SubmittedReceipt["submission"]["fields"];
}>) {
  /*
   * The same order and the same shape as the form the person just filled in:
   * short answers in two columns, the written one last and full width. The
   * receipt is the form with the boxes taken away, so nothing has to be
   * re-learned to check it.
   */
  const formOrder = [...workspace.requirements]
    .sort((a, b) => Number(a.input === "textarea") - Number(b.input === "textarea"))
    .map((field) => field.fieldKey);
  const wide = new Set(
    workspace.requirements
      .filter((field) => field.input === "textarea")
      .map((field) => field.fieldKey),
  );
  wide.add("motivation");
  const rank = (fieldKey: string) => {
    const index = formOrder.indexOf(fieldKey);
    return index === -1 ? formOrder.length : index;
  };
  const presentedFields = fields
    .flatMap((field) => {
      const value = submittedAnswerValue(field.value);
      return value === null
        ? []
        : [
            {
              ...field,
              label: field.fieldKey === "motivation" ? "Cover letter" : field.label,
              value,
            },
          ];
    })
    .sort((a, b) => rank(a.fieldKey) - rank(b.fieldKey));

  return (
    <section
      aria-labelledby="submitted-application-heading"
      className={styles["submittedSnapshot"]}
    >
      <h3 id="submitted-application-heading">What was sent</h3>
      {presentedFields.length === 0 ? (
        <p>No application fields were included.</p>
      ) : (
        <dl className={styles["sentFields"]}>
          {presentedFields.map((field) => (
            <div data-wide={wide.has(field.fieldKey)} key={field.fieldKey}>
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
  /*
   * A person either sent this themselves or let their agent send it; the
   * receipt says which. Only the data decision's channel can tell — an earlier
   * delegation proves nothing, since access can end and the person can then
   * finish here by hand. Without a recorded channel the receipt does not guess.
   */
  const channel = workspace.dataGrant?.decisionChannel;
  const submittedBy =
    channel === "agent_client"
      ? "Submitted through your agent"
      : channel === "first_party_ui"
        ? "Submitted by you"
        : "Submitted";
  return (
    <section aria-labelledby="complete-heading" className={styles["stagePanel"]}>
      <CheckCircleIcon aria-hidden="true" className={styles["completeIcon"]} weight="fill" />
      <p className={styles["eyebrow"]}>{handedOff ? "Next step" : submittedBy}</p>
      <h2 id="complete-heading">
        {handedOff
          ? "Ready to continue on the employer's website"
          : `Sent to ${submission?.recipient.name ?? "the saved demo recipient"}`}
      </h2>
      {handedOff ? (
        <p className={styles["receiptDate"]}>
          Prepared <time dateTime={receipt.createdAt}>{receiptTimestamp(receipt.createdAt)}</time>
        </p>
      ) : null}
      <p className={styles["sectionIntro"]}>
        {handedOff ? (
          "Jobbbler did not submit this application. It prepared the reviewed details for the exact employer link below."
        ) : (
          <>
            This is a Jobbbler demo, so the application went to Jobbbler&apos;s demo inbox for{" "}
            {submission?.recipient.name ?? "the saved demo recipient"}, not to the employer.
          </>
        )}
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
          <SubmittedApplicationSnapshot fields={submission.fields} workspace={workspace} />
          {/*
           * The references are for support and for the agent's audit trail,
           * not for reading. Folded, as the employer-link details already are.
           */}
          <details className={styles["technicalDetails"]}>
            <summary>Receipt details</summary>
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
                <dt>Role</dt>
                <dd>{submission.role.title}</dd>
              </div>
              <div>
                <dt>Job ID</dt>
                <dd>{submission.role.id}</dd>
              </div>
              <div>
                <dt>Receipt reference</dt>
                <dd>{submission.providerReferenceId}</dd>
              </div>
            </dl>
          </details>
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
            ? "Application submitted"
            : handedOff
              ? "Continue on the employer's website"
              : missingReceipt
                ? "Application status"
                : closedDraft
                  ? "Role closed — nothing submitted."
                  : legacyExternalDraft
                    ? "Older external application"
                    : /*
                       * The employment type already has its own place on the
                       * role, and every other surface strips it out of the
                       * title. Left in, this heading read "Application for
                       * Infrastructure Engineer, Monitoring (Part-Time)".
                       */
                      `Application for ${titleWithoutEmploymentSuffix(job.title, job.employmentType)}`}
        </h1>
        <p className={styles["heroSub"]}>
          {submittedReceipt !== null
            ? `${titleWithoutEmploymentSuffix(submittedReceipt.submission.role.title)} · ${submittedReceipt.submission.recipient.name}`
            : terminal
              ? `${job.title} · ${job.organizationName}`
              : closedDraft
                ? `${job.title} · ${job.organizationName} · Read-only`
                : legacyExternalDraft
                  ? `${job.title} · ${job.organizationName}`
                  : "Complete the form below. Nothing is sent until you choose Submit."}
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
