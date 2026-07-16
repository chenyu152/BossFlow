# BossFlow application safety gates

| Action | Required context | Gate |
| --- | --- | --- |
| Fine review | Exact `sourceKey`, job record, current pipeline item | Preview, disclose LLM use, confirm |
| Resume suggestions | Completed fine review and current evidence overview | Preview, disclose LLM use, confirm |
| Final resume wording | User-approved suggestion IDs and confirmed evidence | Leave for BossFlow UI/user approval |
| Interview preparation | Reviewed job plus confirmed evidence or clearly labelled gaps | Preview, disclose LLM use, confirm |

Treat `confirmed evidence`, `source-verified resume facts`, and `pending requirements` as different evidence classes. Use pending requirements only as questions, risks, or requests for more facts.
