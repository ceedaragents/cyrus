import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  DashboardStats,
  loadStats,
  formatCost,
  formatTokens,
  formatDuration,
  formatTimeAgo,
} from '../lib/stats';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'];

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load real stats from API
    loadStats()
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load stats:', err);
        setLoading(false);
      });

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadStats().then(setStats).catch(console.error);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">No data available</p>
        </div>
      </div>
    );
  }

  const { overview } = stats;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Cyrus Analytics Dashboard
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Real-time insights into your AI agent activity
              </p>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="px-4 py-2 rounded-lg border bg-background hover:bg-accent transition-colors"
            >
              {darkMode ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="stat-card animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Sessions</p>
                <p className="text-3xl font-bold mt-2">{overview.totalSessions}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {overview.activeSessions} active
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <span className="text-2xl">📊</span>
              </div>
            </div>
          </div>

          <div className="stat-card animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
                <p className="text-3xl font-bold mt-2">{overview.successRate.toFixed(1)}%</p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  {overview.completedSessions} completed
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                <span className="text-2xl">✅</span>
              </div>
            </div>
          </div>

          <div className="stat-card animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Cost</p>
                <p className="text-3xl font-bold mt-2">{formatCost(overview.totalCost)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Avg: {formatCost(overview.totalCost / overview.totalSessions)}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                <span className="text-2xl">💰</span>
              </div>
            </div>
          </div>

          <div className="stat-card animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Tokens</p>
                <p className="text-3xl font-bold mt-2">{formatTokens(overview.totalTokens)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Avg: {formatTokens(Math.floor(overview.totalTokens / overview.totalSessions))}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center">
                <span className="text-2xl">🔤</span>
              </div>
            </div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Time Series Chart */}
          <div className="chart-container animate-fade-in" style={{ animationDelay: '0.4s' }}>
            <h3 className="text-lg font-semibold mb-4">Activity Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={stats.timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="sessions"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  name="Sessions"
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  name="Cost ($)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Model Breakdown */}
          <div className="chart-container animate-fade-in" style={{ animationDelay: '0.5s' }}>
            <h3 className="text-lg font-semibold mb-4">Model Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={stats.modelBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry: any) => `${entry.model}: ${entry.count}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {stats.modelBreakdown.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Procedure Breakdown */}
          <div className="chart-container animate-fade-in" style={{ animationDelay: '0.6s' }}>
            <h3 className="text-lg font-semibold mb-4">Procedure Types</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.procedureBreakdown}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                  }}
                />
                <Legend />
                <Bar dataKey="count" fill="#3b82f6" name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top Tools */}
          <div className="chart-container animate-fade-in" style={{ animationDelay: '0.7s' }}>
            <h3 className="text-lg font-semibold mb-4">Top Tools Used</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.toolUsage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" className="text-xs" />
                <YAxis dataKey="tool" type="category" className="text-xs" width={100} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                  }}
                />
                <Bar dataKey="count" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Sessions Table */}
        <div className="chart-container animate-fade-in" style={{ animationDelay: '0.8s' }}>
          <h3 className="text-lg font-semibold mb-4">Recent Sessions</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-sm">Issue</th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">Procedure</th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">Model</th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">Duration</th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">Cost</th>
                  <th className="text-left py-3 px-4 font-semibold text-sm">Time</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentSessions.map((session) => (
                  <tr key={session.id} className="border-b hover:bg-accent/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium">{session.issueIdentifier}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-xs">
                        {session.issueTitle}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`badge ${
                          session.status === 'complete'
                            ? 'badge-success'
                            : session.status === 'active'
                              ? 'badge-info'
                              : 'badge-warning'
                        }`}
                      >
                        {session.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm">{session.procedure?.procedureName || 'N/A'}</td>
                    <td className="py-3 px-4 text-sm">
                      {session.model.includes('sonnet') ? '🧠 Sonnet' : '⚡ Haiku'}
                    </td>
                    <td className="py-3 px-4 text-sm">{formatDuration(session.durationMs)}</td>
                    <td className="py-3 px-4 text-sm font-mono">{formatCost(session.totalCostUsd)}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {formatTimeAgo(session.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>Last updated: {new Date().toLocaleString()}</p>
          <p className="mt-2">
            Built with ❤️ using React, TypeScript, Tailwind CSS, and Recharts
          </p>
        </div>
      </main>
    </div>
  );
}
