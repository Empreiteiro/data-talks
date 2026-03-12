import { describe, it, expect } from 'vitest'
import { translateApiError } from '../utils/errorHandling'

describe('translateApiError', () => {
  it('returns fallback for null/undefined error', () => {
    expect(translateApiError(null)).toBe('Erro desconhecido')
    expect(translateApiError(undefined)).toBe('Erro desconhecido')
    expect(translateApiError({})).toBe('Erro desconhecido')
  })

  it('passes through pre-formatted access denied messages', () => {
    const error = { message: 'Acesso negado ao recurso solicitado' }
    expect(translateApiError(error)).toBe('Acesso negado ao recurso solicitado')
  })

  it('translates spreadsheet not found', () => {
    const error = { message: 'Planilha não encontrada no servidor' }
    const result = translateApiError(error)
    expect(result).toContain('Google Sheets')
    expect(result).toContain('não encontrada')
  })

  it('translates invalid spreadsheet ID format', () => {
    const error = { message: 'Formato de ID de planilha inválido: abc123' }
    const result = translateApiError(error)
    expect(result).toContain('inválido')
    expect(result).toContain('Google Sheets')
  })

  it('passes through empty sheet message', () => {
    const error = { message: 'A aba da planilha está vazia' }
    expect(translateApiError(error)).toBe('A aba da planilha está vazia')
  })

  it('translates duplicate key constraint error', () => {
    const error = { message: 'duplicate key value violates unique constraint "users_email_key"' }
    expect(translateApiError(error)).toBe('Este item já existe. Tente um nome diferente.')
  })

  it('translates foreign key constraint error', () => {
    const error = { message: 'violates foreign key constraint "sources_user_id_fkey"' }
    expect(translateApiError(error)).toContain('referência')
  })

  it('translates permission denied error', () => {
    const error = { message: 'permission denied for table users' }
    expect(translateApiError(error)).toBe('Você não tem permissão para realizar esta ação.')
  })

  it('returns original message when no translation matches', () => {
    const error = { message: 'Some unexpected backend error' }
    expect(translateApiError(error)).toBe('Some unexpected backend error')
  })
})
