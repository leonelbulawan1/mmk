import { describe, expect, it } from 'vitest'
import { check, rules } from './validation'

describe('form rules', () => {
  it('email', () => {
    expect(rules.email('')).toBe('Enter your email address.')
    expect(rules.email('ana@')).toBe('Enter a valid email address, like name@gmail.com.')
    expect(rules.email('ana@gmail.com')).toBe('')
  })
  it('new password needs 8 characters with letters and numbers', () => {
    expect(rules.newPassword('')).toBe('Create a password.')
    expect(rules.newPassword('abc1')).toBe('Use at least 8 characters.')
    expect(rules.newPassword('abcdefgh')).toBe('Use both letters and numbers.')
    expect(rules.newPassword('abcdefg1')).toBe('')
  })
  it('six-digit code', () => {
    expect(rules.code6('12345')).toBe('Enter the 6-digit code.')
    expect(rules.code6('123456')).toBe('')
  })
  it('policy handle', () => {
    expect(rules.handle('')).toBe('Enter a policy handle.')
    expect(rules.handle('Maria')).not.toBe('')
    expect(rules.handle('maria_2')).toBe('')
  })
  it('typed phrase must match exactly', () => {
    expect(rules.phrase('DELETE MY ACCOUNT')('delete my account')).toBe('Type DELETE MY ACCOUNT exactly as shown.')
    expect(rules.phrase('DELETE MY ACCOUNT')('DELETE MY ACCOUNT')).toBe('')
  })
  it('check returns only the fields with a problem', () => {
    expect(check({ email: 'a@b.co', password: '' }, { email: rules.email, password: rules.password })).toEqual({ password: 'Enter your password.' })
  })
})
