import { storageMode } from "@/lib/store";
import { jiraConfigured } from "@/lib/jira";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main>
      <h1>Flock TM MCP</h1>
      <ul>
        <li>Endpoint TM: <code>/tm/mcp?key=TM_KEY</code></li>
        <li>Endpoint equipo: <code>/team/mcp?key=TEAM_KEY</code></li>
        <li>Storage: {storageMode}</li>
        <li>Jira: {jiraConfigured() ? "configurado" : "falta configurar"}</li>
        <li>Slack: {process.env.SLACK_BOT_TOKEN ? "configurado" : "falta configurar"}</li>
      </ul>
    </main>
  );
}
