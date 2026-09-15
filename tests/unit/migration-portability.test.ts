import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('runtime role migration portability', () => {
  it('declares safe attributes during creation without requiring a superuser ALTER', async () => {
    const migration = await readFile('drizzle/0004_phase_one_runtime_role.sql', 'utf8')

    expect(migration).toMatch(
      /CREATE ROLE nimreturn_runtime\s+NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;/u,
    )
    expect(migration).not.toMatch(/ALTER ROLE nimreturn_runtime/u)
  })
})
