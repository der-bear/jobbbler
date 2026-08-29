import {
  ArrowLeftIcon,
  CheckCircleIcon,
  FileTextIcon,
  HandshakeIcon,
  LockKeyIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";

import type { ApplicationWorkspace, Job } from "@jobbbler/contracts";

import {
  applicationDisclosure,
  applicationStage,
  visibleApplicationProgress,
  type ApplicationStage,
} from "./application-model";
import styles from "./application-view.module.css";

export type ApplicationAction =
  | "use_demo_profile"
  | "save_profile"
  | "validate"
  | "review"
  | "request_data_grant"
  | "approve_data_grant"
  | "withdraw_data_grant"
  | "approve_delegation"
  | "revoke_delegation"
  | "request_confirmation"
  | "submit"
  | "handoff";

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

const stageOrder: readonly ApplicationStage[] = ["profile", "review", "permission", "confirmation"];

const stageLabels: Readonly<Record<ApplicationStage, string>> = {
  profile: "Your details",
  review: "Review",
  permission: "Permission",
  confirmation: "Final confirmation",
  complete: "Complete",
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (character) => character.toUpperCase());
}

function answerValue(workspace: ApplicationWorkspace, fieldKey: string): string {
  const value = workspace.draft.answers.find((answer) => answer.fieldKey === fieldKey)?.value;
  if (value === null || value === undefined) return "Not provided";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function currentStepIndex(stage: ApplicationStage): number {
  if (stage === "complete") return stageOrder.length;
  return stageOrder.indexOf(stage);
}

function Progress({ stage }: Readonly<{ stage: ApplicationStage }>) {
  const current = currentStepIndex(stage);
  return (
    <ol aria-label="Application progress" className={styles["progress"]}>
      {stageOrder.map((item, index) => (
        <li
          aria-current={stage === item ? "step" : undefined}
          className={index < current ? styles["completeStep"] : undefined}
          key={item}
        >
          <span>
            {index < current ? <CheckCircleIcon aria-hidden="true" weight="fill" /> : index + 1}
          </span>
          <strong>{stageLabels[item]}</strong>
        </li>
      ))}
    </ol>
  );
}

function ProfilePanel({
  workspace,
  fieldValues,
  busy,
  onFieldChange,
  onAction,
}: Pick<
  ApplicationViewProps,
  "workspace" | "fieldValues" | "busy" | "onFieldChange" | "onAction"
>) {
  const progress = visibleApplicationProgress(workspace);
  return (
    <section aria-labelledby="profile-heading" className={styles["stagePanel"]}>
      <div className={styles["sectionHeading"]}>
        <div>
          <p className={styles["eyebrow"]}>Step 1 of 4</p>
          <h2 id="profile-heading">Your details</h2>
        </div>
        <p className={styles["completion"]}>
          {progress.completed}/{progress.required} required
        </p>
      </div>
      <p className={styles["sectionIntro"]}>
        Facts and agent suggestions stay visibly distinct. Nothing suggested by an agent counts as
        accepted until you approve or edit it here.
      </p>
      <div className={styles["fields"]}>
        {workspace.requirements.map((field) => {
          const answer = workspace.draft.answers.find(
            (candidate) => candidate.fieldKey === field.fieldKey,
          );
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
            <div className={styles["field"]} key={field.fieldKey}>
              <div className={styles["fieldLabel"]}>
                <label htmlFor={shared.id}>{field.label}</label>
                <span>
                  {field.required ? "Required" : "Optional"}
                  {field.sensitive ? " · Private" : ""}
                </span>
              </div>
              <p>{field.description}</p>
              {field.input === "textarea" ? (
                <textarea {...shared} maxLength={10_000} rows={5} />
              ) : field.input === "select" ? (
                <select {...shared}>
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
                  type={field.input}
                />
              )}
              {answer?.provenance === "agent_suggestion" && !answer.acceptedByHuman ? (
                <span className={styles["suggestion"]}>
                  <PencilSimpleIcon aria-hidden="true" /> Needs your acceptance
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={styles["actions"]}>
        <button disabled={busy} onClick={() => onAction("use_demo_profile")} type="button">
          Use privacy-safe demo profile
        </button>
        <button disabled={busy} onClick={() => onAction("save_profile")} type="button">
          Save facts
        </button>
        <button
          className={styles["primaryAction"]}
          disabled={busy || progress.completed < progress.required}
          onClick={() => onAction("validate")}
          type="button"
        >
          Validate application
        </button>
      </div>
    </section>
  );
}

function ReviewPanel({
  workspace,
  busy,
  onAction,
}: Pick<ApplicationViewProps, "workspace" | "busy" | "onAction">) {
  return (
    <section aria-labelledby="review-heading" className={styles["stagePanel"]}>
      <p className={styles["eyebrow"]}>Step 2 of 4</p>
      <h2 id="review-heading">Review what will be shared</h2>
      <p className={styles["sectionIntro"]}>
        This exact version is what permission and the final confirmation refer to. If you change
        anything important, you will review again.
      </p>
      <dl className={styles["reviewList"]}>
        {workspace.requirements.map((field) => (
          <div key={field.fieldKey}>
            <dt>
              {field.label}
              <span>{field.sensitive ? "Private" : "Application answer"}</span>
            </dt>
            <dd>{answerValue(workspace, field.fieldKey)}</dd>
          </div>
        ))}
      </dl>
      <div className={styles["actions"]}>
        <button
          className={styles["primaryAction"]}
          disabled={busy}
          onClick={() => onAction("review")}
          type="button"
        >
          <FileTextIcon aria-hidden="true" /> Lock this review
        </button>
      </div>
    </section>
  );
}

function PermissionPanel({
  workspace,
  busy,
  onAction,
}: Pick<ApplicationViewProps, "workspace" | "busy" | "onAction">) {
  const disclosure = applicationDisclosure(workspace);
  const requested = workspace.dataGrant?.status === "requested";
  return (
    <section aria-labelledby="permission-heading" className={styles["stagePanel"]}>
      <p className={styles["eyebrow"]}>Step 3 of 4</p>
      <h2 id="permission-heading">Approve what gets shared</h2>
      <p className={styles["sectionIntro"]}>
        Permission applies only to this exact application — what is shared, with whom, and why. It
        is separate from what your agent may do.
      </p>
      <dl className={styles["permissionGrid"]}>
        <div>
          <dt>Recipient</dt>
          <dd>{workspace.recipient.name}</dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd>{workspace.purpose}</dd>
        </div>
        <div>
          <dt>Data categories</dt>
          <dd>{disclosure.categories.map(humanize).join(" · ")}</dd>
        </div>
        <div>
          <dt>Fields</dt>
          <dd>{disclosure.fieldKeys.map(humanize).join(" · ")}</dd>
        </div>
        <div>
          <dt>Legal basis</dt>
          <dd>{humanize(workspace.legalBasis)}</dd>
        </div>
        <div>
          <dt>Notice</dt>
          <dd>{workspace.noticeVersion}</dd>
        </div>
      </dl>
      <p className={styles["permissionNote"]}>
        <ShieldCheckIcon aria-hidden="true" weight="fill" /> You can withdraw this permission until
        the application is submitted.
      </p>
      <div className={styles["actions"]}>
        <button
          className={styles["primaryAction"]}
          disabled={busy}
          onClick={() => onAction(requested ? "approve_data_grant" : "request_data_grant")}
          type="button"
        >
          {requested ? "Approve this disclosure" : "Review permission request"}
        </button>
      </div>
    </section>
  );
}

function ConfirmationPanel({
  workspace,
  job,
  confirmation,
  busy,
  onAction,
}: Pick<ApplicationViewProps, "workspace" | "job" | "confirmation" | "busy" | "onAction">) {
  const externalHandoff = job.applyMode === "external";
  return (
    <section aria-labelledby="confirmation-heading" className={styles["stagePanel"]}>
      <p className={styles["eyebrow"]}>Step 4 of 4</p>
      <h2 id="confirmation-heading" tabIndex={-1}>
        One last human check
      </h2>
      <p className={styles["sectionIntro"]}>
        {externalHandoff
          ? "This records that your reviewed application is ready to continue on the employer's website. Jobbbler will not submit it or open the site for you."
          : "Only you can do this step. The confirmation covers the locked review exactly, expires after five minutes, and works once."}
      </p>
      <div className={styles["confirmationCard"]}>
        <LockKeyIcon aria-hidden="true" weight="fill" />
        <div>
          <strong>
            {confirmation === null ? "Confirmation not issued" : "Confirmation ready"}
          </strong>
          <p>
            {confirmation === null
              ? `Review the application for ${workspace.recipient.name}, then create a short-lived confirmation.`
              : `Valid until ${new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(new Date(confirmation.expiresAt))}.`}
          </p>
        </div>
      </div>
      <div className={styles["actions"]}>
        <button
          className={styles["primaryAction"]}
          disabled={busy}
          onClick={() =>
            onAction(
              confirmation === null
                ? "request_confirmation"
                : externalHandoff
                  ? "handoff"
                  : "submit",
            )
          }
          type="button"
        >
          {confirmation === null ? (
            <>
              <ShieldCheckIcon aria-hidden="true" /> Confirm reviewed application
            </>
          ) : (
            <>
              <PaperPlaneTiltIcon aria-hidden="true" />
              {externalHandoff
                ? " Save the record and get the employer link"
                : ` Submit to ${workspace.recipient.name}`}
            </>
          )}
        </button>
      </div>
    </section>
  );
}

function CompletePanel({ workspace }: Readonly<{ workspace: ApplicationWorkspace }>) {
  const externalUrl =
    workspace.receipt?.status === "handed_off" ? workspace.receipt.externalUrl : null;
  return (
    <section aria-labelledby="complete-heading" className={styles["stagePanel"]}>
      <CheckCircleIcon aria-hidden="true" className={styles["completeIcon"]} weight="fill" />
      <p className={styles["eyebrow"]}>Done</p>
      <h2 id="complete-heading">
        {workspace.receipt?.status === "handed_off"
          ? "Ready to continue on the employer's website"
          : "Application submitted"}
      </h2>
      <p className={styles["sectionIntro"]}>
        A record of what you approved is saved in your private workspace. Your agent never received
        anything it could reuse.
      </p>
      {externalUrl === null ? null : (
        <>
          <p className={styles["sectionIntro"]}>
            Jobbbler did not submit this application. Select the exact source link below when you
            are ready to continue there.
          </p>
          <a className={styles["primaryLink"]} href={externalUrl} rel="noreferrer" target="_blank">
            Continue on the employer's website
          </a>
        </>
      )}
      <Link className={styles["primaryLink"]} href="/saved">
        Return to saved work
      </Link>
    </section>
  );
}

function TrustRail({
  workspace,
  confirmation,
  busy,
  onAction,
}: Pick<ApplicationViewProps, "workspace" | "confirmation" | "busy" | "onAction">) {
  const activeDelegations = workspace.delegationRequests.filter(
    ({ status }) => status === "active",
  );
  const pendingDelegation = workspace.delegationRequests.find(
    ({ status }) => status === "requested",
  );
  return (
    <aside aria-label="Application safeguards" className={styles["trustRail"]}>
      <div>
        <ShieldCheckIcon aria-hidden="true" />
        <p className={styles["eyebrow"]}>Sharing permission</p>
        <strong>
          {workspace.dataGrant?.status === "active"
            ? "Approved for this exact application"
            : "Not approved"}
        </strong>
        <span>Covers exactly what is shared, with whom, and why — nothing else.</span>
        {workspace.dataGrant?.status === "active" && workspace.receipt === null ? (
          <button
            className={styles["railAction"]}
            disabled={busy}
            onClick={() => onAction("withdraw_data_grant")}
            type="button"
          >
            Withdraw permission
          </button>
        ) : null}
      </div>
      <div>
        <HandshakeIcon aria-hidden="true" />
        <p className={styles["eyebrow"]}>Assistant access</p>
        <strong>{activeDelegations.length === 0 ? "No access granted" : "Access granted"}</strong>
        <span>Your agent can only do what you allow, and only for this application.</span>
        {pendingDelegation === undefined ? null : (
          <button
            className={styles["railAction"]}
            disabled={busy}
            onClick={() => onAction("approve_delegation")}
            type="button"
          >
            Approve your agent's request
          </button>
        )}
        {activeDelegations.length === 0 || workspace.receipt !== null ? null : (
          <button
            className={styles["railAction"]}
            disabled={busy}
            onClick={() => onAction("revoke_delegation")}
            type="button"
          >
            Remove agent access
          </button>
        )}
      </div>
      <div>
        <LockKeyIcon aria-hidden="true" />
        <p className={styles["eyebrow"]}>Final confirmation</p>
        <strong>{confirmation === null ? "Required" : "Ready — works once"}</strong>
        <span>If anything important changes, you will confirm again.</span>
      </div>
    </aside>
  );
}

export function ApplicationView({
  workspace,
  job,
  fieldValues,
  confirmation,
  busy,
  error,
  onFieldChange,
  onAction,
}: ApplicationViewProps) {
  const stage = applicationStage(workspace);
  return (
    <main className={styles["page"]} id="main-content">
      <header className={styles["hero"]}>
        <Link className={styles["backLink"]} href={`/jobs/${encodeURIComponent(job.id)}`}>
          <ArrowLeftIcon aria-hidden="true" /> Back to role
        </Link>
        <h1>Review before you apply</h1>
        <p className={styles["heroSub"]}>
          See exactly what will be sent. Nothing is shared until you approve it.
        </p>
        <p className={styles["role"]}>
          <strong>{job.title}</strong> · {job.organizationName}
        </p>
      </header>
      <Progress stage={stage} />
      {error === null ? null : (
        <p className={styles["error"]} role="alert">
          <WarningCircleIcon aria-hidden="true" /> {error}
        </p>
      )}
      <div className={styles["workspace"]}>
        {stage === "profile" ? (
          <ProfilePanel
            busy={busy}
            fieldValues={fieldValues}
            onAction={onAction}
            onFieldChange={onFieldChange}
            workspace={workspace}
          />
        ) : stage === "review" ? (
          <ReviewPanel busy={busy} onAction={onAction} workspace={workspace} />
        ) : stage === "permission" ? (
          <PermissionPanel busy={busy} onAction={onAction} workspace={workspace} />
        ) : stage === "confirmation" ? (
          <ConfirmationPanel
            busy={busy}
            confirmation={confirmation}
            job={job}
            onAction={onAction}
            workspace={workspace}
          />
        ) : (
          <CompletePanel workspace={workspace} />
        )}
        <TrustRail
          busy={busy}
          confirmation={confirmation}
          onAction={onAction}
          workspace={workspace}
        />
      </div>
    </main>
  );
}
