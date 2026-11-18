import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import markdown, { expressionSyntax, commentMd, commentSyntax, renderCommentMarkdown } from './markdown'

export const homepageSyntax = expressionSyntax
export const homepageAdapter = createMarkdownItAdapter({ markdown, syntax: homepageSyntax })

export const homepageCommentAdapter = createMarkdownItAdapter({ markdown: commentMd, profile: 'comment', syntax: commentSyntax, render: renderCommentMarkdown })
