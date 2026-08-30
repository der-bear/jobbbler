export function agentExamplePrompt(site = "this Jobbbler site"): string {
  return `Open ${site}. Help me find a technology role that fits my experience and priorities. Ask only what you need to know, then search and compare the strongest options and explain your recommendation. If I choose one, prepare the application, ask for any missing facts, and show me exactly what will be submitted before asking for my final decision.`;
}
