import { describe, it, expect } from 'vitest'
import { cn, getConnectionStringLabel } from '../lib/utils'

describe('cn (className merger)', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('resolves tailwind conflicts (last wins)', () => {
    const result = cn('p-2', 'p-4')
    expect(result).toBe('p-4')
  })

  it('ignores falsy values', () => {
    expect(cn('foo', false, undefined, null, 'bar')).toBe('foo bar')
  })

  it('returns empty string for no args', () => {
    expect(cn()).toBe('')
  })

  it('supports conditional classes', () => {
    const active = true
    expect(cn('base', active && 'active')).toBe('base active')
    expect(cn('base', !active && 'inactive')).toBe('base')
  })
})

describe('getConnectionStringLabel', () => {
  it('returns empty string for empty input', () => {
    expect(getConnectionStringLabel('')).toBe('')
    expect(getConnectionStringLabel('   ')).toBe('')
  })

  it('formats postgresql connection string', () => {
    const result = getConnectionStringLabel('postgresql://user:pass@localhost:5432/mydb')
    expect(result).toBe('postgresql @ localhost:5432/mydb')
  })

  it('formats postgres alias', () => {
    const result = getConnectionStringLabel('postgres://admin:secret@db.example.com/sales')
    expect(result).toBe('postgres @ db.example.com/sales')
  })

  it('formats mysql connection string', () => {
    const result = getConnectionStringLabel('mysql://root:pass@127.0.0.1:3306/app')
    expect(result).toBe('mysql @ 127.0.0.1:3306/app')
  })

  it('does not expose password in output', () => {
    const result = getConnectionStringLabel('postgresql://user:supersecret@host/db')
    expect(result).not.toContain('supersecret')
  })

  it('handles connection string without database path', () => {
    const result = getConnectionStringLabel('postgresql://user:pass@localhost')
    expect(result).toBe('postgresql @ localhost')
  })

  it('truncates unknown long strings', () => {
    const longStr = 'x'.repeat(50)
    const result = getConnectionStringLabel(longStr)
    expect(result).toBe('...' + longStr.slice(-35))
  })

  it('returns short unknown strings as-is', () => {
    const short = 'some-dsn-string'
    expect(getConnectionStringLabel(short)).toBe(short)
  })
})
