# Role Definition Ownership

Primary owner: **PDLC Governance**.

`catalog.json` is the source of truth for logical delivery accountability. Product, Developer, and QA are the initial registered Roles; they are defaults, not a hard-coded closed set. Role definitions do not require separate people. Risk or governance policy may require separation of duties for specific checkpoints.

To add a Role, create its Markdown definition, register its id/name/path in `catalog.json`, and reference the id from relevant Stage `roleSlots` or Delivery Flow Checkpoint `ownerRole`. The Runner validates those references and derives required Delivery Record assignments from the active Flow. Do not add a Role merely to represent Discipline expertise: use Discipline Policies, Knowledge, Skills, Agents, and Hooks unless the responsibility needs a formal assignment or controlled decision right.

Role definition changes should be reviewed by the corresponding Product, Engineering, and QA leadership functions.
