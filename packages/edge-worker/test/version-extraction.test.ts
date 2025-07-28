import { describe, it, expect } from 'vitest'

describe('Version Tag Extraction', () => {
  // Test the version extraction regex
  const extractVersionTag = (templateContent: string): string | undefined => {
    const versionTagMatch = templateContent.match(/<version-tag\s+value="([^"]*)"\s*\/>/i)
    const version = versionTagMatch ? versionTagMatch[1] : undefined
    // Return undefined for empty strings
    return version && version.trim() ? version : undefined
  }

  it('should extract version tag from template with version', () => {
    const template = `<version-tag value="builder-v1.0.0" />
    
# Some Template Content

This is a test template with a version tag.`

    const version = extractVersionTag(template)
    expect(version).toBe('builder-v1.0.0')
  })

  it('should handle version tag with different formatting', () => {
    const templates = [
      `<version-tag value="scoper-v2.1.0"/>`,
      `<version-tag  value="debugger-v3.0.0"  />`,
      `<Version-Tag value="builder-v1.2.3" />`,
      `<VERSION-TAG VALUE="UPPER-V1.0.0" />`,
    ]

    expect(extractVersionTag(templates[0])).toBe('scoper-v2.1.0')
    expect(extractVersionTag(templates[1])).toBe('debugger-v3.0.0')
    expect(extractVersionTag(templates[2])).toBe('builder-v1.2.3')
    expect(extractVersionTag(templates[3])).toBe('UPPER-V1.0.0')
  })

  it('should return undefined for templates without version tag', () => {
    const template = `# Some Template Content

This is a test template without a version tag.`

    const version = extractVersionTag(template)
    expect(version).toBeUndefined()
  })

  it('should handle malformed version tags gracefully', () => {
    const templates = [
      `<version-tag value="" />`,
      `<version-tag />`,
      `<version-tag value= />`,
      `<version-tag value>`,
    ]

    expect(extractVersionTag(templates[0])).toBeUndefined() // Empty value should be undefined
    expect(extractVersionTag(templates[1])).toBeUndefined()
    expect(extractVersionTag(templates[2])).toBeUndefined()
    expect(extractVersionTag(templates[3])).toBeUndefined()
  })

  it('should extract only the first version tag if multiple exist', () => {
    const template = `<version-tag value="first-v1.0.0" />
<version-tag value="second-v2.0.0" />
    
# Some Template Content`

    const version = extractVersionTag(template)
    expect(version).toBe('first-v1.0.0')
  })
})