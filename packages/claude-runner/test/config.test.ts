import { describe, it, expect } from 'vitest'
import {
  availableTools,
  readOnlyTools,
  writeTools,
  getReadOnlyTools,
  getAllTools,
  type ToolName
} from '../src/config'

describe('config', () => {
  describe('Tool Lists', () => {
    it('should define all available tools', () => {
      expect(availableTools).toEqual([
        'Read(**)', 'Edit(**)',
        'Bash', 'Task',
        'WebFetch', 'WebSearch',
        'TodoRead', 'TodoWrite',
        'NotebookRead', 'NotebookEdit',
        'Batch'
      ])
      expect(availableTools).toHaveLength(11)
    })

    it('should define read-only tools', () => {
      expect(readOnlyTools).toEqual([
        'Read(**)', 'WebFetch', 'WebSearch',
        'TodoRead', 'NotebookRead', 'Task', 'Batch'
      ])
      expect(readOnlyTools).toHaveLength(7)
    })

    it('should define write tools', () => {
      expect(writeTools).toEqual([
        'Edit(**)', 'Bash',
        'TodoWrite', 'NotebookEdit'
      ])
      expect(writeTools).toHaveLength(4)
    })

    it('should have no overlap between read-only and write tools', () => {
      const overlap = readOnlyTools.filter(tool => writeTools.includes(tool))
      expect(overlap).toEqual([])
    })

    it('should have all categorized tools in available tools', () => {
      const allCategorized = [...new Set([...readOnlyTools, ...writeTools])]
      allCategorized.forEach(tool => {
        expect(availableTools).toContain(tool)
      })
    })
  })

  describe('Helper Functions', () => {
    it('getReadOnlyTools should return a copy of readOnlyTools', () => {
      const tools = getReadOnlyTools()
      
      // Should equal the original
      expect(tools).toEqual(readOnlyTools)
      
      // But should be a different array instance
      expect(tools).not.toBe(readOnlyTools)
      
      // Modifying returned array shouldn't affect original
      tools.push('NewTool' as ToolName)
      expect(readOnlyTools).not.toContain('NewTool')
    })

    it('getAllTools should return a copy of availableTools', () => {
      const tools = getAllTools()
      
      // Should equal the original
      expect(tools).toEqual(availableTools)
      
      // But should be a different array instance
      expect(tools).not.toBe(availableTools)
      
      // Modifying returned array shouldn't affect original
      tools.push('NewTool')
      expect(availableTools).not.toContain('NewTool')
    })
  })

  describe('Type Safety', () => {
    it('should allow valid tool names in typed contexts', () => {
      // This is a compile-time check, but we can verify runtime behavior
      const validTool: ToolName = 'Read(**)'
      expect(availableTools).toContain(validTool)
    })

    it('should have all tools as string type', () => {
      availableTools.forEach(tool => {
        expect(typeof tool).toBe('string')
      })
      
      readOnlyTools.forEach(tool => {
        expect(typeof tool).toBe('string')
      })
      
      writeTools.forEach(tool => {
        expect(typeof tool).toBe('string')
      })
    })
  })

  describe('Tool Categorization Logic', () => {
    it('Read(**) should be read-only', () => {
      expect(readOnlyTools).toContain('Read(**)')
      expect(writeTools).not.toContain('Read(**)')
    })

    it('Edit(**) should be a write tool', () => {
      expect(writeTools).toContain('Edit(**)')
      expect(readOnlyTools).not.toContain('Edit(**)')
    })

    it('Bash should be a write tool (can modify system)', () => {
      expect(writeTools).toContain('Bash')
      expect(readOnlyTools).not.toContain('Bash')
    })

    it('Task should be read-only (delegates to other tools)', () => {
      expect(readOnlyTools).toContain('Task')
      expect(writeTools).not.toContain('Task')
    })

    it('WebFetch should be read-only', () => {
      expect(readOnlyTools).toContain('WebFetch')
      expect(writeTools).not.toContain('WebFetch')
    })

    it('WebSearch should be read-only', () => {
      expect(readOnlyTools).toContain('WebSearch')
      expect(writeTools).not.toContain('WebSearch')
    })

    it('Todo tools should be categorized correctly', () => {
      expect(readOnlyTools).toContain('TodoRead')
      expect(writeTools).toContain('TodoWrite')
    })

    it('Notebook tools should be categorized correctly', () => {
      expect(readOnlyTools).toContain('NotebookRead')
      expect(writeTools).toContain('NotebookEdit')
    })

    it('Batch should be read-only', () => {
      expect(readOnlyTools).toContain('Batch')
      expect(writeTools).not.toContain('Batch')
    })
  })
})