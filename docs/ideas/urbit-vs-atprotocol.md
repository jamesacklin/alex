# Urbit vs AT Protocol: Why Urbit Fits Alex Better

A comparison of the two social layer proposals in the context of Alex's self-hosted, sovereignty-first design.

Both plans ([Urbit](./urbit-integration.md) | [AT Protocol](./atproto-integration.md)) solve the same problem: giving Alex users a global identity, friend graph, and activity sharing without a centralized account service. The AT Protocol plan makes a strong pragmatic case (TypeScript-native, millions of existing users). But for Alex specifically --- a self-hosted library app whose users already opted into running their own infrastructure --- Urbit is the more coherent choice. Here's why.

---

## 1. True P2P with No Relay Dependency

AT Protocol's social layer routes through a centralized relay (Bluesky's Jetstream) and requires building and hosting an App View indexer. If that relay changes terms, goes down, or deprioritizes third-party lexicons, the social layer breaks.

Urbit ships talk directly via Ames --- encrypted, ship-to-ship, no middleman. The entire networking stack is decentralized by design. For a self-hosted app, eliminating that single point of failure is the whole point.

## 2. Privacy Is Native, Not Privacy-by-Omission

The AT Protocol plan explicitly states records are "public by default" and privacy is handled by not publishing data. For a library app --- where reading habits are genuinely personal --- that's a significant weakness.

Urbit gives per-ship access control at the protocol level. A user can share their reading list with `~alice` and `~bob` without it being world-readable. Subscription paths in the `%alex-social` agent can enforce permissions per-ship. AT Protocol cannot offer this without breaking its own data model.

## 3. The Pier Is the Portable Artifact

Urbit's portability model is categorically different from AT Protocol's. A ship's pier directory contains identity, friend graph, agent state, and all social data in a single movable artifact. Copy the pier to a new machine and everything comes with you --- identity, relationships, state, history.

AT Protocol's "portability" means a DID can point to a different PDS, but the social index lives in an App View the user doesn't control, tokens are bound to specific servers, and migration requires coordinating across multiple services.

## 4. Real-Time Subscriptions Are Built In

Gall subscriptions are live, bidirectional, encrypted P2P streams. A social feed updates the moment a friend finishes a book. Reading group discussions are real-time by default.

The AT Protocol plan concedes this openly: its model is "eventually consistent" via firehose indexing. For reading groups it admits the result is "closer to a forum model" that would need "a separate WebSocket layer" for real-time chat. Urbit provides this natively.

## 5. Built-In Group Infrastructure for Reading Groups

Phase 5 (reading groups) is where the gap is widest. Urbit already has a mature `%groups` agent with channels, membership management, and real-time messaging. The `%alex-social` agent can create Urbit groups directly and add a custom reading-group channel type.

The AT Protocol plan models groups as flat public records with no native chat, no real-time coordination, and no membership enforcement --- then acknowledges it would need to "build or integrate separately."

## 6. Philosophical Alignment with Self-Hosting

Alex users chose to self-host their library because they want control over their data and infrastructure. Urbit's entire premise is the same: a ship is a personal server, an identity, and a data store in one.

Running a Vere container in Docker Compose alongside Alex is a natural extension of that worldview. AT Protocol, despite being "federated," has centralizing tendencies --- most users are on Bluesky's PDS, the relay is resource-intensive infrastructure run by Bluesky Inc., and the "log in with Bluesky" onboarding advantage is really just a restatement of that centralization.

---

## Honest Counterweights

The AT Protocol plan wins on:

- **Developer experience**: TypeScript end-to-end vs. learning Hoon for the Gall agent.
- **Onboarding friction**: millions of existing Bluesky users vs. thousands of Urbit ship owners.
- **Discovery**: the App View naturally indexes all participants; Urbit has no global directory.

These are real costs. But the Hoon learning curve is a one-time investment for the `%alex-social` agent --- the rest of the integration (Next.js API routes, UI, web client) is TypeScript via `@urbit/http-api`. And Alex's target audience is people who already run their own servers; they're not the audience that needs zero-friction onboarding.

---

## Recommendation

Run the Urbit sidecar. The architectural alignment with Alex's self-hosting ethos, native privacy controls, true P2P networking, and built-in group infrastructure outweigh the developer experience advantages of AT Protocol for this specific use case.
