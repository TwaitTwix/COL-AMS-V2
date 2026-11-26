# Phase 7 — navigation and mobile interface

Implemented and verified locally on November 26, 2026. Production remains unchanged in legacy mode; no schema migration is needed for this phase.

The shared header opens a native modal navigation drawer on phones and desktops. It supplies background inertness, scroll locking, labelled controls, explicit Tab/Shift+Tab wrapping, Escape/backdrop/Close dismissal, active-page indication, and focus restoration. Selecting a page closes the drawer and focuses the main content. Signed-out sessions hide the trigger. The tagline follows the menu naturally.

Revision navigation follows operational priority and effective available capabilities. Audit Trail stays last. Reports remain unavailable and hidden until phase 8. My account, theme, notification bell and sign-out remain in the header. Menu filtering does not replace the current server authorization checks.

Revision dashboards use scoped operational APIs for visible events, open reviews, personal unread assignments and administrator escalation health. Each role has relevant guidance and permitted shortcuts. Failed requests display unavailable counts rather than zero. Current/starting-soon/upcoming labels follow event start/end times; server attendance validation remains authoritative. Attendance percentages await phase-8 roster rules.

Page selection is represented by `/?view=events` and equivalent permitted view keys; account settings retain `/account`. Refresh and browser Back restore only currently permitted pages; unknown or revoked view keys fall back to Dashboard. Detail filters/case selection are not persisted in the URL.

## Validation

- `npm test`: 70 total, 62 passed, 8 existing opt-in/live tests skipped, 0 failures.
- JavaScript syntax checks and Git whitespace check passed.
- Synthetic loopback browser preview used actual shared header markup, styles and revision modules. No real Auth, GPS, passwords, attendance decisions or messages were submitted.
- 320×700, 390×844 and 1280×900: no page horizontal overflow. Phone hamburger is 52px; username/theme/bell/sign-out controls are at least 48px tall. Long usernames truncate visually while retaining their full accessible label.
- Verified modal focus, Tab/Shift+Tab wrap, Escape, backdrop close, selection-to-main focus, signed-out controls, representative/admin menus, event refresh/Back, dashboard logo navigation, light/dark styling and partial API failure states.
- Account URL navigation was checked; the synthetic account fixture omitted the profile role, so its password page was not a full Auth/password verification. Existing password unit tests pass; hosted sign-in/password and physical-device checks remain release gates.
- Screenshots: `.local-preview/navigation-mobile.png` and `.local-preview/navigation-desktop.png` (synthetic data only).

The previous phase's 18 SQL fixtures and 12 concurrency checks were not rerun for this frontend-only change. Hosted staging, scheduler activation, physical phone/QR/GPS checks, school retention confirmation and controlled rollout remain required before release.
