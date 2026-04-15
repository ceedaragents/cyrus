/**
 * Default allowed domains for the "trusted" network policy preset.
 * Matches the Claude Code on the web "Trusted" access level allowlist.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/claude-code-on-the-web#default-allowed-domains
 */
export const TRUSTED_DOMAINS: readonly string[] = [
	// ── Anthropic services ──────────────────────────────────────────────
	"api.anthropic.com",
	"statsig.anthropic.com",
	"docs.claude.com",
	"platform.claude.com",
	"code.claude.com",
	"claude.ai",

	// ── Version control ─────────────────────────────────────────────────
	"github.com",
	"www.github.com",
	"api.github.com",
	"npm.pkg.github.com",
	"raw.githubusercontent.com",
	"pkg-npm.githubusercontent.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
	"codeload.github.com",
	"avatars.githubusercontent.com",
	"camo.githubusercontent.com",
	"gist.github.com",
	"gitlab.com",
	"www.gitlab.com",
	"registry.gitlab.com",
	"bitbucket.org",
	"www.bitbucket.org",
	"api.bitbucket.org",

	// ── Container registries ────────────────────────────────────────────
	"registry-1.docker.io",
	"auth.docker.io",
	"index.docker.io",
	"hub.docker.com",
	"www.docker.com",
	"production.cloudflare.docker.com",
	"download.docker.com",
	"gcr.io",
	"*.gcr.io",
	"ghcr.io",
	"mcr.microsoft.com",
	"*.data.mcr.microsoft.com",
	"public.ecr.aws",

	// ── Cloud platforms ─────────────────────────────────────────────────
	"cloud.google.com",
	"accounts.google.com",
	"gcloud.google.com",
	"*.googleapis.com",
	"storage.googleapis.com",
	"compute.googleapis.com",
	"container.googleapis.com",
	"azure.com",
	"portal.azure.com",
	"microsoft.com",
	"www.microsoft.com",
	"*.microsoftonline.com",
	"packages.microsoft.com",
	"dotnet.microsoft.com",
	"dot.net",
	"visualstudio.com",
	"dev.azure.com",
	"*.amazonaws.com",
	"*.api.aws",
	"oracle.com",
	"www.oracle.com",
	"java.com",
	"www.java.com",
	"java.net",
	"www.java.net",
	"download.oracle.com",
	"yum.oracle.com",

	// ── JavaScript and Node package managers ────────────────────────────
	"registry.npmjs.org",
	"www.npmjs.com",
	"www.npmjs.org",
	"npmjs.com",
	"npmjs.org",
	"yarnpkg.com",
	"registry.yarnpkg.com",

	// ── Python package managers ─────────────────────────────────────────
	"pypi.org",
	"www.pypi.org",
	"files.pythonhosted.org",
	"pythonhosted.org",
	"test.pypi.org",
	"pypi.python.org",
	"pypa.io",
	"www.pypa.io",

	// ── Ruby package managers ───────────────────────────────────────────
	"rubygems.org",
	"www.rubygems.org",
	"api.rubygems.org",
	"index.rubygems.org",
	"ruby-lang.org",
	"www.ruby-lang.org",
	"rubyforge.org",
	"www.rubyforge.org",
	"rubyonrails.org",
	"www.rubyonrails.org",
	"rvm.io",
	"get.rvm.io",

	// ── Rust package managers ───────────────────────────────────────────
	"crates.io",
	"www.crates.io",
	"index.crates.io",
	"static.crates.io",
	"rustup.rs",
	"static.rust-lang.org",
	"www.rust-lang.org",

	// ── Go package managers ─────────────────────────────────────────────
	"proxy.golang.org",
	"sum.golang.org",
	"index.golang.org",
	"golang.org",
	"www.golang.org",
	"goproxy.io",
	"pkg.go.dev",

	// ── JVM package managers ────────────────────────────────────────────
	"maven.org",
	"repo.maven.org",
	"central.maven.org",
	"repo1.maven.org",
	"repo.maven.apache.org",
	"jcenter.bintray.com",
	"gradle.org",
	"www.gradle.org",
	"services.gradle.org",
	"plugins.gradle.org",
	"kotlinlang.org",
	"www.kotlinlang.org",
	"spring.io",
	"repo.spring.io",

	// ── Other package managers ──────────────────────────────────────────
	// PHP Composer
	"packagist.org",
	"www.packagist.org",
	"repo.packagist.org",
	// .NET NuGet
	"nuget.org",
	"www.nuget.org",
	"api.nuget.org",
	// Dart/Flutter
	"pub.dev",
	"api.pub.dev",
	// Elixir/Erlang
	"hex.pm",
	"www.hex.pm",
	// Perl CPAN
	"cpan.org",
	"www.cpan.org",
	"metacpan.org",
	"www.metacpan.org",
	"api.metacpan.org",
	// iOS/macOS
	"cocoapods.org",
	"www.cocoapods.org",
	"cdn.cocoapods.org",
	// Haskell
	"haskell.org",
	"www.haskell.org",
	"hackage.haskell.org",
	// Swift
	"swift.org",
	"www.swift.org",

	// ── Linux distributions ─────────────────────────────────────────────
	"archive.ubuntu.com",
	"security.ubuntu.com",
	"ubuntu.com",
	"www.ubuntu.com",
	"*.ubuntu.com",
	"ppa.launchpad.net",
	"launchpad.net",
	"www.launchpad.net",
	"*.nixos.org",

	// ── Development tools and platforms ─────────────────────────────────
	// Kubernetes
	"dl.k8s.io",
	"pkgs.k8s.io",
	"k8s.io",
	"www.k8s.io",
	// HashiCorp
	"releases.hashicorp.com",
	"apt.releases.hashicorp.com",
	"rpm.releases.hashicorp.com",
	"archive.releases.hashicorp.com",
	"hashicorp.com",
	"www.hashicorp.com",
	// Anaconda/Conda
	"repo.anaconda.com",
	"conda.anaconda.org",
	"anaconda.org",
	"www.anaconda.com",
	"anaconda.com",
	"continuum.io",
	// Apache
	"apache.org",
	"www.apache.org",
	"archive.apache.org",
	"downloads.apache.org",
	// Eclipse
	"eclipse.org",
	"www.eclipse.org",
	"download.eclipse.org",
	// Node.js
	"nodejs.org",
	"www.nodejs.org",
	// Other
	"developer.apple.com",
	"developer.android.com",
	"pkg.stainless.com",
	"binaries.prisma.sh",

	// ── Cloud services and monitoring ───────────────────────────────────
	"statsig.com",
	"www.statsig.com",
	"api.statsig.com",
	"sentry.io",
	"*.sentry.io",
	"downloads.sentry-cdn.com",
	"http-intake.logs.datadoghq.com",
	"*.datadoghq.com",
	"*.datadoghq.eu",
	"api.honeycomb.io",

	// ── Content delivery and mirrors ────────────────────────────────────
	"sourceforge.net",
	"*.sourceforge.net",
	"packagecloud.io",
	"*.packagecloud.io",
	"fonts.googleapis.com",
	"fonts.gstatic.com",

	// ── Schema and configuration ────────────────────────────────────────
	"json-schema.org",
	"www.json-schema.org",
	"json.schemastore.org",
	"www.schemastore.org",

	// ── Model Context Protocol ──────────────────────────────────────────
	"*.modelcontextprotocol.io",
];
