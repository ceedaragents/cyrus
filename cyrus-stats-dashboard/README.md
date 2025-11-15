# 🚀 Cyrus Stats Dashboard - The Ultimate Analytics Platform

A beautiful, real-time analytics dashboard for monitoring Cyrus AI agent activity. Built with modern web technologies and designed for performance, usability, and visual appeal.

![Dashboard Preview](https://via.placeholder.com/1200x600/3b82f6/ffffff?text=Cyrus+Stats+Dashboard)

## ✨ Features

### 📊 Comprehensive Analytics
- **Executive Overview** - Key metrics at a glance: total sessions, success rate, costs, token usage
- **Time Series Analysis** - Track activity, costs, and tokens over time
- **Model Distribution** - Visualize usage between Sonnet 4.5 and Haiku 3.5
- **Procedure Breakdown** - Understand which workflows are most common
- **Tool Usage Analytics** - See which tools are used most frequently
- **Session Explorer** - Detailed view of recent sessions with full metadata

### 🎨 Modern UI/UX
- **Dark Mode** - Toggle between light and dark themes
- **Responsive Design** - Works beautifully on desktop, tablet, and mobile
- **Smooth Animations** - Polished fade-in effects and transitions
- **Real-time Updates** - Auto-refreshes every 30 seconds
- **Accessible** - WCAG AA compliant with semantic HTML

### ⚡ Performance
- **Fast Loading** - Optimized bundle with code splitting
- **Efficient Rendering** - React 19 with optimized re-renders
- **Smart Caching** - Minimal API calls with intelligent data fetching
- **Lightweight** - Minimal dependencies, maximum performance

## 🛠️ Tech Stack

### Frontend
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type-safe development
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first CSS framework
- **Recharts 3.0** - Modern, accessible data visualization
- **date-fns** - Lightweight date formatting

### Backend
- **Node.js** - Simple HTTP server for API
- **Native Modules** - Zero external dependencies for the API

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ or npm
- Access to Cyrus state files at `~/.cyrus/state/edge-worker-state.json`

### Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Dashboard**

   **Option A: Start both frontend and backend together**
   ```bash
   npm start
   ```

   **Option B: Start them separately**
   ```bash
   # Terminal 1: Start the API server
   npm run server

   # Terminal 2: Start the frontend
   npm run dev
   ```

3. **Open in Browser**

   Navigate to [http://localhost:3001](http://localhost:3001)

## 📖 Usage

### Dashboard Sections

#### Overview Cards
Four key metrics displayed prominently:
- **Total Sessions** - Total count with active session indicator
- **Success Rate** - Percentage of completed sessions
- **Total Cost** - Cumulative API costs in USD
- **Total Tokens** - Total tokens processed

#### Activity Over Time
Line chart showing:
- Session count trends
- Cost trends over time
- Automatic date formatting

#### Model Distribution
Pie chart breaking down usage by model:
- Sonnet 4.5 (advanced reasoning)
- Haiku 3.5 (fast responses)

#### Procedure Types
Bar chart showing frequency of different procedures:
- simple-question
- feature-implementation
- bug-fix
- code-review
- And more...

#### Top Tools Used
Horizontal bar chart of most-used tools:
- Read, Edit, Write
- Bash, Grep, Glob
- Linear MCP tools
- And more...

#### Recent Sessions Table
Detailed table with:
- Issue identifier and title
- Session status (complete, active, error)
- Procedure type
- Model used
- Duration
- Cost
- Time ago

### Dark Mode

Click the "🌙 Dark" / "☀️ Light" button in the header to toggle between themes. Your preference persists across sessions.

### Auto-Refresh

The dashboard automatically refreshes data every 30 seconds to show the latest activity. No manual refresh needed!

## 📁 Project Structure

```
cyrus-stats-dashboard/
├── src/
│   ├── components/
│   │   └── Dashboard.tsx      # Main dashboard component
│   ├── lib/
│   │   └── stats.ts           # Data loading and formatting utilities
│   ├── App.tsx                # Root component
│   ├── main.tsx               # React entry point
│   └── index.css              # Global styles and Tailwind
├── server.js                  # Backend API server
├── index.html                 # HTML template
├── package.json               # Dependencies and scripts
├── vite.config.ts             # Vite configuration
├── tailwind.config.js         # Tailwind configuration
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

## 🔧 Configuration

### API Server Port
The API server runs on port 3002 by default. To change this, edit `server.js`:

```javascript
const PORT = 3002; // Change to your desired port
```

### Frontend Port
The frontend runs on port 3001 by default. To change this, edit `vite.config.ts`:

```typescript
export default defineConfig({
  server: {
    port: 3001, // Change to your desired port
  },
})
```

### Data Source
The dashboard reads from `~/.cyrus/state/edge-worker-state.json` by default. To change this, edit `server.js`:

```javascript
const statePath = join(homedir(), '.cyrus', 'state', 'edge-worker-state.json');
```

## 🚢 Deployment

### Production Build

```bash
npm run build
```

This creates an optimized production build in the `dist/` directory.

### Serve Production Build

```bash
npm run preview
```

### Deploy to Vercel/Netlify

The dashboard is a standard Vite app and can be deployed to any static hosting service:

1. Build the app: `npm run build`
2. Deploy the `dist/` directory
3. Ensure the API server is running separately and update the API URL in `src/lib/stats.ts`

### Docker Deployment (Optional)

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3001 3002
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t cyrus-dashboard .
docker run -p 3001:3001 -p 3002:3002 -v ~/.cyrus:/root/.cyrus cyrus-dashboard
```

## 🎯 Future Enhancements

Potential improvements for future versions:

- [ ] **Historical Trends** - Store historical data in a database
- [ ] **Alerts & Notifications** - Set up alerts for errors or high costs
- [ ] **Advanced Filtering** - Filter by date range, model, procedure, etc.
- [ ] **Session Drill-down** - Click sessions to view detailed logs
- [ ] **Export Data** - Export stats as CSV, JSON, or PDF
- [ ] **Multi-User Support** - Authentication and user-specific dashboards
- [ ] **WebSocket Updates** - Real-time updates without polling
- [ ] **Custom Dashboards** - Build custom views with drag-and-drop
- [ ] **Cost Predictions** - ML-powered cost forecasting
- [ ] **Performance Benchmarks** - Compare performance across time periods

## 🤝 Contributing

This dashboard was built as part of the Cyrus project. Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

Built with:
- [React](https://react.dev/) - UI framework
- [Vite](https://vite.dev/) - Build tool
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework
- [Recharts](https://recharts.org/) - Chart library
- [date-fns](https://date-fns.org/) - Date utilities

Designed following best practices from:
- [UXPin Dashboard Design Principles](https://www.uxpin.com/studio/blog/dashboard-design-principles/)
- [Recharts 3.0 Documentation](https://recharts.org/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

---

**Built with ❤️ for the Cyrus project**

For questions or issues, please open an issue on GitHub.
