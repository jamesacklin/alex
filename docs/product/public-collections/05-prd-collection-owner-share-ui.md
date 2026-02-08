# PRD: Public Collections - Collection Owner Share UI

## Introduction

Add a share toggle interface to the collection detail page that allows collection owners to enable/disable sharing, copy share links, and see sharing status. This provides the user-facing control for the public collections feature.

## Goals

- Allow collection owners to enable sharing with one click
- Display the share URL in a copyable format when sharing is enabled
- Allow collection owners to disable sharing (revoke access)
- Provide clear visual feedback on sharing status
- Follow existing UI patterns (dialog, buttons, icons)

## User Stories

### US-001: Add share button to collection detail header
**Description:** As a collection owner, I want to see a "Share" button in my collection's detail page so I can enable public sharing.

**Acceptance Criteria:**
- [ ] Modify `src/app/(dashboard)/collections/[id]/collection-detail-client.tsx`
- [ ] Add "Share" button next to existing Edit and Delete buttons
- [ ] Button only visible to collection owner (same permission check as Edit/Delete)
- [ ] Button shows "Share" text with appropriate icon (e.g., share or link icon)
- [ ] Clicking button opens share dialog
- [ ] Button styling consistent with existing action buttons
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Create share dialog for enabling sharing
**Description:** As a collection owner, I want a dialog that confirms I want to share my collection and explains what will be shared.

**Acceptance Criteria:**
- [ ] Create share dialog component (reuse existing Dialog pattern)
- [ ] Dialog title: "Share Collection"
- [ ] Dialog explains: "Anyone with the link can view this collection and read the books in their browser."
- [ ] Dialog has "Enable Sharing" button (primary action)
- [ ] Dialog has "Cancel" button
- [ ] Clicking "Enable Sharing" calls `POST /api/collections/[id]/share`
- [ ] On success, dialog closes and share status updates
- [ ] On error, display error message in dialog
- [ ] Loading state shown during API call
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Display share link when sharing is enabled
**Description:** As a collection owner with sharing enabled, I want to see the share link and easily copy it so I can send it to others.

**Acceptance Criteria:**
- [ ] When `shareToken` is not null, show share status UI instead of "Share" button
- [ ] Display share URL in a read-only text input field
- [ ] Share URL format: `https://yourapp.com/shared/{token}`
- [ ] Include "Copy Link" button next to the input field
- [ ] Clicking "Copy Link" copies URL to clipboard
- [ ] Show "Copied!" confirmation feedback (toast or temporary checkmark)
- [ ] URL input is selectable (user can manually select/copy if needed)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Allow disabling sharing
**Description:** As a collection owner, I want to disable sharing to revoke public access to my collection.

**Acceptance Criteria:**
- [ ] Show "Stop Sharing" button when sharing is enabled
- [ ] Button positioned near the share URL (clear association)
- [ ] Clicking button shows confirmation dialog
- [ ] Confirmation dialog warns: "This will break any existing share links. People who have the current link will no longer be able to access this collection."
- [ ] Confirmation has "Stop Sharing" (destructive) and "Cancel" buttons
- [ ] Clicking "Stop Sharing" calls `DELETE /api/collections/[id]/share`
- [ ] On success, share UI hides and "Share" button reappears
- [ ] On error, display error message
- [ ] Loading state shown during API call
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Update collection data to include share status
**Description:** As a developer, I need the collection detail page to receive share status data so the UI can render correctly on initial load.

**Acceptance Criteria:**
- [ ] Collection detail page already fetches from `GET /api/collections/[id]`
- [ ] Endpoint now includes `shareToken` and `sharedAt` (from API PRD)
- [ ] Client component uses this data to determine initial share state
- [ ] If `shareToken` is not null, show share URL UI
- [ ] If `shareToken` is null, show "Share" button
- [ ] No extra API call needed (data included in existing fetch)
- [ ] Typecheck passes

### US-006: Show sharing indicator on collection card
**Description:** As a collection owner viewing my collections list, I want to see which collections are currently shared so I know their public status at a glance.

**Acceptance Criteria:**
- [ ] Modify collection card component to show share indicator when `shareToken` is not null
- [ ] Indicator is a small icon or badge (e.g., link icon or "Shared" badge)
- [ ] Indicator is subtle but visible (don't overwhelm the card design)
- [ ] Indicator has tooltip or title: "This collection is publicly shared"
- [ ] Update `GET /api/collections` to include `shareToken` in collection list response
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: Collection detail page must show "Share" button when collection is not shared
- FR-2: Clicking "Share" button must open a dialog explaining what will be shared
- FR-3: Dialog must call `POST /api/collections/[id]/share` to enable sharing
- FR-4: When sharing is enabled, UI must display the share URL in a copyable input
- FR-5: "Copy Link" button must copy URL to clipboard and show confirmation
- FR-6: "Stop Sharing" button must show confirmation dialog before disabling
- FR-7: Confirmation dialog must call `DELETE /api/collections/[id]/share`
- FR-8: Share status must persist across page reloads (from API data)
- FR-9: Collection cards must show share indicator when collection is shared
- FR-10: Only collection owners can see share controls (same as edit/delete)

## Non-Goals (Out of Scope)

- No social media share buttons (just copy link)
- No share analytics or view counts
- No custom share URLs or vanity paths
- No email/SMS sharing integration
- No share expiration settings
- No password protection options

## Design Considerations

### UI Placement
The share controls should be:
- In the collection detail page header (next to Edit/Delete)
- Clearly associated with the collection (not buried in settings)
- Visible but not prominent (secondary action compared to viewing books)

### Dialog vs Inline Toggle
Use a dialog for initial sharing because:
- Gives space to explain what will be shared
- Allows confirmation before making collection public
- Consistent with existing Edit/Delete patterns

Show share URL inline (not in dialog) because:
- Users need easy access to copy the link
- No need to open dialog every time to get the URL
- Makes share status immediately visible

### Copy to Clipboard
Use modern Clipboard API:
```typescript
await navigator.clipboard.writeText(shareUrl);
```
Fallback for older browsers not required (modern Next.js apps target recent browsers).

### Destructive Action Styling
The "Stop Sharing" button should:
- Use secondary/destructive styling (red or muted)
- Require confirmation (don't immediately revoke)
- Warn about breaking existing links

## Technical Considerations

- Reuse existing Dialog component pattern from edit dialog
- Use existing toast/notification system for "Copied!" feedback
- Clipboard API requires HTTPS (dev environment should use localhost)
- Share token data already included in API response (no extra fetch)
- Update TypeScript types for collection object to include `shareToken` and `sharedAt`
- Loading states prevent double-clicks during API calls
- Error handling shows user-friendly messages (not raw errors)

## Success Metrics

- Collection owners can enable sharing in under 3 clicks
- Share URL is clearly visible and copyable
- Copy to clipboard works reliably in modern browsers
- Disabling sharing requires confirmation (prevents accidental revocation)
- Share status persists correctly across page reloads
- Share indicator visible on collection cards
- Typecheck and lint pass with no errors

## Open Questions

- Should we show "Shared X days ago" timestamp? (Optional - can add later)
- Should we show a QR code for the share link? (Not in MVP)
- Should share controls be in a separate settings menu? (No - keep them visible in header)
