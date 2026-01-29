# Migrations Skill

Write migrations in `src/lib/migrations/index.ts`.

## When to Use Migrations vs Backfill Scripts

**Migrations** are for generally applicable schema transformations:
- Renaming fields, changing types, restructuring data
- Must apply sensibly to ALL plans (past, present, future)
- Become permanent part of the migration chain

**Backfill scripts** (`scripts/`) are for one-off data repairs:
- Fixing incorrectly imported data
- Testing new import logic against existing plans
- Repairing data from import bugs

**Never put import bug fixes in migrations.** If the import script had a bug that created incorrect data, fix the import script and write a backfill script to repair existing data. Migrations should not contain logic specific to how data was originally imported.

## Critical Rules

1. **Never mutate objects directly** - Plan objects may be frozen by immer. Always use spread:
   ```typescript
   // BAD - will throw "object is not extensible"
   config.newField = value;

   // GOOD
   newRecord[key] = { ...config, newField: value };
   ```

2. **Return new objects** - Return `{ ...plan, field: newValue }`, don't mutate `plan`.

3. **Check existing migrations** - Follow the pattern of existing migrations in the file.

4. **Append to migrations array** - Add your function to the end of `const migrations = [...]`.

## Adding a Migration

1. Create `function migrateVXtoVY(rawPlan: unknown): unknown`
2. Type-cast sparingly: `const plan = rawPlan as { field?: Type }`
3. Clone and transform, return new object
4. Append to `migrations` array
5. Test with existing plan data
