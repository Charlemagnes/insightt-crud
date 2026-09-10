# Task List

An authenticated task tracker. People sign in through Auth0, create tasks they
alone can see, and move each task through a fixed forward-only lifecycle.

## Language

**Task**:
A unit of work belonging to exactly one person, carrying a title, an optional
description, and a lifecycle status.
_Avoid_: Todo, item, ticket

**User ID**:
The permanent identifier Auth0 assigns a person, carried in the access token's
`sub` claim and read exactly once at the auth boundary. Everywhere downstream it
is called `userId`.
_Avoid_: sub, subject, id (that belongs to a Task)

**Owner**:
The person a Task belongs to, named by their User ID. A Task has exactly one
Owner, set at creation and never changed.
_Avoid_: User, author, creator, account

**Actor**:
The person behind the current request. An operation on a Task succeeds only when
the Actor is that Task's Owner; otherwise the Task is reported as not found.
_Avoid_: Caller, principal, requester

**Status**:
A Task's position in the lifecycle `PENDING → IN_PROGRESS → DONE → ARCHIVED`.
_Avoid_: State, stage, phase

**Transition**:
A move from one Status to the one immediately after it. Every other move is
invalid, including moving backwards.
_Avoid_: Status change, status update

**Archived**:
The terminal Status. An Archived Task is finished and put away: no field on it
can be changed and no further Transition is possible. It still appears in the
list alongside every other Task.
_Avoid_: Closed, deleted, hidden

**Version**:
A counter raised on every change to a Task, used to detect that someone else
changed the Task since it was read.
_Avoid_: Revision, ETag, timestamp

**Replay**:
A repeat of a Mark Done request against a Task that is already `DONE`. Reported
as success, and it never overwrites the original completion.
_Avoid_: Duplicate, retry
