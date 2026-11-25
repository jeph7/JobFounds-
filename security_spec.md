# JOB FONDS — Firestore Security Specification (Phase 0 TDD)

## 1. Core Data Invariants
1. **PII Isolation**: `/users/{userId}` holds private PII (`email`, `phone`, `profile`) and is strictly readable/writable only by `request.auth.uid == userId` (or verified Admin). Public recruiter discovery uses a separate `/publicCandidates/{userId}` collection containing zero PII (`email`/`phone` strictly disallowed by `hasOnly`).
2. **Owner Subcollection Gate**: `/users/{userId}/cvs/{cvId}`, `/users/{userId}/applications/{appId}`, and `/users/{userId}/watchlist/{watchId}` require `request.auth.uid == userId`, verified email, valid document IDs, and parent `/users/{userId}` existence on creation.
3. **Employer Ownership & Terminal Locking**: `/companyJobs/{jobId}` can only be created/updated by `recruiterId == request.auth.uid`. Once `status == 'closed'`, non-admin updates are permanently rejected.
4. **Participant-Only Direct Messaging**: `/conversations/{conversationId}` is readable and writable strictly by `candidateId` or `recruiterId`. Messages under `/conversations/{conversationId}/messages/{messageId}` validate parent conversation membership via `get()` on `get`/`create` and enforce `senderId == request.auth.uid` and immutable history (no client updates/deletes on messages).
5. **Strict Server Timestamps & Volumetric Bounds**: All `createdAt` and `updatedAt` fields must equal `request.time`. Every string and array enforces explicit `.size()` boundaries.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Cross-User PII Read**: Non-owner `GET /users/{otherUid}` -> Denied (`isOwner` fails).
2. **Ghost Field / Privilege Escalation**: `CREATE /users/{uid}` with `isAdmin: true` -> Denied (`hasOnly` rejects ghost keys).
3. **Email Unverified Write**: Any write with `request.auth.token.email_verified == false` -> Denied (`isVerifiedUser()` fails).
4. **PII Injection into Public Directory**: `CREATE /publicCandidates/{uid}` including `email: "leak@example.com"` -> Denied (`hasOnly` rejects PII keys).
5. **ID Poisoning**: `CREATE /companyJobs/../../../bad$id` -> Denied (`isValidId` regex fails).
6. **Denial-of-Wallet Oversized String**: `CREATE /companyJobs/{id}` with 100KB `description` -> Denied (`description.size() <= 4000` fails).
7. **Forged Recruiter Identity**: `CREATE /companyJobs/{id}` setting `recruiterId: "victimUid"` -> Denied (`recruiterId == request.auth.uid`).
8. **Closed Job Mutation (Terminal State Bypass)**: `UPDATE /companyJobs/{id}` when `existing().status == 'closed'` -> Denied.
9. **Client Timestamp Forgery**: `CREATE /users/{uid}/applications/{id}` with backdated `createdAt` -> Denied (`createdAt == request.time`).
10. **Blanket Unfiltered List Scraping**: `LIST /conversations` by a third-party user -> Denied (`candidateId` or `recruiterId` check on `resource.data`).
11. **Conversation Hijack**: Non-participant `CREATE /conversations/{cid}/messages/{mid}` -> Denied (Master Gate `get()` on parent conversation fails).
12. **Message Spoofing / Tampering**: Participant `UPDATE /conversations/{cid}/messages/{mid}` or `CREATE` with `senderId != request.auth.uid` -> Denied.
