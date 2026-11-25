# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| < 0.2 | No |

## Reporting a vulnerability

Report vulnerabilities privately through **Security > Report a vulnerability** in this repository. If private reporting is unavailable, contact the maintainer through their GitHub profile. Include the affected app version, impact, and steps to reproduce. Avoid posting exploit details publicly before a fix is available.

## Data access review

This repository contains PocketBase hooks but no collection exports, live
database rules, or deployed server. Do not treat the hooks or client checks as
the complete access-control boundary. Configure and verify the rules on a new,
independent PocketBase instance before enabling sync. The expected collection
set and access boundaries are documented in [POCKETBASE.md](POCKETBASE.md).

If community routes are enabled, their tracks are public data. The included
route hook trims 150 m from both ends before storing a track and validates new
POIs against the protected endpoints, including POI-only updates. This reduces
location exposure but does not guarantee anonymity. The client resizes and
re-encodes photos, and the hook rejects uploaded JPEGs with EXIF/XMP, IPTC, or
comment metadata. Photos uploaded before this validation was deployed are not
cleaned automatically and may need a separate review.

The API bearer token supports persistent sign-in. Native Android and iOS builds
store it using platform secure storage; existing native sessions are migrated
from `localStorage` after the secure write succeeds. Web builds continue to use
browser `localStorage`, so JavaScript running in the app origin can access the
token. The app applies a Content Security Policy that blocks inline scripts and
loads application libraries locally, but this does not protect against every
form of same-origin script execution. Because PocketBase servers and map
providers are configurable, the policy permits HTTPS connections and images;
it is not a complete boundary against data exfiltration. API requests also
bypass browser caches and reject redirects to avoid persisting private API
responses or following unexpected redirects.

Profile fields such as email, age, weight, avatar, and `groupCode` must not be
publicly listable, and only the authenticated owner should be able to update
their profile. Also verify HTTPS, admin credentials, backups, and PocketBase
version on the new server. No server credentials or user data are stored in
this repository.
