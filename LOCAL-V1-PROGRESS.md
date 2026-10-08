# Local V1 Progress

## Source and scope

The 2026-10-08 cloud task retained commit `9ec872c` on
`codex/admin-v1-foundation`, but its GitHub push failed. The task's recorded
file changes were recovered through read_thread and compared with the local
downloaded sources. No cloud checkout or unpushed Git commit was downloaded.

Reused: admin menu grouping, learning overview integration, and the
`/api/admin/content-coverage` endpoint. Local deployment fixes already covered
the cloud Dockerfile seed copy and student-directory mount changes.

## Implemented locally

- Five admin areas: workbench, teaching content, learners/classes, operations,
  system/permissions. Existing pages and server permission checks remain.
- Workbench: scoped student metrics, default junior stage, content and linked
  exam-resource coverage for all four stages.
- Mastery is already a 0-100 value; the recovered cloud display erroneously
  multiplied it by 100. The local display uses the server value directly.
- Mistake counts are total records, not a pending-review queue. Practice
  question counts include recorded sessions, not only completed submissions.
- System view reads existing roles and shows the current account permissions.
  An editor role and permission editing are not implemented yet.
- Demo account labels identify the seeded accounts. They are not a general
  per-record provenance system.
- Local Docker/MySQL remains at http://localhost:8080 with /admin/ and /api/.

## Remaining phases

1. Student navigation: six primary entries and an authenticated Today view.
2. Content governance: junior/grade-seven inventory, editable question-point
   relations, difficulty/source/answer/explanation metadata.
3. Draft/review/publish workflow and editor permissions with privacy isolation.
4. StudyPlan, StudyTask, Intervention, and automatic review generation.
5. Shared report calculations and end-to-end student/teacher verification.

The galaxy, knowledge graph, timelines, and whiteboard remain in place.
Real payment integration remains deferred. New work must preserve the local
database; do not rerun the destructive demo seed to apply application changes.

## Verification on 2026-10-08

Admin build, API typecheck, Docker API rebuild and service health checks passed.
Browser checks covered menu groups, coverage-count invariants, all-stage mastery
(67%), default junior class tab, system-route reload, teacher isolation and
student denial. Teacher scope is empty in this demo database; no non-empty
cross-class access scenario was tested.

Desktop (1440px) and mobile (390px) screenshots were inspected. Mobile navigation
opens and closes correctly without horizontal overflow. Local Edge is version
100; cssTarget preserves compatible media query syntax.

Junior inventory: 366 learning nodes, 1 node with content, 0 nodes with linked
exam resources. Seeded students have no assigned stage, so junior student metrics
are empty; selecting all stages shows their existing data. Per-day active-student
statistics, review queues and automatic study plans are not implemented yet.
