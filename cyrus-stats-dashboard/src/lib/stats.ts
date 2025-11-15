import { formatDistanceToNow, format } from 'date-fns';

export interface SessionMetrics {
  id: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  status: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  totalCostUsd: number;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  procedure?: {
    procedureName: string;
    currentSubroutineIndex: number;
    subroutineHistory: Array<{
      subroutine: string;
      completedAt: number;
      claudeSessionId: string | null;
    }>;
  };
  tools: string[];
}

export interface DashboardStats {
  overview: {
    totalSessions: number;
    completedSessions: number;
    activeSessions: number;
    totalIssues: number;
    totalCost: number;
    totalTokens: number;
    avgSessionDuration: number;
    successRate: number;
  };
  sessions: SessionMetrics[];
  timeSeriesData: {
    date: string;
    sessions: number;
    cost: number;
    tokens: number;
  }[];
  procedureBreakdown: {
    name: string;
    count: number;
    avgDuration: number;
    avgCost: number;
  }[];
  modelBreakdown: {
    model: string;
    count: number;
    totalCost: number;
    totalTokens: number;
  }[];
  toolUsage: {
    tool: string;
    count: number;
    percentage: number;
  }[];
  recentSessions: SessionMetrics[];
}

export async function loadStats(): Promise<DashboardStats> {
  try {
    // Fetch from backend API server
    const response = await fetch('http://localhost:3002/api/stats');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to load stats:', error);
    // Fall back to mock data if API is unavailable
    console.warn('Falling back to mock data...');
    return generateMockStats();
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function formatTimeAgo(timestamp: number): string {
  return formatDistanceToNow(timestamp, { addSuffix: true });
}

export function formatDate(timestamp: number): string {
  return format(timestamp, 'MMM d, yyyy HH:mm');
}

// Mock data generator for development
export function generateMockStats(): DashboardStats {
  const mockSessions: SessionMetrics[] = [];
  const now = Date.now();

  for (let i = 0; i < 50; i++) {
    const createdAt = now - (i * 3600000); // 1 hour apart
    const durationMs = Math.random() * 1800000; // 0-30 minutes
    const updatedAt = createdAt + durationMs;

    mockSessions.push({
      id: `session-${i}`,
      issueId: `issue-${Math.floor(i / 3)}`,
      issueIdentifier: `CYRUS-${1000 + Math.floor(i / 3)}`,
      issueTitle: `Issue title ${Math.floor(i / 3)}`,
      status: Math.random() > 0.2 ? 'complete' : 'active',
      model: Math.random() > 0.3 ? 'claude-sonnet-4-5-20250929' : 'claude-3-5-haiku-20241022',
      createdAt,
      updatedAt,
      durationMs,
      totalCostUsd: Math.random() * 0.05,
      usage: {
        input_tokens: Math.floor(Math.random() * 10000),
        cache_creation_input_tokens: Math.floor(Math.random() * 20000),
        cache_read_input_tokens: Math.floor(Math.random() * 50000),
        output_tokens: Math.floor(Math.random() * 5000),
      },
      procedure: {
        procedureName: ['simple-question', 'feature-implementation', 'bug-fix', 'code-review'][Math.floor(Math.random() * 4)],
        currentSubroutineIndex: 0,
        subroutineHistory: [],
      },
      tools: ['Read', 'Edit', 'Bash', 'Grep', 'Write'].slice(0, Math.floor(Math.random() * 5) + 1),
    });
  }

  // Aggregate data
  const dateMap = new Map<string, { sessions: number; cost: number; tokens: number }>();
  const procedureMap = new Map<string, { count: number; totalDuration: number; totalCost: number }>();
  const modelMap = new Map<string, { count: number; totalCost: number; totalTokens: number }>();
  const toolMap = new Map<string, number>();

  for (const session of mockSessions) {
    const dateKey = format(session.createdAt, 'yyyy-MM-dd');
    const dateEntry = dateMap.get(dateKey) || { sessions: 0, cost: 0, tokens: 0 };
    const totalTokens = session.usage.input_tokens + session.usage.cache_creation_input_tokens +
                       session.usage.cache_read_input_tokens + session.usage.output_tokens;
    dateEntry.sessions++;
    dateEntry.cost += session.totalCostUsd;
    dateEntry.tokens += totalTokens;
    dateMap.set(dateKey, dateEntry);

    if (session.procedure) {
      const procKey = session.procedure.procedureName;
      const procEntry = procedureMap.get(procKey) || { count: 0, totalDuration: 0, totalCost: 0 };
      procEntry.count++;
      procEntry.totalDuration += session.durationMs;
      procEntry.totalCost += session.totalCostUsd;
      procedureMap.set(procKey, procEntry);
    }

    const modelEntry = modelMap.get(session.model) || { count: 0, totalCost: 0, totalTokens: 0 };
    modelEntry.count++;
    modelEntry.totalCost += session.totalCostUsd;
    modelEntry.totalTokens += totalTokens;
    modelMap.set(session.model, modelEntry);

    for (const tool of session.tools) {
      toolMap.set(tool, (toolMap.get(tool) || 0) + 1);
    }
  }

  const completedSessions = mockSessions.filter(s => s.status === 'complete').length;
  const totalCost = mockSessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  const totalTokens = mockSessions.reduce((sum, s) =>
    sum + s.usage.input_tokens + s.usage.cache_creation_input_tokens +
    s.usage.cache_read_input_tokens + s.usage.output_tokens, 0);
  const avgDuration = mockSessions.reduce((sum, s) => sum + s.durationMs, 0) / mockSessions.length;

  return {
    overview: {
      totalSessions: mockSessions.length,
      completedSessions,
      activeSessions: mockSessions.length - completedSessions,
      totalIssues: new Set(mockSessions.map(s => s.issueId)).size,
      totalCost,
      totalTokens,
      avgSessionDuration: avgDuration,
      successRate: (completedSessions / mockSessions.length) * 100,
    },
    sessions: mockSessions,
    timeSeriesData: Array.from(dateMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    procedureBreakdown: Array.from(procedureMap.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      avgDuration: data.totalDuration / data.count,
      avgCost: data.totalCost / data.count,
    })),
    modelBreakdown: Array.from(modelMap.entries()).map(([model, data]) => ({
      model: model.includes('sonnet') ? 'Sonnet 4.5' : 'Haiku 3.5',
      ...data,
    })),
    toolUsage: Array.from(toolMap.entries())
      .map(([tool, count]) => ({
        tool,
        count,
        percentage: (count / mockSessions.length) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    recentSessions: mockSessions.slice(0, 10),
  };
}
