# Markers

Everything the agent may save about a person. `src/markers.ts` reads this table at startup, so a key that is
not listed here is rejected by `record_marker`.

- **kind**: `filter` keys are also copied to top-level profile fields used by the vector-search hard filters.
  `values` keys count toward values agreement in the matcher. `profile` keys only describe the person.
- **core**: counts toward profile completeness.
- **sensitive**: saved only when the person volunteered it and confirmed it (`confirmed: true`).

Every saved marker has value, importance 1-5, confidence 0-1, quote, call_ids.

| key | kind | core | sensitive | description |
|---|---|---|---|---|
| gender | filter | yes | no | The person's gender: woman, man or nonbinary |
| wants_to_meet | filter | yes | no | Comma-separated genders they want to meet: woman, man, nonbinary |
| looking_for | filter | yes | no | long_term, casual or friendship |
| region | filter | yes | no | City or metro area, lowercase, e.g. houston |
| wants_kids | values | yes | no | yes, no or open |
| faith_importance | values | yes | yes | How central religion or spirituality is: high, medium or low |
| politics | values | no | yes | progressive, moderate or conservative |
| lifestyle | values | yes | no | active, balanced or homebody |
| drinking | values | no | no | never, socially or often |
| smoking | values | no | no | never, sometimes or often |
| pets | values | no | no | has_dogs, has_cats, wants_pets or no_pets |
| relocation | values | no | no | Willing to move for a partner: yes, no or maybe |
| occupation | profile | yes | no | What they do for work |
| interests | profile | yes | no | Comma-separated hobbies and interests |
| weekend | profile | no | no | What a good weekend looks like |
| dealbreakers | profile | no | no | Things they will not accept in a partner |
| love_language | profile | no | no | words, time, gifts, service or touch |
| health | profile | no | yes | Health conditions they chose to share |
