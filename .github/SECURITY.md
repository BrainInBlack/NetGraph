# Security Policy

NetGraph runs entirely in the browser with no backend, and it ingests untrusted
data in two places - imported `.json` bundles and uploaded custom icons (including
SVG). That ingest surface is where NetGraph's own correctness has security weight,
so reports are taken seriously.

## Supported versions

The latest release on the `main` branch is supported. Fixes land there first and
ship in the next tagged release.

| Version | Supported |
| ------- | --------- |
| 1.3.x   | ✅        |
| < 1.3   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via either:

- GitHub's [private vulnerability reporting][advisories] - the **"Report a
  vulnerability"** button under the repository's *Security* tab (preferred), or
- email to **braininblack@gmail.com** with `[NetGraph security]` in the subject.

Please include:

- the NetGraph version (shown by the wordmark) and which build (hosted,
  self-hosted, or offline single-file copy),
- your browser and OS,
- a description of the issue and its impact, and
- a minimal reproduction or proof of concept if you have one - for ingest bugs,
  the smallest import bundle or SVG icon that triggers it.

You can expect an acknowledgement within **5 business days**. Once the issue is
confirmed, we'll agree on a disclosure timeline with you, prepare a fix, and
credit you in the release notes unless you prefer to stay anonymous.

## Scope

In scope - vulnerabilities **in NetGraph itself**, for example:

- stored or reflected XSS through imported bundles, custom icons, or any
  user-controlled field that reaches the DOM (device names, tags, notes, ids),
- a way to get markup or script past the SVG sanitizer (`svg-sanitizer.ts`) -
  including mutation-XSS that only becomes live after HTML re-parsing,
- attribute-injection through ids or other values interpolated into `data-*`
  attributes,
- bypassing the import validation in `parse-shapes.ts` to inject malformed or
  oversized state that corrupts or hijacks the app.

Out of scope:

- a malicious bundle that only damages **your own** local data - importing
  replaces your maps by design; export a backup first,
- weaknesses in the browser, the operating system, or a hosting webserver you
  run yourself,
- the absence of a feature (NetGraph has no accounts, no server, and no
  transport security to speak of because nothing is transmitted),
- self-XSS that requires pasting attacker-supplied content into your own
  devtools console.

[advisories]: https://github.com/BrainInBlack/NetGraph/security/advisories/new
