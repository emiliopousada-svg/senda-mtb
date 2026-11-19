# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.2.x | Yes |
| < 1.2 | No |

## Reporting a vulnerability

Report vulnerabilities privately through **Security > Report a vulnerability** in this repository. If private reporting is unavailable, contact the maintainer through their GitHub profile. Include the affected app version, impact, and steps to reproduce. Avoid posting exploit details publicly before a fix is available.

## Data access review

Since v0.2.23, this repository no longer contains PocketBase hook source,
collection exports, live database rules, or a deployed server. Existing
server-side endpoints must remain deployed independently; do not treat client
checks as an access-control boundary. Configure and verify the rules on a new,
independent PocketBase instance before enabling sync. The expected collection
set and access boundaries are documented in [POCKETBASE.md](POCKETBASE.md).

If community routes are enabled, their tracks are public data. The previously
deployed route hook trims 150 m from both ends before storing a track and
rejects POIs within 150 m of the submitted endpoints. Its source is no longer
in this repository, so verify the deployed implementation before relying on
this behavior. This reduces location exposure but does not guarantee
anonymity. The client also resizes and re-encodes photos; the server must
validate or remove EXIF data if that is required.

The API bearer token supports persistent sign-in and is stored in browser
`localStorage`. JavaScript running in the app origin can access it, so script
injection or a compromised third-party script could expose the session. API
requests now bypass browser caches and reject redirects to avoid persisting
private API responses or following unexpected redirects. These measures do not
protect against same-origin script execution. A stronger design needs a
short-lived token behind a server-side session, or platform secure storage for
the native app.

Profile fields such as email, age, weight, avatar, and `groupCode` must not be
publicly listable, and only the authenticated owner should be able to update
their profile. Also verify HTTPS, admin credentials, backups, and PocketBase
version on the new server. No server credentials or user data are stored in
this repository.
