import { describe, expect, it } from 'vitest'
import { describeIssues, issuesAt, issuesUnder, pathLabel } from '../shared/field-issues'

const labels = { Hero: 'Hero', TrustStrip: 'Trust marks' }
const types = ['Hero', 'TrustStrip']

describe('field issue labels', () => {
  it('names a section and field in plain English', () => {
    expect(pathLabel('blocks.1.props.intro', labels, types)).toBe('Trust marks: Introduction')
    expect(pathLabel('blocks.1.props.items.0.name', labels, types)).toBe('Trust marks: Items, item 1, Name')
    expect(pathLabel('blocks.0.props.image.alt', labels, types)).toBe('Hero: Photo, Alt text')
    expect(pathLabel('title', labels, types)).toBe('Page title')
  })

  it('groups issues by exact path and by section', () => {
    const issues = [
      { path: 'blocks.1.props.intro', message: 'This looks like placeholder text. Replace it before submitting.' },
      { path: 'blocks.1.props.items.0.name', message: 'This looks like placeholder text. Replace it before submitting.' },
      { path: 'blocks.0.props.subheading', message: 'This looks like placeholder text. Replace it before submitting.' },
    ]
    expect(issuesAt(issues, 'blocks.1.props.intro')).toHaveLength(1)
    expect(issuesUnder(issues, 'blocks.1').map((i) => i.path)).toEqual([
      'blocks.1.props.intro',
      'blocks.1.props.items.0.name',
    ])
    const described = describeIssues(issues, { blockTypes: types, blockLabels: labels })
    expect(described[0]!.title).toBe('Trust marks: Introduction')
    expect(described[0]!.blockIndex).toBe(1)
  })
})
