Enhanced Linear API Caching with Rate Limit Header Integration │
     │                                                                │
     │ Overview                                                       │
     │                                                                │
     │ Implement intelligent rate limiting and caching system using   │
     │ Linear's rate limit headers to prevent API exhaustion while    │
     │ maintaining functionality.                                     │
     │                                                                │
     │ Root Cause Analysis                                            │
     │                                                                │
     │ The rate limiting issue is hitting the request count limit     │
     │ (1,200 requests/window), not complexity limits. The system is  │
     │ making too many individual API calls, especially for agent     │
     │ activities.                                                    │
     │                                                                │
     │ Implementation Plan                                            │
     │                                                                │
     │ 1. Rate Limit Tracking Infrastructure                          │
     │                                                                │
     │ - Create RateLimitTracker class that parses Linear's rate limit│
     │  headers:                                                      │
     │   - x-ratelimit-requests-remaining (critical metric)           │
     │   - x-ratelimit-requests-reset (reset timestamp)               │
     │ - Integrate header parsing into all Linear API calls           │
     │ - Implement predictive rate limiting based on current usage    │
     │ patterns                                                       │
     │                                                                │
     │ 2. Priority-Based Request Management                           │
     │                                                                │
     │ - Priority 1: Critical operations (initial issue fetching, user│
     │  acknowledgments)                                              │
     │ - Priority 2: Normal operations (progress updates, state       │
     │ changes)                                                       │
     │ - Priority 3: Low priority (batched thoughts, status updates)  │
     │ - Queue system that respects rate limits and prioritizes       │
     │ essential operations                                           │
     │                                                                │
     │ 3. Intelligent Activity Batching                               │
     │                                                                │
     │ - Dynamic batching based on remaining rate limit:              │
     │   - Normal mode (>300 remaining): 500ms batching               │
     │   - Conservative mode (100-300 remaining): 2s batching         │
     │   - Emergency mode (<100 remaining): 5s aggressive batching    │
     │ - Combine multiple thoughts/activities into single API calls   │
     │ where possible                                                 │
     │                                                                │
     │ 4. Smart Issue Caching with Fallbacks                          │
     │                                                                │
     │ - Cache issue details with longer TTL (10 minutes)             │
     │ - When rate limited, return stale cached data rather than      │
     │ failing                                                        │
     │ - Implement cache warming for frequently accessed issues       │
     │ - Webhook-based cache invalidation to maintain data freshness  │
     │                                                                │
     │ 5. Graceful Degradation Strategy                               │
     │                                                                │
     │ - Circuit breaker pattern for non-critical operations          │
     │ - Fallback to cached data when rate limited                    │
     │ - User-facing operations get priority over background tasks    │
     │ - Clear error messaging when operations are delayed due to rate│
     │  limits                                                        │
     │                                                                │
     │ 6. Integration Points                                          │
     │                                                                │
     │ - Wrap all linearClient calls with rate limit tracking         │
     │ - Replace direct createAgentActivity calls with queued/batched │
     │ versions                                                       │
     │ - Add rate limit monitoring to webhook processing              │
     │ - Implement exponential backoff for rate limited requests      │
     │                                                                │
     │ Expected Outcomes                                              │
     │                                                                │
     │ - Eliminate "rate limit exceeded" errors                       │
     │ - Maintain responsive user experience even under rate limits   │
     │ - Intelligent resource usage based on available API quota      │
     │ - Graceful degradation when approaching limits                 │
     │                                                                │
     │ Monitoring & Observability                                     │
     │                                                                │
     │ - Log rate limit status and predictions                        │
     │ - Track cache hit ratios and API call reduction                │
     │ - Monitor queue depths and batching effectiveness              │
     │ - Alert when approaching rate limits
