# PRD: OPDS Settings UI

## Introduction/Overview
Add an OPDS section to the user settings page so users can find their catalog URL, manage an API key, and copy URLs into OPDS clients.

## Goals
- Make OPDS setup self-serve for users.
- Allow API key generation and regeneration with confirmation.
- Keep the settings change additive and consistent with existing UI.

## User Stories

### US-001: Display OPDS catalog URLs
**Description:** As a user, I want to see my OPDS catalog URL so I can add it to a reading app.

**Acceptance Criteria:**
- [ ] Settings page shows the Basic Auth catalog URL (`/opds/v1.2/catalog`).
- [ ] Settings page shows the API-key URL (`/opds/{apiKey}/v1.2/catalog`) with the key masked by default.
- [ ] URLs are rendered as copyable text with a "Copy URL" action.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-002: Generate and regenerate API keys
**Description:** As a user, I want to generate or regenerate my OPDS API key so I can use clients that do not support Basic Auth.

**Acceptance Criteria:**
- [ ] If no key exists, a "Generate Key" action creates one and updates the display.
- [ ] If a key exists, a "Regenerate Key" action requires confirmation and invalidates the prior key.
- [ ] Key generation is server-side and tied to the current user.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-003: Show or hide the API key
**Description:** As a user, I want to toggle key visibility so I can copy it safely.

**Acceptance Criteria:**
- [ ] The API key is masked by default with a "Show" toggle.
- [ ] Toggling reveals the full key and updates the URL display.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-004: OPDS usage guidance
**Description:** As a user, I want brief setup guidance so I can connect an OPDS client quickly.

**Acceptance Criteria:**
- [ ] The OPDS section includes short instructions for adding the URL in common OPDS apps.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

## Functional Requirements
1. Add an OPDS section to `src/app/(dashboard)/settings/page.tsx`.
2. Display both Basic Auth and API-key catalog URLs.
3. Provide generate or regenerate actions with confirmation for regeneration.
4. Mask the API key by default and allow a show or hide toggle.
5. Do not alter other settings or authentication flows.

## Non-Goals
- An in-app OPDS client or reader.
- Storing OPDS client credentials.
- Changes to core user account management outside OPDS.

## Design Considerations
- Reuse existing settings layout, buttons, and confirmation dialog patterns.

## Technical Considerations
- Provide a server action or API route to create or regenerate `opdsApiKey`.
- Ensure the action is protected to the current user only.
- Avoid logging the API key in client or server logs.

## Success Metrics
- Users can copy a working OPDS URL in under 2 clicks.
- Regenerating a key immediately invalidates the previous URL.

## Open Questions
- Should we provide a one-click "Copy API-key URL" and "Copy Basic URL" separately, or a single picker?
