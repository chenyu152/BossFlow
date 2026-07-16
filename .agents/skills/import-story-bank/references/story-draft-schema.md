# Story draft schema

Create each draft with these fields:

```json
{
  "title": "Concise evidence-backed title",
  "theme": "ownership | debugging | performance | collaboration | delivery",
  "source": "repo/path/file.ext:line",
  "sourceLabel": "Human-readable source description",
  "tags": ["ownership", "problem-solving"],
  "rawNote": "Directly supported facts and open questions",
  "format": "freeform",
  "structureStatus": "needs_structuring",
  "situation": "",
  "task": "",
  "action": "",
  "result": "",
  "reflection": "",
  "status": "needs_confirmation"
}
```

Use empty strings when evidence is absent. Put questions such as “confirm personal ownership” or “supply measured result” in `rawNote`; never fill them with plausible guesses.
