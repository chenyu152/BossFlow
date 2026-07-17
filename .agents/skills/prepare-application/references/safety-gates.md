# BossFlow application safety gates

| Action | Required context | Gate |
| --- | --- | --- |
| Fine review | Exact `sourceKey`, job record, current pipeline item | Preview, disclose LLM use, confirm |
| Resume suggestions by connected Agent | Current application context and evidence map | Preview saved artifact, confirm write; no BossFlow API cost |
| Resume suggestions by BossFlow LLM | Completed fine review and current evidence overview | Preview, disclose BossFlow LLM cost, confirm |
| Final resume wording | User-approved suggestion IDs and confirmed evidence | Leave for BossFlow UI/user approval |
| Interview preparation by connected Agent | Reviewed job plus confirmed evidence or clearly labelled gaps | Preview saved artifact, confirm write; no BossFlow API cost |
| Interview preparation by BossFlow LLM | Reviewed job plus confirmed evidence or clearly labelled gaps | Preview, disclose BossFlow LLM cost, confirm |

Treat `confirmed evidence`, `source-verified resume facts`, and `pending requirements` as different evidence classes. Use pending requirements only as questions, risks, or requests for more facts.

For every gate, show the server preview and ask a yes/no question, then end the turn. Consume the returned one-time `confirmationId` only after a later explicit yes. A changed payload, expired ticket, silence, or ambiguous response requires a new preview.
