# PRD: Phase 2 - Authentication

## Introduction

Implement admin-managed user authentication with NextAuth.js. This includes a login page, first-run setup wizard (dedicated `/setup` page), role-based access control middleware, and an admin user management interface. Users cannot self-register; only admins can create accounts.

## Goals

- Secure authentication with JWT session management
- First-run setup creates initial admin account via dedicated page
- Admins can create, view, and delete user accounts
- Role-based route protection (admin vs regular user)

## User Stories

### US-2.1: Configure NextAuth.js
**Description:** As a developer, I need NextAuth configured with credentials provider for email/password authentication.

**Acceptance Criteria:**
- [ ] `next-auth` v5 installed
- [ ] `src/lib/auth/config.ts` with credentials provider
- [ ] `src/app/api/auth/[...nextauth]/route.ts` handler
- [ ] JWT strategy with role included in token
- [ ] Session includes user id, email, displayName, role

### US-2.2: Create Login Page
**Description:** As a user, I want to log in with email and password so I can access my library.

**Acceptance Criteria:**
- [ ] `src/app/(auth)/login/page.tsx` with login form
- [ ] Email and password fields using shadcn Input
- [ ] Form validation with error messages (required fields, invalid credentials)
- [ ] Redirects to `/library` on success
- [ ] Shows error toast on invalid credentials
- [ ] Verify in browser

### US-2.3: First-Run Setup Page
**Description:** As a new installation, the system needs an admin account created before use.

**Acceptance Criteria:**
- [ ] `src/app/(auth)/setup/page.tsx` for initial setup
- [ ] Form fields: email, display name, password, confirm password
- [ ] Only accessible when no users exist in database
- [ ] Redirects to `/login` if any user already exists
- [ ] Creates user with role='admin'
- [ ] Shows success message and redirects to login
- [ ] Verify in browser

### US-2.4: Route Protection Middleware
**Description:** As a system, I need to protect routes based on authentication and role.

**Acceptance Criteria:**
- [ ] `src/middleware.ts` using NextAuth
- [ ] Unauthenticated users redirected to `/login`
- [ ] `/admin/*` routes require role='admin'
- [ ] Non-admins accessing `/admin/*` redirected to `/library`
- [ ] `/setup` bypasses auth check (but checks if users exist)
- [ ] API routes return 401/403 appropriately

### US-2.5: Admin User Management Page
**Description:** As an admin, I want to create and manage user accounts.

**Acceptance Criteria:**
- [ ] `src/app/(dashboard)/admin/users/page.tsx`
- [ ] Table listing all users (email, display name, role, created date)
- [ ] "Add User" button opens dialog with form
- [ ] Create user form: email, display name, password, role select (admin/user)
- [ ] Delete user button with confirmation dialog
- [ ] Cannot delete own account (button disabled with tooltip)
- [ ] Verify in browser

### US-2.6: Users API Endpoints
**Description:** As a developer, I need API endpoints for user CRUD operations.

**Acceptance Criteria:**
- [ ] `GET /api/users` - list all users (admin only)
- [ ] `POST /api/users` - create user (admin only)
- [ ] `DELETE /api/users/[id]` - delete user (admin only)
- [ ] All endpoints verify admin role, return 403 if not admin
- [ ] Passwords hashed with bcryptjs before storage
- [ ] Returns appropriate error messages

## Functional Requirements

- FR-2.1: NextAuth credentials provider with bcrypt password verification
- FR-2.2: JWT sessions with 30-day expiry
- FR-2.3: Login page at `/login` with form validation
- FR-2.4: Setup page at `/setup` (only accessible when no users exist)
- FR-2.5: Middleware protects all `/(dashboard)/*` routes
- FR-2.6: Admin routes (`/admin/*`) require role='admin'
- FR-2.7: User management CRUD at `/admin/users`
- FR-2.8: API endpoints protected by role checks

## Non-Goals

- No password reset functionality
- No email verification
- No OAuth/social providers
- No user self-registration
- No profile editing for non-admins

## Design Considerations

- Login page: centered card with logo, email/password fields, submit button
- Setup page: similar to login but with additional fields
- User management: data table with actions column
- Use shadcn Dialog for create user modal
- Use shadcn AlertDialog for delete confirmation

## Technical Considerations

- Use `bcryptjs` (pure JS) not `bcrypt` (native bindings) for portability
- Store sessions in JWT, not database (simpler setup)
- Admin check: `session.user.role === 'admin'`
- Type augment NextAuth session to include role and id

## Success Metrics

- Users can log in and access protected routes
- First-time setup creates working admin account
- Admins can create and delete users
- Non-admins cannot access admin routes

## Open Questions

- None - requirements are fully specified
