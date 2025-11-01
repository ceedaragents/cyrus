# Browser Demo UI Design Principles

This document defines the Apple-grade design standards for the Cyrus browser demo emulator. These principles ensure a sophisticated, professional interface that matches the quality of macOS and iOS applications.

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Typography System](#typography-system)
3. [Spacing System](#spacing-system)
4. [Color Palette](#color-palette)
5. [Visual Hierarchy](#visual-hierarchy)
6. [Liquid Glass Effects](#liquid-glass-effects)
7. [Interaction Patterns](#interaction-patterns)
8. [Component Design Patterns](#component-design-patterns)
9. [Animation and Motion](#animation-and-motion)
10. [Testing Principles](#testing-principles)
11. [Accessibility](#accessibility)
12. [Responsive Design](#responsive-design)

---

## Design Philosophy

The browser demo follows Apple's design language with these core principles:

- **Clarity**: Content is paramount. Subtle UI elements support the content without overwhelming it.
- **Deference**: Crisp, beautiful interfaces that recede to let content shine.
- **Depth**: Visual layers and realistic motion provide hierarchy and vitality.
- **Sophistication**: Polish in every detail, from color choices to animation curves.

### Key Tenets

1. **System Fonts First**: Use native system fonts (SF Pro) for optimal rendering
2. **Minimal Contrast**: Subtle borders and shadows create depth without harsh lines
3. **Semantic Color**: Colors convey meaning (blue = action, green = success, red = error)
4. **Generous Spacing**: White space is a design element, not wasted space
5. **Motion with Purpose**: Animations guide attention and confirm actions

---

## Typography System

### Font Stack

The demo uses **SF Pro** (Apple's system font) with comprehensive fallbacks:

```css
/* UI Text */
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text',
             'Segoe UI', 'Helvetica Neue', Arial, sans-serif;

/* Display Text (Headings) */
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display',
             'Segoe UI', 'Helvetica Neue', Arial, sans-serif;

/* Monospace (Code) */
font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
```

**Reference**: `public/index.html:82-83` (body), `public/index.html:112` (headers), `public/index.html:238` (code)

### Type Scale

Following Apple's Human Interface Guidelines:

| Element | Size | Weight | Line Height | Letter Spacing | Reference |
|---------|------|--------|-------------|----------------|-----------|
| **Large Title** | 28px | 600 | 1.3 | -0.6px | `index.html:114-116` |
| **Title** | 16px | 600 | 1.5 | 0 | `index.html:489-490` |
| **Body** | 14-15px | 400 | 1.6 | 0 | `index.html:92-93` |
| **Caption** | 13px | 400-600 | 1.5 | 0 | `index.html:208` |
| **Small** | 12px | 400 | 1.4 | 0 | `index.html:654` |
| **Uppercase Label** | 13px | 600 | 1.2 | 0.6px | `index.html:208-211` |

### Typography Rules

1. **Font Weight**:
   - Regular (400): Body text, descriptions
   - Semibold (600): Headings, labels, buttons
   - Never use bold (700) - too heavy for SF Pro

2. **Letter Spacing**:
   - Large headings: Negative (-0.6px) for optical balance
   - Uppercase text: Positive (0.6px) for readability
   - Body text: 0px (default)

3. **Font Smoothing**:
   ```css
   -webkit-font-smoothing: antialiased;
   -moz-osx-font-smoothing: grayscale;
   ```
   **Reference**: `index.html:90-91`

4. **Monospace Usage**:
   - Issue IDs, session IDs: `index.html:238-239`
   - Code blocks: `index.html:524-526`
   - Numeric data (with tabular-nums): `index.html:304`

---

## Spacing System

### The 320% Principle

**CRITICAL**: The browser demo uses a **320% spacing increase** compared to typical web applications. This creates the generous, uncluttered feel of macOS applications.

### Base Spacing Scale

| Token | Value | Usage | Reference |
|-------|-------|-------|-----------|
| `xxs` | 4px | Timeline dots, small icons | `index.html:310` |
| `xs` | 8px | Inline gaps, tight spacing | `index.html:129` |
| `sm` | 12px | Component internal spacing | `index.html:213` |
| `md` | 16px | Card padding, form elements | `index.html:220` |
| `lg` | 20px | Section spacing | `index.html:463` |
| `xl` | 24px | Container padding | `index.html:104` |
| `2xl` | 32px | Major sections | `index.html:204` |
| `3xl` | 40px | Page-level spacing | `index.html:104` |

### Practical Application

**Container Padding**: 40px (desktop) → 24px (mobile)
```css
.activities-container {
    padding: 40px;
}
@media (max-width: 768px) {
    padding: 24px;
}
```
**Reference**: `index.html:372`, `index.html:818`

**Card Internal Spacing**: 20px
```css
.activity.tool-call {
    padding: 20px;
}
```
**Reference**: `index.html:463`

**Vertical Section Spacing**: 32px between sidebar sections
```css
.sidebar-section {
    margin-bottom: 32px;
}
```
**Reference**: `index.html:204`

### Spacing Philosophy

1. **Never use spacing below 8px** except for borders (1px) and micro-adjustments
2. **Default gap**: 12px for related elements
3. **Section gap**: 24-40px for major sections
4. **Breathing room**: Always prefer more space over less

---

## Color Palette

### Dual-Mode System

The browser demo implements a sophisticated dual-mode color system that adapts to light/dark preferences **automatically**.

### Light Mode Palette

```css
:root {
    /* Backgrounds */
    --bg-primary: #FAFAFA;        /* Page background */
    --bg-secondary: #FFFFFF;      /* Card backgrounds */
    --bg-tertiary: #F5F5F7;       /* Input fields, code */
    --bg-elevated: rgba(255, 255, 255, 0.8);  /* Glass effect */
    --bg-code: #F5F5F7;

    /* Borders */
    --border-color: rgba(0, 0, 0, 0.06);
    --border-subtle: rgba(0, 0, 0, 0.04);

    /* Text */
    --text-primary: #1D1D1F;      /* Body text */
    --text-secondary: #86868B;    /* Supporting text */
    --text-tertiary: #A1A1A6;     /* Disabled text */

    /* Accents */
    --accent-blue: #007AFF;
    --accent-blue-light: #E5F2FF;
    --accent-green: #34C759;
    --accent-green-light: #E8F8EB;
    --accent-red: #FF3B30;
    --accent-red-light: #FFE5E3;
    --accent-orange: #FF9500;
    --accent-purple: #AF52DE;
}
```
**Reference**: `index.html:18-44`

### Dark Mode Palette

```css
@media (prefers-color-scheme: dark) {
    :root {
        /* Backgrounds - System Grays (NOT terminal theme) */
        --bg-primary: #000000;
        --bg-secondary: #1C1C1E;
        --bg-tertiary: #2C2C2E;
        --bg-elevated: rgba(28, 28, 30, 0.8);

        /* Borders */
        --border-color: rgba(255, 255, 255, 0.08);
        --border-subtle: rgba(255, 255, 255, 0.04);

        /* Text */
        --text-primary: #F5F5F7;
        --text-secondary: #98989D;
        --text-tertiary: #636366;

        /* Accents - Brighter for dark backgrounds */
        --accent-blue: #0A84FF;
        --accent-green: #30D158;
        --accent-red: #FF453A;
        --accent-orange: #FF9F0A;
        --accent-purple: #BF5AF2;
    }
}
```
**Reference**: `index.html:46-71`

### Color Usage Rules

1. **Semantic Colors**:
   - Blue: Primary actions, links, focus states
   - Green: Success, completion, positive actions
   - Red: Errors, destructive actions, warnings
   - Orange: Warnings, attention needed
   - Purple: User-generated content, avatars

2. **Background Layers**:
   - Primary: Base page color
   - Secondary: Cards and containers
   - Tertiary: Input fields, disabled states
   - Elevated: Glass effect overlays (with backdrop-filter)

3. **Border Opacity**:
   - Standard: `rgba(0, 0, 0, 0.06)` - visible separators
   - Subtle: `rgba(0, 0, 0, 0.04)` - minimal dividers
   - **Never use solid borders** except for focus states

4. **Text Hierarchy**:
   - Primary: Main content, headings
   - Secondary: Supporting text, metadata
   - Tertiary: Disabled text, placeholders

---

## Visual Hierarchy

### Shadow System

Subtle, multi-layered shadows create depth without harshness:

```css
/* Small - Buttons, small cards */
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04),
             0 1px 2px rgba(0, 0, 0, 0.02);

/* Medium - Cards on hover, dropdowns */
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06),
             0 2px 6px rgba(0, 0, 0, 0.03);

/* Large - Modals, drawers */
--shadow-lg: 0 12px 48px rgba(0, 0, 0, 0.08),
             0 4px 16px rgba(0, 0, 0, 0.04);
```
**Reference**: `index.html:38-40`

**Dark Mode Adjustments**: Shadows are stronger in dark mode
```css
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4),
             0 1px 2px rgba(0, 0, 0, 0.3);
```
**Reference**: `index.html:67-69`

### Border Radius

Rounded corners follow Apple's hierarchy:

| Element | Radius | Reference |
|---------|--------|-----------|
| Small UI (buttons, badges) | 6-8px | `index.html:246` |
| Cards, inputs | 10-12px | `index.html:462`, `index.html:687` |
| Avatars, dots | 50% (circle) | `index.html:256` |

### Layout Hierarchy

1. **Header**: Fixed height, glass effect, always visible
2. **Two-column layout**: 320px sidebar + flexible main content
3. **Sidebar**: Sticky, scrollable independently
4. **Main content**: Flex container with scrollable activities and fixed input

---

## Liquid Glass Effects

### Backdrop Filter

The signature "liquid glass" effect uses `backdrop-filter` for translucent surfaces:

```css
.header {
    background: var(--bg-elevated); /* Semi-transparent white/dark */
    backdrop-filter: var(--blur-glass); /* blur(20px) */
    -webkit-backdrop-filter: var(--blur-glass);
}
```
**Reference**: `index.html:100-102`

### Glass Effect Recipe

1. **Semi-transparent background**: `rgba(255, 255, 255, 0.8)`
2. **Backdrop blur**: `blur(20px)`
3. **Subtle border**: `1px solid rgba(0, 0, 0, 0.06)`
4. **Light shadow**: `var(--shadow-sm)`

### Usage Guidelines

- **Headers/Navbars**: Full glass effect for overlaying content
- **Modals**: Glass background for depth perception
- **Floating elements**: Buttons, tooltips over content
- **Never on body**: Only on elevated UI elements

**Critical**: Always include `-webkit-backdrop-filter` for Safari support.

---

## Interaction Patterns

### Hover States

Consistent hover behavior across all interactive elements:

```css
.btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
}
```
**Reference**: `index.html:717-720`

**Rules**:
- Lift up (translateY(-1px)) for buttons
- Increase shadow depth
- Color shift for secondary elements
- Respect `:disabled` state

### Active States

Pressed/clicked feedback:

```css
.btn:active:not(:disabled) {
    transform: translateY(0);
}
```
**Reference**: `index.html:722-724`

### Focus States

Accessible, prominent focus indicators:

```css
*:focus-visible {
    outline: 3px solid var(--accent-blue);
    outline-offset: 2px;
}
```
**Reference**: `index.html:837-840`

**Input Focus**:
```css
.input-field:focus {
    outline: none;
    border-color: var(--accent-blue);
    box-shadow: 0 0 0 3px var(--accent-blue-light);
    background: var(--bg-secondary);
}
```
**Reference**: `index.html:693-698`

### Disabled States

Consistent visual feedback for disabled elements:

```css
.btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}
```
**Reference**: `index.html:746-749`

### Transition Timing

Two primary easing functions:

```css
/* Spring - Interactive elements */
--transition-spring: cubic-bezier(0.4, 0.0, 0.2, 1);

/* Smooth - Layout changes */
--transition-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);
```
**Reference**: `index.html:42-43`

**Application**:
- Buttons, clicks: 0.2s spring
- Hovers: 0.3s smooth
- Layout: 0.3s smooth
- Color changes: 0.5s smooth

---

## Component Design Patterns

### Semantic Activity Types

The browser demo uses **semantic activity types** instead of technical classifications:

| Type | Visual Style | Purpose | Reference |
|------|-------------|---------|-----------|
| `thought` | Minimal, italic, left border | Agent reasoning | `index.html:431-456` |
| `tool-call` | Prominent card, expandable | Tool execution | `index.html:459-557` |
| `result` | Color-coded badge | Success/error feedback | `index.html:560-587` |
| `user-msg` | User avatar, light background | User input | `index.html:590-628` |
| `system-evt` | Timeline marker, subdued | System events | `index.html:631-650` |

### THOUGHT Activity

**Design**: Minimal, transparent background with subtle left border

```css
.activity.thought {
    padding: 12px 20px;
    background: transparent;
    border-left: 2px solid var(--border-subtle);
}

.activity.thought .activity-content {
    font-style: italic;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.6;
    max-width: 65ch; /* Optimal reading width */
}
```
**Reference**: `index.html:431-443`

**Icon**: `~` (tilde) to represent thinking
**Purpose**: Shows agent's internal reasoning without overwhelming the UI

### TOOL_CALL Activity

**Design**: Prominent card with hover elevation, collapsible output

```css
.activity.tool-call {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 20px;
    box-shadow: var(--shadow-sm);
    transition: box-shadow 0.3s var(--transition-smooth);
}

.activity.tool-call:hover {
    box-shadow: var(--shadow-md);
}
```
**Reference**: `index.html:459-470`

**Features**:
- Expandable output (collapsed by default)
- Copy button for code snippets
- Syntax highlighting with Prism.js
- Tool icon (⚙) for visual identification

### RESULT Activity

**Design**: Inline badge with semantic color

```css
.activity.result.success {
    background: var(--accent-green-light);
    color: var(--accent-green);
}

.activity.result.error {
    background: var(--accent-red-light);
    color: var(--accent-red);
}
```
**Reference**: `index.html:569-577`

**Icons**: ✓ (success) / ✗ (error)

### USER_MSG Activity

**Design**: User avatar with light background

```css
.activity.user-msg {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 16px 20px;
}

.activity.user-msg .user-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent-purple);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 12px;
}
```
**Reference**: `index.html:590-615`

### SYSTEM_EVT Activity

**Design**: Timeline marker with dot

```css
.activity.system-evt {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    opacity: 0.7;
}

.activity.system-evt .system-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-tertiary);
}
```
**Reference**: `index.html:631-645`

**Purpose**: Non-intrusive markers for session start/end

### Sidebar Components

**Session Info Card**:
```css
.session-info {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 16px;
}
```
**Reference**: `index.html:217-221`

**State Badge**:
```css
.session-state-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
}

.session-state-badge.running::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse-dot 2s ease-in-out infinite;
}
```
**Reference**: `index.html:241-267`

**Timeline Scrubber**:
```css
.timeline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border-color);
    cursor: pointer;
    transition: all 0.2s var(--transition-smooth);
}

.timeline-dot:hover {
    background: var(--accent-blue);
    transform: scale(1.5);
}

.timeline-dot.active {
    background: var(--accent-blue);
    box-shadow: 0 0 8px var(--accent-blue);
}
```
**Reference**: `index.html:314-331`

---

## Animation and Motion

### Entry Animations

Staggered fade-in for activities:

```css
@keyframes fade-in-up {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.activity {
    animation: fade-in-up 0.4s var(--transition-spring) backwards;
}

/* Stagger animation for consecutive activities */
.activity:nth-last-child(1) { animation-delay: 0.05s; }
.activity:nth-last-child(2) { animation-delay: 0.1s; }
.activity:nth-last-child(3) { animation-delay: 0.15s; }
```
**Reference**: `index.html:402-419`

### Pulse Animation

For live status indicators:

```css
@keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
}

.connection-status.connected::before {
    animation: pulse-dot 2.5s ease-in-out infinite;
}
```
**Reference**: `index.html:159-162`

### Highlight Animation

For scroll-to-activity navigation:

```css
@keyframes highlight-pulse {
    0%, 100% { background: transparent; }
    50% { background: var(--accent-blue-light); }
}

.activity.highlight {
    animation: highlight-pulse 1s ease-out;
}
```
**Reference**: `index.html:421-428`

### Reduced Motion

Respect accessibility preferences:

```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
```
**Reference**: `index.html:73-79`

---

## Testing Principles

### "Test the Limits"

**Philosophy**: The browser demo must handle extreme scenarios gracefully. Don't just test happy paths—push the UI to its breaking point.

#### Test Scenarios

1. **Volume Testing**:
   - 1000+ activities in a single session
   - Rapid-fire activity updates (10/second)
   - Very long tool outputs (100KB+)
   - Deep nesting levels

2. **Edge Cases**:
   - Empty states (no activities, no session)
   - Network disconnection/reconnection
   - Malformed data from WebSocket
   - Unicode in all text fields
   - XSS attempts in user input

3. **Performance Testing**:
   - Scroll performance with 1000+ DOM nodes
   - Memory leaks over long sessions
   - Animation performance on low-end devices
   - Concurrent sessions (multiple tabs)

4. **Responsive Testing**:
   - Mobile devices (320px width)
   - Tablets (768px, 1024px)
   - Desktop (1920px+)
   - Ultra-wide monitors (3440px+)
   - Orientation changes

### "Test Exhaustively"

**Philosophy**: Every interaction, every state, every code path must be verified. Manual testing is required—automated tests cannot catch visual regressions.

#### Testing Checklist

**Visual Testing**:
- [ ] All activity types render correctly
- [ ] Hover states work on all interactive elements
- [ ] Focus states are visible and accessible
- [ ] Dark mode colors are correct
- [ ] Transitions are smooth (no jank)
- [ ] Scrollbars are styled consistently
- [ ] Print view is usable

**Interaction Testing**:
- [ ] Expand/collapse all tool calls
- [ ] Copy button feedback works
- [ ] Timeline navigation scrolls to activities
- [ ] Sidebar toggle (mobile) works smoothly
- [ ] Message input submits on Enter
- [ ] Stop button immediately halts execution
- [ ] Export session downloads correct data
- [ ] Share button works (or shows fallback)

**State Testing**:
- [ ] Initial load (no session)
- [ ] Session active (running)
- [ ] Session complete (finished)
- [ ] Session error (failed)
- [ ] WebSocket connected
- [ ] WebSocket disconnected
- [ ] WebSocket reconnecting

**Browser Testing**:
- [ ] Safari (macOS, iOS)
- [ ] Chrome (desktop, Android)
- [ ] Firefox (desktop)
- [ ] Edge (desktop)

### Testing Tools

**Manual Testing**: Primary method
- **Browser DevTools**: Network, Performance, Console
- **Responsive Design Mode**: Test all breakpoints
- **Accessibility Inspector**: Verify ARIA labels, keyboard nav

**Automated Testing**: Secondary verification
- **Playwright MCP**: Use for browser automation (see CLAUDE.md:Linear Create Issue Process)
- **Visual Regression**: Screenshots at key states

### Screenshot Preferences for Testing

**Philosophy**: When taking screenshots for testing or verification, prefer targeted, element-specific screenshots over full-page captures. This makes it easier to focus on specific UI elements and ensures the code structure matches the documented selectors.

#### Screenshot Guidelines

1. **Use Element Selectors When Possible**:
   - Target specific DOM elements using CSS selectors
   - Example: `.activity.tool-call` for tool call cards
   - Example: `.session-status` for session status badge
   - Reduces noise and focuses on the element being tested

2. **Selector Documentation Must Match Code**:
   - All documented selectors in CLAUDE.md must exist in `public/index.html` or `public/app.js`
   - Keep the "Browser Demo Interactive Element Selectors" section up-to-date
   - Test selectors work correctly: `document.querySelector('.selector')`

3. **When to Use Full-Page Screenshots**:
   - Initial load verification
   - Layout/responsive testing
   - Overall visual regression testing
   - When context around an element matters

4. **When to Use Targeted Screenshots**:
   - Verifying specific tool rendering (Read, Edit, Bash, etc.)
   - Testing individual components (modals, buttons, inputs)
   - Focusing on interaction states (hover, focus, expanded/collapsed)
   - Documenting bugs or unexpected behavior

5. **Screenshot Naming Convention**:
   - Descriptive names: `read-tool-expanded.png` not `screenshot1.png`
   - Include state: `edit-tool-collapsed.png` vs `edit-tool-expanded.png`
   - Include timestamp if multiple captures: `modal-2025-11-01T02-45-10.png`

#### Using Playwright MCP for Screenshots

**Full Page**:
```javascript
mcp__playwright__playwright_screenshot({
  name: "full-page-view",
  fullPage: true
})
```

**Targeted Element** (Preferred):
```javascript
mcp__playwright__playwright_screenshot({
  name: "read-tool-expanded",
  selector: ".activity.tool-call .read-tool" // Target specific element
})
```

**Note**: While Playwright MCP's `selector` parameter may have limitations with complex selectors like `:has()` or `:contains()`, always attempt targeted screenshots first. Fall back to full-page screenshots only when necessary, then crop mentally/visually when reviewing.

### Performance Targets

- **First Contentful Paint**: < 1s
- **Time to Interactive**: < 2s
- **Scroll performance**: 60fps with 500 activities
- **Memory usage**: < 100MB for typical session
- **WebSocket latency**: < 50ms for activity render

---

## Accessibility

### ARIA Landmarks

```html
<div class="header" role="banner">
<aside class="sidebar" role="complementary">
<main class="main-content" role="main">
<div class="input-container" role="region" aria-label="User input">
```
**Reference**: `index.html:863`, `index.html:874`, `index.html:929`, `index.html:936`

### Live Regions

```html
<div class="connection-status" role="status" aria-live="polite">
<div class="activities-container" role="log" aria-live="polite" aria-atomic="false">
```
**Reference**: `index.html:866`, `index.html:930`

### Keyboard Navigation

- **Tab order**: Logical flow through sidebar → activities → input
- **Focus visible**: 3px blue outline on all interactive elements
- **Enter key**: Submits message input
- **Escape key**: (Future) Closes modals, sidebar

### Screen Reader Support

- Button labels: `aria-label="Toggle sidebar"`
- Input labels: Associated with `<label for="messageInput">`
- Dynamic content: `aria-live="polite"` for non-intrusive updates
- Status changes: `role="status"` for connection state

### Color Contrast

All text meets WCAG AA standards:

- Primary text on primary bg: 11.5:1
- Secondary text on primary bg: 4.8:1
- Blue accent on white: 4.6:1
- Error red on white bg: 5.2:1

---

## Responsive Design

### Breakpoints

| Breakpoint | Width | Layout Changes | Reference |
|------------|-------|----------------|-----------|
| Mobile | ≤ 768px | Sidebar becomes drawer, single column | `index.html:808-832` |
| Tablet | 769px - 1024px | Sidebar overlays content | `index.html:771-800` |
| Desktop | ≥ 1025px | Two-column layout, sidebar visible | Default |

### Mobile Adaptations

**Sidebar Drawer**:
```css
@media (max-width: 1024px) {
    .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        transform: translateX(-100%);
        transition: transform 0.3s var(--transition-smooth);
        z-index: 200;
        box-shadow: var(--shadow-lg);
    }

    .sidebar.open {
        transform: translateX(0);
    }
}
```
**Reference**: `index.html:771-784`

**Reduced Padding**:
```css
@media (max-width: 768px) {
    .header {
        padding: 20px 24px; /* vs 24px 40px */
    }

    .activities-container {
        padding: 24px; /* vs 40px */
    }
}
```
**Reference**: `index.html:809-819`

**Stacked Input**:
```css
@media (max-width: 768px) {
    .input-controls {
        flex-direction: column;
    }

    .btn {
        width: 100%;
    }
}
```
**Reference**: `index.html:825-831`

### Responsive Typography

No font size changes—maintain readability at all screen sizes. Only adjust spacing and layout.

### Touch Targets

All interactive elements meet Apple's 44x44pt minimum:

- Buttons: 44px height minimum
- Timeline dots: 8px visual, 44px touch area (padding)
- Sidebar toggle: 44px minimum

---

## Code Organization

### CSS Structure

The demo uses a single-file CSS approach with clear sections:

1. **Reset & Globals** (`index.html:12-16`)
2. **CSS Variables** (`index.html:18-71`)
3. **Accessibility** (`index.html:73-79`)
4. **Base Styles** (`index.html:81-94`)
5. **Header** (`index.html:96-163`)
6. **Layout** (`index.html:165-172`)
7. **Sidebar** (`index.html:174-356`)
8. **Main Content** (`index.html:358-396`)
9. **Activity Components** (`index.html:398-657`)
10. **Input Container** (`index.html:659-749`)
11. **Responsive** (`index.html:771-832`)
12. **Print Styles** (`index.html:845-853`)

### Variable Naming

Follow CSS custom property conventions:

- **Descriptive**: `--bg-primary`, `--text-secondary`
- **Hierarchical**: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
- **Semantic**: `--accent-blue`, `--accent-green` (not `--color-1`)

### Comments

Use section headers for navigation:

```css
/* ============================================
   SECTION NAME
   ============================================ */
```

---

## Design Patterns Summary

### When to Use Each Pattern

| Pattern | Use Case | Example |
|---------|----------|---------|
| **Glass Effect** | Overlays, floating headers | Header, modals |
| **Card** | Grouped content, tool calls | Activity cards |
| **Inline Badge** | Status, labels, tags | Session state, results |
| **Transparent** | Minimal UI, thoughts | Thought activities |
| **Timeline Marker** | Events, transitions | System events |

### Consistency Rules

1. **Border radius**: 8px (small), 12px (medium), never mix
2. **Shadow**: Always use CSS variables, never inline values
3. **Transitions**: Always include timing function
4. **Colors**: Always use CSS variables, never hex codes in styles
5. **Spacing**: Always use multiples of 4px

### Future Enhancements

As the browser demo evolves, maintain these standards:

- **New components**: Follow existing semantic types
- **New colors**: Add to CSS variables with light/dark variants
- **New interactions**: Use established transition timing
- **New layouts**: Respect the spacing system (320% principle)

---

## Examples and Code References

### Complete Activity Type Implementation

See `public/app.js:253-436` for full semantic activity type rendering:

```javascript
determineSemanticType(activity) {
    const type = activity.type.toLowerCase();

    if (type.includes('thought') || type === 'text') {
        return 'thought';
    }
    if (type.includes('tool') || type === 'tool-use') {
        return 'tool-call';
    }
    if (type === 'complete') {
        return 'result';
    }
    // ... more type mappings
}
```

### Glass Effect Header

See `public/index.html:99-109`:

```css
.header {
    background: var(--bg-elevated);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border-bottom: 1px solid var(--border-color);
    padding: 24px 40px;
    box-shadow: var(--shadow-sm);
}
```

### Responsive Sidebar

See `public/index.html:177-200`:

```css
.sidebar {
    position: sticky;
    top: 0;
    width: 320px;
    height: 100vh;
    overflow-y: auto;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    padding: 40px 24px;
}
```

### Interactive Timeline

See `public/app.js:528-559`:

```javascript
scrollToActivity(activityId) {
    const activity = document.getElementById(`activity-${activityId}`);
    if (activity) {
        activity.scrollIntoView({ behavior: 'smooth', block: 'center' });
        activity.classList.add('highlight');
        setTimeout(() => activity.classList.remove('highlight'), 2000);
    }
}
```

---

## Conclusion

These design principles ensure the Cyrus browser demo maintains Apple-grade quality. Every pixel, every transition, every color choice is intentional and follows established patterns.

**Remember**: Design is not just what it looks like—it's how it works. Test exhaustively, push the limits, and maintain these standards as the demo evolves.

For questions or clarifications, refer to the source files:
- **HTML/CSS**: `apps/browser-demo/public/index.html`
- **JavaScript**: `apps/browser-demo/public/app.js`
- **Architecture**: `CLAUDE.md` (root level)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-31
**Maintained By**: Cyrus Development Team
