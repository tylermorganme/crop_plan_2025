# Migrations Skill

Write migrations in `src/lib/migrations/index.ts`.

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
