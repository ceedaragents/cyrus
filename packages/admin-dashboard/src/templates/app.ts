/**
 * Single-page admin dashboard — inline HTML/CSS/JS, no build step.
 * Hash-based client-side routing with dark theme.
 */
export function getDashboardHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cyrus Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;line-height:1.6}
a{color:#60a5fa;text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:900px;margin:0 auto;padding:20px}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid #262626;margin-bottom:24px}
header h1{font-size:1.25rem;font-weight:600;color:#f5f5f5}
nav{display:flex;gap:8px;flex-wrap:wrap}
nav a{padding:6px 14px;border-radius:6px;font-size:0.85rem;color:#a3a3a3;transition:background 0.15s,color 0.15s}
nav a:hover{background:#1a1a1a;color:#e5e5e5;text-decoration:none}
nav a.active{background:#1e3a5f;color:#60a5fa}
.card{background:#141414;border:1px solid #262626;border-radius:8px;padding:20px;margin-bottom:16px}
.card h2{font-size:1rem;font-weight:600;margin-bottom:12px;color:#f5f5f5}
.stat{display:inline-block;margin-right:24px;margin-bottom:8px}
.stat .label{font-size:0.75rem;color:#737373;text-transform:uppercase;letter-spacing:0.05em}
.stat .value{font-size:1.25rem;font-weight:600;color:#f5f5f5}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600}
.badge-green{background:#14532d;color:#4ade80}
.badge-yellow{background:#422006;color:#fbbf24}
.badge-red{background:#450a0a;color:#f87171}
.badge-blue{background:#1e3a5f;color:#60a5fa}
table{width:100%;border-collapse:collapse;font-size:0.85rem}
th{text-align:left;padding:8px 12px;border-bottom:1px solid #262626;color:#737373;font-weight:500;text-transform:uppercase;font-size:0.7rem;letter-spacing:0.05em}
td{padding:8px 12px;border-bottom:1px solid #1a1a1a}
input,textarea,select{background:#1a1a1a;border:1px solid #333;color:#e5e5e5;padding:8px 12px;border-radius:6px;width:100%;font-family:inherit;font-size:0.85rem}
input:focus,textarea:focus{outline:none;border-color:#60a5fa}
textarea{min-height:200px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:0.8rem;resize:vertical}
button{background:#1e3a5f;color:#60a5fa;border:1px solid #2563eb;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:0.85rem;font-family:inherit;transition:background 0.15s}
button:hover{background:#1e40af}
button.danger{background:#450a0a;color:#f87171;border-color:#dc2626}
button.danger:hover{background:#7f1d1d}
.form-group{margin-bottom:12px}
.form-group label{display:block;font-size:0.8rem;color:#a3a3a3;margin-bottom:4px}
.msg{padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:0.85rem}
.msg-ok{background:#14532d;color:#4ade80;border:1px solid #166534}
.msg-err{background:#450a0a;color:#f87171;border:1px solid #7f1d1d}
.mono{font-family:'SF Mono',Monaco,Consolas,monospace;font-size:0.8rem}
pre{background:#0a0a0a;border:1px solid #262626;border-radius:6px;padding:12px;overflow-x:auto;font-size:0.8rem;white-space:pre-wrap;word-break:break-all}
.loading{color:#737373;font-style:italic}
#page{min-height:50vh}
</style>
</head>
<body>
<div class="container">
<header>
<h1>Cyrus Admin</h1>
<nav id="nav">
<a href="#/">Status</a>
<a href="#/repos">Repositories</a>
<a href="#/auth">Linear Auth</a>
<a href="#/github">GitHub</a>
<a href="#/config">Config</a>
<a href="#/env">Environment</a>
</nav>
</header>
<div id="page"><p class="loading">Loading...</p></div>
</div>

<script>
(function(){
// ── Auth Token ──────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const urlToken = params.get('token');
if (urlToken) {
  localStorage.setItem('cyrus_admin_token', urlToken);
  // Clean URL
  history.replaceState(null, '', location.pathname + location.hash);
}
const TOKEN = localStorage.getItem('cyrus_admin_token') || '';

function api(path, opts) {
  const o = opts || {};
  const headers = Object.assign({'Authorization': 'Bearer ' + TOKEN}, o.headers || {});
  if (o.body && typeof o.body === 'string') headers['Content-Type'] = 'application/json';
  return fetch(path, Object.assign({}, o, {headers})).then(function(r) {
    if (r.status === 401) { showNoAuth(); throw new Error('unauthorized'); }
    return r.json();
  });
}

function showNoAuth() {
  document.getElementById('page').innerHTML =
    '<div class="card"><h2>Authentication Required</h2>' +
    '<p>Visit <code>/admin?token=YOUR_TOKEN</code> to authenticate.</p></div>';
}

// ── Router ──────────────────────────────────────────────────────────
const $page = document.getElementById('page');
const routes = {
  '/': renderStatus,
  '/repos': renderRepos,
  '/auth': renderAuth,
  '/github': renderGithub,
  '/config': renderConfig,
  '/env': renderEnv
};

function navigate() {
  const hash = location.hash.replace('#','') || '/';
  document.querySelectorAll('#nav a').forEach(function(a) {
    a.classList.toggle('active', a.getAttribute('href') === '#' + hash);
  });
  const fn = routes[hash] || routes['/'];
  $page.innerHTML = '<p class="loading">Loading...</p>';
  fn();
}

window.addEventListener('hashchange', navigate);
navigate();

// ── Helpers ─────────────────────────────────────────────────────────
function h(tag, attrs, children) {
  var el = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function(k) {
    if (k === 'className') el.className = attrs[k];
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else el.setAttribute(k, attrs[k]);
  });
  if (children !== undefined) {
    if (typeof children === 'string') el.textContent = children;
    else if (Array.isArray(children)) children.forEach(function(c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    else el.appendChild(children);
  }
  return el;
}

function msg(text, ok) {
  var d = h('div', {className: ok ? 'msg msg-ok' : 'msg msg-err'}, text);
  return d;
}

// ── Status Page ─────────────────────────────────────────────────────
function renderStatus() {
  api('/api/admin/status').then(function(r) {
    if (!r.success) { $page.innerHTML = ''; $page.appendChild(msg(r.error, false)); return; }
    var d = r.data;
    var card = h('div', {className:'card'}, [
      h('h2', null, 'Instance Status'),
      h('div', null, [
        stat('Version', d.version),
        stat('Repositories', d.repoCount),
        stat('Uptime', formatUptime(d.uptime)),
        stat('Node', d.nodeVersion),
        stat('Platform', d.platform)
      ])
    ]);
    $page.innerHTML = '';
    $page.appendChild(card);

    // Also fetch sessions
    api('/api/admin/sessions').then(function(s) {
      if (!s.success) return;
      var sCard = h('div', {className:'card'}, [
        h('h2', null, 'Active Sessions (' + s.data.count + ')'),
      ]);
      if (s.data.sessions.length === 0) {
        sCard.appendChild(h('p', {className:'loading'}, 'No active sessions'));
      } else {
        var tbl = h('table', null, [
          h('thead', null, h('tr', null, [h('th',null,'Issue'), h('th',null,'Repository'), h('th',null,'Status')])),
          h('tbody', null, s.data.sessions.map(function(ses) {
            return h('tr', null, [
              h('td', {className:'mono'}, ses.issueId),
              h('td', {className:'mono'}, ses.repositoryId),
              h('td', null, h('span', {className: ses.isRunning ? 'badge badge-green' : 'badge badge-yellow'}, ses.isRunning ? 'Running' : 'Idle'))
            ]);
          }))
        ]);
        sCard.appendChild(tbl);
      }
      $page.appendChild(sCard);
    }).catch(function(){});
  }).catch(function(){});
}

function stat(label, value) {
  return h('div', {className:'stat'}, [
    h('div', {className:'label'}, label),
    h('div', {className:'value'}, String(value))
  ]);
}

function formatUptime(seconds) {
  var h2 = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  return h2 + 'h ' + m + 'm';
}

// ── Repositories Page ───────────────────────────────────────────────
function renderRepos() {
  api('/api/admin/config').then(function(r) {
    if (!r.success) { $page.innerHTML = ''; $page.appendChild(msg(r.error, false)); return; }
    var repos = r.data.repositories || [];
    $page.innerHTML = '';

    // Repo list
    var card = h('div', {className:'card'}, [h('h2', null, 'Repositories (' + repos.length + ')')]);
    if (repos.length === 0) {
      card.appendChild(h('p', {className:'loading'}, 'No repositories configured'));
    } else {
      var tbl = h('table', null, [
        h('thead', null, h('tr', null, [h('th',null,'Name'), h('th',null,'Path'), h('th',null,'Workspace'), h('th',null,'Token'), h('th',null,'')])),
        h('tbody', null, repos.map(function(repo) {
          return h('tr', null, [
            h('td', null, repo.name),
            h('td', {className:'mono'}, repo.repositoryPath),
            h('td', null, repo.linearWorkspaceName || repo.linearWorkspaceId || '-'),
            h('td', {className:'mono'}, repo.linearToken || '-'),
            h('td', null, h('button', {className:'danger', onClick: function() { removeRepo(repo.id); }}, 'Remove'))
          ]);
        }))
      ]);
      card.appendChild(tbl);
    }
    $page.appendChild(card);

    // Add repo form
    var addCard = h('div', {className:'card'}, [
      h('h2', null, 'Add Repository'),
      h('div', {id:'add-repo-msg'}),
      h('div', {className:'form-group'}, [h('label', null, 'Repository Name'), h('input', {id:'repo-name', placeholder:'my-repo'})]),
      h('div', {className:'form-group'}, [h('label', null, 'Repository Path'), h('input', {id:'repo-path', placeholder:'/home/cyrus/repos/my-repo'})]),
      h('div', {className:'form-group'}, [h('label', null, 'Base Branch'), h('input', {id:'repo-branch', placeholder:'main', value:'main'})]),
      h('div', {className:'form-group'}, [h('label', null, 'GitHub URL (optional)'), h('input', {id:'repo-github', placeholder:'https://github.com/org/repo'})]),
      h('button', {onClick: addRepo}, 'Add Repository')
    ]);
    $page.appendChild(addCard);
  }).catch(function(){});
}

function addRepo() {
  var name = document.getElementById('repo-name').value.trim();
  var path = document.getElementById('repo-path').value.trim();
  var branch = document.getElementById('repo-branch').value.trim() || 'main';
  var github = document.getElementById('repo-github').value.trim();
  var msgEl = document.getElementById('add-repo-msg');
  if (!name || !path) { msgEl.innerHTML = ''; msgEl.appendChild(msg('Name and path are required', false)); return; }

  api('/api/update/repository', {
    method: 'POST',
    body: JSON.stringify({
      id: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: name,
      repositoryPath: path,
      baseBranch: branch,
      githubUrl: github || undefined,
      linearWorkspaceId: '',
      linearToken: '',
    })
  }).then(function(r) {
    msgEl.innerHTML = '';
    msgEl.appendChild(msg(r.success ? 'Repository added' : (r.error || 'Failed'), r.success));
    if (r.success) setTimeout(renderRepos, 500);
  }).catch(function(e) { msgEl.innerHTML = ''; msgEl.appendChild(msg(e.message, false)); });
}

function removeRepo(id) {
  if (!confirm('Remove repository ' + id + '?')) return;
  api('/api/update/repository', {
    method: 'DELETE',
    body: JSON.stringify({ id: id })
  }).then(function() { renderRepos(); }).catch(function() { renderRepos(); });
}

// ── Linear Auth Page ────────────────────────────────────────────────
function renderAuth() {
  $page.innerHTML = '';
  var card = h('div', {className:'card'}, [
    h('h2', null, 'Linear Authorization'),
    h('div', {id:'auth-msg'}),
    h('p', null, 'Re-authorize Cyrus with your Linear workspace to refresh OAuth tokens.'),
    h('br'),
    h('button', {onClick: initiateOAuth}, 'Authorize with Linear')
  ]);
  $page.appendChild(card);

  // Show current workspace info from config
  api('/api/admin/config').then(function(r) {
    if (!r.success) return;
    var repos = r.data.repositories || [];
    if (repos.length === 0) return;
    var first = repos[0];
    var info = h('div', {className:'card'}, [
      h('h2', null, 'Current Workspace'),
      h('div', null, [
        stat('Workspace', first.linearWorkspaceName || '-'),
        stat('Workspace ID', first.linearWorkspaceId || '-'),
        stat('Token', first.linearToken || '-')
      ])
    ]);
    $page.appendChild(info);
  }).catch(function(){});
}

function initiateOAuth() {
  var msgEl = document.getElementById('auth-msg');
  msgEl.innerHTML = '';
  msgEl.appendChild(msg('Initiating OAuth flow...', true));

  api('/api/admin/linear-oauth/initiate', {method:'POST'}).then(function(r) {
    msgEl.innerHTML = '';
    if (r.success && r.data.authorizeUrl) {
      window.open(r.data.authorizeUrl, '_blank');
      msgEl.appendChild(msg('Authorization page opened. Complete the flow in the new tab.', true));
    } else {
      msgEl.appendChild(msg(r.error || 'Failed to initiate OAuth', false));
    }
  }).catch(function(e) { msgEl.innerHTML = ''; msgEl.appendChild(msg(e.message, false)); });
}

// ── GitHub Auth Page ────────────────────────────────────────────────
function renderGithub() {
  $page.innerHTML = '';
  var card = h('div', {className:'card'}, [
    h('h2', null, 'GitHub CLI Status'),
    h('div', {id:'gh-status'}, h('p', {className:'loading'}, 'Checking...'))
  ]);
  $page.appendChild(card);

  api('/api/admin/gh-status').then(function(r) {
    var el = document.getElementById('gh-status');
    if (!el) return;
    el.innerHTML = '';
    if (!r.success) { el.appendChild(msg(r.error, false)); return; }
    var d = r.data;
    el.appendChild(h('div', null, [
      stat('Installed', d.isInstalled ? 'Yes' : 'No'),
      stat('Authenticated', d.isAuthenticated ? 'Yes' : 'No')
    ]));
    if (d.statusOutput) {
      el.appendChild(h('pre', null, d.statusOutput));
    }
  }).catch(function(){});

  // GH_TOKEN form
  var tokenCard = h('div', {className:'card'}, [
    h('h2', null, 'Set GH_TOKEN'),
    h('div', {id:'gh-msg'}),
    h('p', null, 'Set a GitHub personal access token. The container\\'s gh CLI will use this automatically.'),
    h('br'),
    h('div', {className:'form-group'}, [h('label', null, 'GH_TOKEN'), h('input', {id:'gh-token', type:'password', placeholder:'ghp_...'})]),
    h('button', {onClick: setGhToken}, 'Save GH_TOKEN')
  ]);
  $page.appendChild(tokenCard);
}

function setGhToken() {
  var token = document.getElementById('gh-token').value.trim();
  var msgEl = document.getElementById('gh-msg');
  if (!token) { msgEl.innerHTML = ''; msgEl.appendChild(msg('Token is required', false)); return; }

  api('/api/update/cyrus-env', {
    method: 'POST',
    body: JSON.stringify({ key: 'GH_TOKEN', value: token })
  }).then(function(r) {
    msgEl.innerHTML = '';
    msgEl.appendChild(msg(r.success ? 'GH_TOKEN saved. Restart may be required.' : (r.error || 'Failed'), r.success));
  }).catch(function(e) { msgEl.innerHTML = ''; msgEl.appendChild(msg(e.message, false)); });
}

// ── Config Page ─────────────────────────────────────────────────────
function renderConfig() {
  $page.innerHTML = '';
  var card = h('div', {className:'card'}, [
    h('h2', null, 'Configuration'),
    h('div', {id:'config-msg'}),
    h('p', null, 'Edit the full config.json. Tokens shown are masked; saving will overwrite with the values below.'),
    h('br'),
    h('textarea', {id:'config-editor'}),
    h('br'),
    h('button', {onClick: saveConfig}, 'Save Configuration')
  ]);
  $page.appendChild(card);

  api('/api/admin/config').then(function(r) {
    var ta = document.getElementById('config-editor');
    if (!ta) return;
    if (r.success) {
      ta.value = JSON.stringify(r.data, null, 2);
    } else {
      ta.value = '// Error: ' + (r.error || 'Failed to load config');
    }
  }).catch(function(){});
}

function saveConfig() {
  var msgEl = document.getElementById('config-msg');
  var ta = document.getElementById('config-editor');
  var value;
  try { value = JSON.parse(ta.value); } catch(e) { msgEl.innerHTML = ''; msgEl.appendChild(msg('Invalid JSON: ' + e.message, false)); return; }

  api('/api/update/cyrus-config', {
    method: 'POST',
    body: JSON.stringify({ config: value })
  }).then(function(r) {
    msgEl.innerHTML = '';
    msgEl.appendChild(msg(r.success ? 'Configuration saved' : (r.error || 'Failed'), r.success));
  }).catch(function(e) { msgEl.innerHTML = ''; msgEl.appendChild(msg(e.message, false)); });
}

// ── Environment Page ────────────────────────────────────────────────
function renderEnv() {
  $page.innerHTML = '';
  var card = h('div', {className:'card'}, [
    h('h2', null, 'Environment Variables'),
    h('div', {id:'env-msg'}),
    h('p', null, 'Set or update environment variables in the .env file.'),
    h('br'),
    h('div', {className:'form-group'}, [h('label', null, 'Variable Name'), h('input', {id:'env-key', placeholder:'ANTHROPIC_API_KEY'})]),
    h('div', {className:'form-group'}, [h('label', null, 'Value'), h('input', {id:'env-value', type:'password', placeholder:'sk-...'})]),
    h('button', {onClick: setEnvVar}, 'Save Variable')
  ]);
  $page.appendChild(card);
}

function setEnvVar() {
  var key = document.getElementById('env-key').value.trim();
  var value = document.getElementById('env-value').value.trim();
  var msgEl = document.getElementById('env-msg');
  if (!key || !value) { msgEl.innerHTML = ''; msgEl.appendChild(msg('Key and value are required', false)); return; }

  api('/api/update/cyrus-env', {
    method: 'POST',
    body: JSON.stringify({ key: key, value: value })
  }).then(function(r) {
    msgEl.innerHTML = '';
    msgEl.appendChild(msg(r.success ? key + ' saved. Restart may be required.' : (r.error || 'Failed'), r.success));
  }).catch(function(e) { msgEl.innerHTML = ''; msgEl.appendChild(msg(e.message, false)); });
}
})();
</script>
</body>
</html>`;
}
