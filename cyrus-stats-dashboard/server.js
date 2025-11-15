import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const PORT = 3002;

async function loadEdgeWorkerState() {
  try {
    const statePath = join(homedir(), '.cyrus', 'state', 'edge-worker-state.json');
    const content = await readFile(statePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load edge worker state:', error);
    return null;
  }
}

function processStats(state) {
  if (!state?.state?.agentSessions) {
    return getEmptyStats();
  }

  const allSessions = [];
  const dateMap = new Map();
  const procedureMap = new Map();
  const modelMap = new Map();
  const toolMap = new Map();

  // Process all sessions from all repositories
  for (const [_repoId, sessions] of Object.entries(state.state.agentSessions)) {
    for (const [sessionId, session] of Object.entries(sessions)) {
      const durationMs = session.updatedAt - session.createdAt;
      const totalTokens =
        (session.metadata?.usage?.input_tokens || 0) +
        (session.metadata?.usage?.cache_creation_input_tokens || 0) +
        (session.metadata?.usage?.cache_read_input_tokens || 0) +
        (session.metadata?.usage?.output_tokens || 0);

      const metrics = {
        id: sessionId,
        issueId: session.issueId,
        issueIdentifier: session.issue?.identifier || 'Unknown',
        issueTitle: session.issue?.title || 'Unknown',
        status: session.status,
        model: session.metadata?.model || 'unknown',
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        durationMs,
        totalCostUsd: session.metadata?.totalCostUsd || 0,
        usage: {
          input_tokens: session.metadata?.usage?.input_tokens || 0,
          cache_creation_input_tokens: session.metadata?.usage?.cache_creation_input_tokens || 0,
          cache_read_input_tokens: session.metadata?.usage?.cache_read_input_tokens || 0,
          output_tokens: session.metadata?.usage?.output_tokens || 0,
        },
        procedure: session.metadata?.procedure,
        tools: session.metadata?.tools || [],
      };

      allSessions.push(metrics);

      // Aggregate by date
      const dateKey = new Date(session.createdAt).toISOString().split('T')[0];
      const dateEntry = dateMap.get(dateKey) || { sessions: 0, cost: 0, tokens: 0 };
      dateEntry.sessions++;
      dateEntry.cost += metrics.totalCostUsd;
      dateEntry.tokens += totalTokens;
      dateMap.set(dateKey, dateEntry);

      // Aggregate by procedure
      if (metrics.procedure) {
        const procKey = metrics.procedure.procedureName;
        const procEntry = procedureMap.get(procKey) || { count: 0, totalDuration: 0, totalCost: 0 };
        procEntry.count++;
        procEntry.totalDuration += durationMs;
        procEntry.totalCost += metrics.totalCostUsd;
        procedureMap.set(procKey, procEntry);
      }

      // Aggregate by model
      const modelEntry = modelMap.get(metrics.model) || { count: 0, totalCost: 0, totalTokens: 0 };
      modelEntry.count++;
      modelEntry.totalCost += metrics.totalCostUsd;
      modelEntry.totalTokens += totalTokens;
      modelMap.set(metrics.model, modelEntry);

      // Aggregate tool usage
      for (const tool of metrics.tools) {
        toolMap.set(tool, (toolMap.get(tool) || 0) + 1);
      }
    }
  }

  // Sort sessions by creation date (newest first)
  allSessions.sort((a, b) => b.createdAt - a.createdAt);

  // Calculate overview stats
  const completedSessions = allSessions.filter((s) => s.status === 'complete').length;
  const activeSessions = allSessions.filter((s) => s.status === 'active').length;
  const totalCost = allSessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  const totalTokens = allSessions.reduce(
    (sum, s) =>
      sum +
      s.usage.input_tokens +
      s.usage.cache_creation_input_tokens +
      s.usage.cache_read_input_tokens +
      s.usage.output_tokens,
    0,
  );
  const avgSessionDuration =
    allSessions.length > 0 ? allSessions.reduce((sum, s) => sum + s.durationMs, 0) / allSessions.length : 0;

  // Get unique issues
  const uniqueIssues = new Set(allSessions.map((s) => s.issueId));

  // Convert maps to arrays
  const timeSeriesData = Array.from(dateMap.entries())
    .map(([date, data]) => ({
      date,
      ...data,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const procedureBreakdown = Array.from(procedureMap.entries()).map(([name, data]) => ({
    name,
    count: data.count,
    avgDuration: data.totalDuration / data.count,
    avgCost: data.totalCost / data.count,
  }));

  const modelBreakdown = Array.from(modelMap.entries()).map(([model, data]) => ({
    model: model.includes('sonnet') ? 'Sonnet 4.5' : model.includes('haiku') ? 'Haiku 3.5' : model,
    ...data,
  }));

  const totalToolUses = Array.from(toolMap.values()).reduce((sum, count) => sum + count, 0);
  const toolUsage = Array.from(toolMap.entries())
    .map(([tool, count]) => ({
      tool,
      count,
      percentage: (count / totalToolUses) * 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Top 20 tools

  return {
    overview: {
      totalSessions: allSessions.length,
      completedSessions,
      activeSessions,
      totalIssues: uniqueIssues.size,
      totalCost,
      totalTokens,
      avgSessionDuration,
      successRate: allSessions.length > 0 ? (completedSessions / allSessions.length) * 100 : 0,
    },
    sessions: allSessions,
    timeSeriesData,
    procedureBreakdown,
    modelBreakdown,
    toolUsage,
    recentSessions: allSessions.slice(0, 10),
  };
}

function getEmptyStats() {
  return {
    overview: {
      totalSessions: 0,
      completedSessions: 0,
      activeSessions: 0,
      totalIssues: 0,
      totalCost: 0,
      totalTokens: 0,
      avgSessionDuration: 0,
      successRate: 0,
    },
    sessions: [],
    timeSeriesData: [],
    procedureBreakdown: [],
    modelBreakdown: [],
    toolUsage: [],
    recentSessions: [],
  };
}

const server = createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/api/stats' && req.method === 'GET') {
    try {
      const state = await loadEdgeWorkerState();
      const stats = processStats(state);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (error) {
      console.error('Error processing stats:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to load stats' }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Stats API server running on http://localhost:${PORT}`);
  console.log(`Serving stats from: ${join(homedir(), '.cyrus', 'state', 'edge-worker-state.json')}`);
});
