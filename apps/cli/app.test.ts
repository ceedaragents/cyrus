import { describe, it, expect, vi } from 'vitest'
import * as readline from 'node:readline'

// Mock readline
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn()
  }))
}))

describe('Project Keys Parsing', () => {
  it('should handle normal comma-separated project names', () => {
    const projectKeysInput = 'Mobile App,Web Platform,API Service'
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toEqual(['Mobile App', 'Web Platform', 'API Service'])
  })

  it('should filter out empty strings from consecutive commas', () => {
    const projectKeysInput = 'Project1,,Project2,,,Project3'
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toEqual(['Project1', 'Project2', 'Project3'])
  })

  it('should handle trailing commas', () => {
    const projectKeysInput = 'Project1,Project2,'
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toEqual(['Project1', 'Project2'])
  })

  it('should handle leading commas', () => {
    const projectKeysInput = ',Project1,Project2'
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toEqual(['Project1', 'Project2'])
  })

  it('should handle spaces around project names', () => {
    const projectKeysInput = '  Project1  ,  Project2  ,  Project3  '
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toEqual(['Project1', 'Project2', 'Project3'])
  })

  it('should handle empty input', () => {
    const projectKeysInput = ''
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toBeUndefined()
  })

  it('should handle only commas input', () => {
    const projectKeysInput = ',,,'
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toEqual([])
  })

  it('should handle mixed empty and valid entries', () => {
    const projectKeysInput = 'Valid1,,  ,Valid2,   ,,Valid3'
    const projectKeys = projectKeysInput ? projectKeysInput.split(',').map(p => p.trim()).filter(Boolean) : undefined
    
    expect(projectKeys).toEqual(['Valid1', 'Valid2', 'Valid3'])
  })
})