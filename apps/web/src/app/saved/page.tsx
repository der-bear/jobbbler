import type { Metadata } from "next";
import { Suspense } from "react";

import { SavedWorkspace } from "@/features/saved/saved-workspace";
import styles from "@/features/saved/saved-workspace.module.css";

export const metadata: Metadata = {
  title: "Saved searches",
  description: "Create durable, explainable technology-job alerts with a verified delivery path.",
};

export default function SavedPage() {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className={styles["workspace"]}>
          <div className={styles["loading"]} role="status">
            <span />
            Preparing your private workspace…
          </div>
        </div>
      }
    >
      <SavedWorkspace />
    </Suspense>
  );
}
