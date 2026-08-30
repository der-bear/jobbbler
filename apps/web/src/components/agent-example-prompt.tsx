"use client";

import { useEffect, useState } from "react";

import { agentExamplePrompt } from "@/lib/agent-example";

import { CopyPromptButton } from "./copy-prompt-button";

export function AgentExamplePrompt({
  className,
  promptClassName,
}: Readonly<{
  className?: string | undefined;
  promptClassName?: string | undefined;
}>) {
  const [prompt, setPrompt] = useState(() => agentExamplePrompt());

  useEffect(() => {
    setPrompt(agentExamplePrompt(window.location.origin));
  }, []);

  return (
    <div className={className}>
      <blockquote className={promptClassName}>{prompt}</blockquote>
      <CopyPromptButton compact text={prompt} />
    </div>
  );
}
